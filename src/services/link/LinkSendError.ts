export type LinkSendErrorCode = "standby-not-receiving" | "not-sendable";

export class LinkSendError extends Error {
  readonly code: LinkSendErrorCode;

  constructor(code: LinkSendErrorCode, message: string) {
    super(message);
    this.name = "LinkSendError";
    this.code = code;
  }
}
