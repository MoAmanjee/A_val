export type ErrorCode =
  | "VALIDATION"
  | "UNAUTHORIZED"
  | "FORBIDDEN"
  | "NOT_FOUND"
  | "CONFLICT"
  | "INVALID_STATE"
  | "RATE_LIMITED"
  | "EXTERNAL_SERVICE"
  | "INTERNAL";

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly details?: unknown;

  constructor(code: ErrorCode, message: string, status: number, details?: unknown) {
    super(message);
    this.name = "AppError";
    this.code = code;
    this.status = status;
    this.details = details;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super("VALIDATION", message, 400, details);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required") {
    super("UNAUTHORIZED", message, 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "You do not have permission to do that") {
    super("FORBIDDEN", message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(entity = "Resource") {
    super("NOT_FOUND", `${entity} not found`, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, details?: unknown) {
    super("CONFLICT", message, 409, details);
  }
}
export class InvalidStateError extends AppError {
  constructor(message: string, details?: unknown) {
    super("INVALID_STATE", message, 409, details);
  }
}
export class ExternalServiceError extends AppError {
  constructor(message: string, details?: unknown) {
    super("EXTERNAL_SERVICE", message, 502, details);
  }
}

export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  return String(e);
}
