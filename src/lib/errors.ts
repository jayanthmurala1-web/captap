/** Expected failures whose message is safe to show a user or agent. Anything else is a bug (500). */
export class DomainError extends Error {}
export class ForbiddenError extends DomainError {}
export class NotFoundError extends DomainError {}
export class ValidationError extends DomainError {}
export class ConflictError extends DomainError {}

/** Postgres unique violation (drizzle wraps the driver error in `cause`). */
export const isUniqueViolation = (e: unknown) =>
  ((e as { cause?: { code?: string } }).cause?.code ??
    (e as { code?: string }).code) === "23505";
