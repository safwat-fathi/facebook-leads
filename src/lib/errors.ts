// An error that is safe to show to the client (status + message). Anything else becomes a generic 500.
export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
export const bad = (message: string) => new HttpError(400, message);
