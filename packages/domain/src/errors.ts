/**
 * Raised when a business rule is violated. The API maps `code` to an HTTP status
 * and returns it to clients, so codes are part of the public contract.
 */
export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
