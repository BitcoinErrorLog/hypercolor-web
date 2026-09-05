/** Typed errors for the web SQLite + tab-lock seam. */

export class ReadOnlyTabError extends Error {
  readonly code = "readonly-tab" as const;

  constructor(
    message = "This tab cannot write. Reads still work. Take over writing here to send or save.",
  ) {
    super(message);
    this.name = "ReadOnlyTabError";
  }
}

export function isReadOnlyTabError(err: unknown): err is ReadOnlyTabError {
  return (
    err instanceof ReadOnlyTabError ||
    (err instanceof Error &&
      (err.name === "ReadOnlyTabError" ||
        err.message.includes("This tab cannot write")))
  );
}

export class SqlitePersistError extends Error {
  readonly code = "sqlite-persist" as const;

  constructor(cause?: unknown) {
    const detail = cause instanceof Error ? cause.message : cause ? String(cause) : "unknown error";
    super(`Could not save the local database snapshot (${detail}).`);
    this.name = "SqlitePersistError";
    if (cause instanceof Error) this.cause = cause;
  }
}

export function isSqlitePersistError(err: unknown): err is SqlitePersistError {
  return err instanceof SqlitePersistError || (err instanceof Error && err.name === "SqlitePersistError");
}

export const SQLITE_PERSIST_FAILED_EVENT = "hypercolor-sqlite-persist-failed";
