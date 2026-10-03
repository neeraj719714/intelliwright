/** Any JSON value. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue };

/**
 * Text or JSON structure that describes a question, an option or a level.
 * `null` leaves an option without a description.
 */
export type Description = JsonValue;

/** A yes/no question. The answer is the probability that the answer is yes. */
export interface BooleanQuestion {
  type: "boolean";
  instructions: Description;
  criteria?: { true?: Description; false?: Description };
}

/** Picks one option. At most 255 options. */
export interface ChoiceQuestion<Option extends string = string> {
  type: "choice";
  instructions: Description;
  criteria: Record<Option, Description>;
}

/** Rates the state on ordered levels, from 2 to 10 of them. */
export interface ScoreQuestion {
  type: "score";
  instructions: Description;
  criteria: readonly Description[];
}

export type Question = BooleanQuestion | ChoiceQuestion | ScoreQuestion;

export type Questions = Record<string, Question>;

export interface BooleanAnswer {
  type: "boolean";
  /** Probability that the answer is yes, from 0 to 1. */
  probability: number;
}

export interface ChoiceAnswer<Option extends string = string> {
  type: "choice";
  choice: Option;
  /** Probability of every option that was sent. */
  probabilities: Record<Option, number>;
  confidence?: number;
}

export interface ScoreAnswer {
  type: "score";
  /** Probability-weighted level, so it can land between levels. */
  score: number;
  /** Probability of each level, indexed from 0. */
  probabilities: number[];
  confidence?: number;
}

export type Answer = BooleanAnswer | ChoiceAnswer | ScoreAnswer;

export type AnswerFor<Q extends Question> = Q extends BooleanQuestion
  ? BooleanAnswer
  : Q extends ChoiceQuestion<infer Option>
    ? ChoiceAnswer<Option>
    : ScoreAnswer;

export type Answers<Qs extends Questions> = {
  [K in keyof Qs]: AnswerFor<Qs[K]>;
};

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}

export interface EvaluateRequest<Qs extends Questions = Questions> {
  state: JsonValue;
  questions: Qs;
}

export interface EvaluateOptions {
  signal?: AbortSignal;
}

export interface EvaluateResult<Qs extends Questions = Questions> {
  answers: Answers<Qs>;
  /** The model version that answered, such as `jev-1.13.0`. */
  model: string;
  usage: Usage;
  /** US dollars, as reported by the provider or estimated from usage. */
  costUsd: number;
  costEstimated: boolean;
}

/** Every AI feature asks its questions through an evaluator. */
export interface Evaluator {
  evaluate<Qs extends Questions>(
    request: EvaluateRequest<Qs>,
    options?: EvaluateOptions,
  ): Promise<EvaluateResult<Qs>>;
}

/** What a custom `evaluate` function returns. Missing fields get defaults. */
export interface CustomEvaluateResult {
  answers: Record<string, Answer>;
  model?: string;
  usage?: Partial<Usage>;
  costUsd?: number;
}

/** Your own evaluator, passed as `ai.provider`. */
export interface CustomProvider {
  /** Shown in errors and reports. Defaults to "custom". */
  name?: string;
  /** Most input tokens one request may use. Defaults to 32,000. */
  maxInputTokens?: number;
  evaluate(
    request: EvaluateRequest,
    options: EvaluateOptions,
  ): Promise<CustomEvaluateResult>;
}

/** Token limits for one request. */
export interface TokenBudget {
  /** All input tokens in one request. */
  request: number;
  /** The state plus the longest question. */
  stateAndQuestion: number;
}
