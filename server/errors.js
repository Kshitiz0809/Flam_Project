// A typed error the API returns as JSON: { error: { code, message, retryable } }.
// The client maps `code` to user-facing copy, so the server message is mostly
// for logs / the "details" disclosure.
export class ApiError extends Error {
  constructor(status, code, message, { retryable = false } = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}
