import { QueryFailedError } from 'typeorm';

const PG_UNIQUE_VIOLATION = '23505';

/** Lỗi vi phạm UNIQUE của Postgres đúng constraint `constraint`. */
export function isUniqueViolation(error: unknown, constraint: string): boolean {
  if (!(error instanceof QueryFailedError)) return false;
  const driverError = error.driverError as {
    code?: unknown;
    constraint?: unknown;
  };
  return (
    driverError.code === PG_UNIQUE_VIOLATION &&
    driverError.constraint === constraint
  );
}
