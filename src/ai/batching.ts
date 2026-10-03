import { JevError } from "./errors.js";
import {
  estimateQuestionTokens,
  estimateStateTokens,
  REQUEST_OVERHEAD_TOKENS,
  usableBudget,
} from "./tokens.js";
import type {
  Answer,
  Evaluator,
  EvaluateOptions,
  EvaluateRequest,
  EvaluateResult,
  JsonValue,
  Questions,
  TokenBudget,
} from "./types.js";

export interface BatchingOptions {
  budget: TokenBudget;
  /** Shown in errors. */
  provider: string;
  /** How long to gather questions about the same state before sending. */
  windowMs?: number;
}

interface Member {
  questions: Questions;
  signal: AbortSignal | undefined;
  resolve(result: EvaluateResult): void;
  reject(error: unknown): void;
  settled: boolean;
}

interface Batch {
  state: JsonValue;
  members: Member[];
}

/**
 * Questions about the same state that arrive within `windowMs` of each other
 * go out as one request. A request that would exceed the provider's token
 * budget is split into several, sent in parallel, and their answers merged.
 */
export function withBatching(inner: Evaluator, options: BatchingOptions): Evaluator {
  const windowMs = options.windowMs ?? 10;
  const pending = new Map<string, Batch>();

  const flush = async (key: string, batch: Batch): Promise<void> => {
    if (pending.get(key) === batch) pending.delete(key);
    const members = batch.members.filter((member) => !member.settled);
    if (members.length === 0) return;

    const merged: Questions = {};
    const origin = new Map<string, { member: Member; key: string }>();
    members.forEach((member, index) => {
      for (const [questionKey, question] of Object.entries(member.questions)) {
        const id = members.length === 1 ? questionKey : `${index}.${questionKey}`;
        merged[id] = question;
        origin.set(id, { member, key: questionKey });
      }
    });

    try {
      const result = await evaluateWithinBudget(inner, batch.state, merged, options, combineSignals(members));
      const answersByMember = new Map<Member, Record<string, Answer>>();
      for (const [id, answer] of Object.entries(result.answers)) {
        const source = origin.get(id);
        if (!source) continue;
        const answers = answersByMember.get(source.member) ?? {};
        answers[source.key] = answer;
        answersByMember.set(source.member, answers);
      }
      for (const member of members) {
        settle(member, () => member.resolve({ ...result, answers: answersByMember.get(member) ?? {} }));
      }
    } catch (error) {
      for (const member of members) settle(member, () => member.reject(error));
    }
  };

  return {
    evaluate<Qs extends Questions>(
      request: EvaluateRequest<Qs>,
      evaluateOptions?: EvaluateOptions,
    ): Promise<EvaluateResult<Qs>> {
      const signal = evaluateOptions?.signal;
      if (signal?.aborted) return Promise.reject(signal.reason);

      const key = JSON.stringify(request.state);
      let batch = pending.get(key);
      if (!batch) {
        const created: Batch = { state: request.state, members: [] };
        pending.set(key, created);
        setTimeout(() => void flush(key, created), windowMs);
        batch = created;
      }
      const members = batch.members;

      return new Promise<EvaluateResult<Qs>>((resolve, reject) => {
        const member: Member = {
          questions: request.questions,
          signal,
          resolve: resolve as (result: EvaluateResult) => void,
          reject,
          settled: false,
        };
        members.push(member);
        signal?.addEventListener("abort", () => settle(member, () => reject(signal.reason)), {
          once: true,
        });
      });
    },
  };
}

function settle(member: Member, action: () => void): void {
  if (member.settled) return;
  member.settled = true;
  action();
}

/** Aborts only once every member has aborted. */
function combineSignals(members: Member[]): AbortSignal | undefined {
  const signals = members.map((member) => member.signal);
  if (signals.some((signal) => signal === undefined)) return undefined;
  const controller = new AbortController();
  const check = (): void => {
    if (signals.every((signal) => signal?.aborted)) controller.abort(signals[0]?.reason);
  };
  for (const signal of signals) signal?.addEventListener("abort", check, { once: true });
  return controller.signal;
}

async function evaluateWithinBudget(
  inner: Evaluator,
  state: JsonValue,
  questions: Questions,
  options: BatchingOptions,
  signal: AbortSignal | undefined,
): Promise<EvaluateResult> {
  const groups = planRequests(state, questions, options.budget, options.provider);
  if (groups.length === 1) {
    return inner.evaluate({ state, questions: groups[0] as Questions }, { signal });
  }
  const results = await Promise.all(
    groups.map((group) => inner.evaluate({ state, questions: group }, { signal })),
  );
  return {
    answers: Object.assign({}, ...results.map((result) => result.answers)) as EvaluateResult["answers"],
    model: results[0]?.model ?? "",
    usage: {
      inputTokens: results.reduce((sum, result) => sum + result.usage.inputTokens, 0),
      outputTokens: results.reduce((sum, result) => sum + result.usage.outputTokens, 0),
    },
    costUsd: results.reduce((sum, result) => sum + result.costUsd, 0),
    costEstimated: results.some((result) => result.costEstimated),
  };
}

/** Groups questions into as few requests as the token budget allows. */
export function planRequests(
  state: JsonValue,
  questions: Questions,
  budget: TokenBudget,
  provider: string,
): Questions[] {
  const limits = usableBudget(budget);
  const stateTokens = estimateStateTokens(state);
  const fixed = REQUEST_OVERHEAD_TOKENS + stateTokens;

  const groups: Questions[] = [];
  let current: Questions = {};
  let used = fixed;
  let count = 0;
  for (const [key, question] of Object.entries(questions)) {
    const tokens = estimateQuestionTokens(question);
    if (stateTokens + tokens > limits.stateAndQuestion || fixed + tokens > limits.request) {
      throw new JevError(
        `The state and question "${key}" need about ${stateTokens + tokens} tokens, more than ${provider} accepts in one request (about ${limits.stateAndQuestion}).`,
        { kind: "invalid_request", provider },
      );
    }
    if (count > 0 && used + tokens > limits.request) {
      groups.push(current);
      current = {};
      used = fixed;
      count = 0;
    }
    current[key] = question;
    used += tokens;
    count++;
  }
  if (count > 0) groups.push(current);
  if (groups.length === 0) {
    throw new JevError("A request needs at least one question.", { kind: "invalid_request", provider });
  }
  return groups;
}
