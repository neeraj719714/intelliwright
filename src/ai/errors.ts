export type JevErrorKind =
  | "config"
  | "auth"
  | "payment"
  | "forbidden"
  | "invalid_request"
  | "rate_limited"
  | "server"
  | "network"
  | "timeout"
  | "invalid_answer";

export interface JevErrorDetails {
  kind: JevErrorKind;
  provider: string;
  status?: number;
  requestId?: string;
  cause?: unknown;
}

export class JevError extends Error {
  override readonly name: string = "JevError";
  readonly kind: JevErrorKind;
  readonly provider: string;
  readonly status: number | undefined;
  readonly requestId: string | undefined;

  constructor(message: string, details: JevErrorDetails) {
    super(message, details.cause === undefined ? undefined : { cause: details.cause });
    this.kind = details.kind;
    this.provider = details.provider;
    this.status = details.status;
    this.requestId = details.requestId;
  }
}

/** Works across copies of the package, where `instanceof` does not. */
export function isJevError(error: unknown): error is JevError {
  return error instanceof Error && error.name === "JevError";
}
