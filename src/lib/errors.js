// Every failure in the app is normalised into an AppError with a `code`, so
// the UI can pick copy + whether to offer "Try again" without string-matching.
export class AppError extends Error {
  constructor(code, message, { retryable = false, detail } = {}) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = retryable;
    this.detail = detail;
  }
}

const COPY = {
  NETWORK: { title: "Can't reach the server", hint: 'Check your internet connection, then try again. (Running locally? Make sure `npm start` is still running.)' },
  TIMEOUT: { title: 'The AI took too long', hint: 'Its servers may be busy (we already tried a backup model). Trying again usually works.' },
  RATE_LIMITED: { title: 'Too many requests', hint: "You've hit a usage limit. Wait a little and try again." },
  OVERLOADED: { title: 'The AI is very busy right now', hint: "Google's servers are under heavy demand (we already tried a backup model). Wait a few seconds and try again." },
  MODEL_NOT_FOUND: { title: 'The server is not set up correctly', hint: 'The configured Gemini model does not exist. Check GEMINI_MODEL.' },
  UPSTREAM_ERROR: { title: 'The AI service had a problem', hint: 'This is usually temporary. Try again.' },
  UPSTREAM_UNREACHABLE: { title: "Can't reach the AI service", hint: 'The server could not connect to Gemini. Try again shortly.' },
  CONFIG: { title: 'The server is not set up correctly', hint: 'Check GEMINI_API_KEY / GEMINI_MODEL in .env and restart.' },
  BAD_REQUEST: { title: "That request couldn't be sent", hint: '' },
  BLOCKED: { title: 'The AI declined this request', hint: 'Its safety filter blocked the response. Try rewording your ingredients.' },
  MALFORMED_JSON: { title: 'The AI sent back garbled data', hint: 'We tried again automatically, but it was still unreadable.' },
  INVALID_SHAPE: { title: "The AI's answer was in the wrong format", hint: 'We tried again automatically. Trying once more, or rewording, usually helps.' },
  EMPTY: { title: 'The AI returned nothing', hint: 'We tried again automatically. Try again or add more detail.' },
  TRUNCATED: { title: "The AI's answer got cut off", hint: 'The response hit its length limit. Try again, or ask for something simpler.' },
  IMAGE_TYPE: { title: "That file isn't a photo", hint: 'Choose a JPEG, PNG or WebP image.' },
  IMAGE_TOO_LARGE: { title: 'That photo is too large', hint: 'Choose an image under 20 MB.' },
  IMAGE_UNREADABLE: { title: "Couldn't open that photo", hint: 'Your browser may not support this format (e.g. HEIC). Try a JPEG or PNG, or take a screenshot of it.' },
  INTERNAL: { title: 'Something went wrong on the server', hint: 'Try again.' },
  UNKNOWN: { title: 'Something went wrong', hint: 'Try again.' },
};

/** User-facing description of any thrown value. */
export function describeError(err) {
  const code = typeof err?.code === 'string' && err.code in COPY ? err.code : 'UNKNOWN';
  const copy = COPY[code];
  return {
    code,
    title: copy.title,
    // BAD_REQUEST messages are written for users by the server; others are technical.
    message: code === 'BAD_REQUEST' ? err.message : copy.hint,
    detail: err?.message,
    retryable: Boolean(err?.retryable),
  };
}

/** Output problems that are worth one silent automatic retry. */
export const AUTO_RETRY_CODES = new Set(['MALFORMED_JSON', 'INVALID_SHAPE', 'EMPTY', 'TRUNCATED']);
