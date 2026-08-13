/**
 * Errors carry an HTTP status and a stable machine-readable code. The message
 * is safe to show a user; anything sensitive belongs in `internal`, which is
 * logged but never serialised to the client.
 */
export class AppError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly internal?: unknown,
  ) {
    super(message)
    this.name = 'AppError'
  }
}

export const badRequest = (message: string, code = 'bad_request') =>
  new AppError(400, code, message)

/**
 * Authentication failures are deliberately uniform. Distinguishing "no such
 * user" from "wrong password" hands an attacker a user-enumeration oracle.
 */
export const unauthorized = (message = 'Authentication required.', code = 'unauthorized') =>
  new AppError(401, code, message)

export const forbidden = (message = 'You do not have access to this.', code = 'forbidden') =>
  new AppError(403, code, message)

export const notFound = (message = 'Not found.', code = 'not_found') =>
  new AppError(404, code, message)

export const conflict = (message: string, code = 'conflict') =>
  new AppError(409, code, message)

export const tooManyRequests = (message = 'Too many attempts. Try again shortly.') =>
  new AppError(429, 'too_many_requests', message)
