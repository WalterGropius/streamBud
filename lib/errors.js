/** An error with a friendly message that's safe to show to the person using the app. */
export class ConvertError extends Error {
  constructor(code, message, status = 400) {
    super(message);
    this.name = 'ConvertError';
    this.code = code;
    this.status = status;
  }
}
