import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { DomainError } from '@saheli/domain';
import type { Request, Response } from 'express';

/**
 * An expected failure with a stable machine-readable code. Throw this from
 * services instead of Nest's HttpException so clients get consistent errors.
 */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

/** HTTP status for domain rule violations; unlisted codes are 422. */
const DOMAIN_STATUS: Record<string, number> = {
  INVALID_PHONE: HttpStatus.BAD_REQUEST,
  UNSUPPORTED_COUNTRY: HttpStatus.BAD_REQUEST,
  INVALID_ARGUMENT: HttpStatus.BAD_REQUEST,
  INVALID_AMOUNT: HttpStatus.BAD_REQUEST,
  INVALID_RIDE_TRANSITION: HttpStatus.CONFLICT,
  RIDE_ALREADY_IN_STATUS: HttpStatus.CONFLICT,
  TRANSITION_NOT_PERMITTED: HttpStatus.FORBIDDEN,
};

const HTTP_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHENTICATED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  405: 'METHOD_NOT_ALLOWED',
  409: 'CONFLICT',
  413: 'PAYLOAD_TOO_LARGE',
  415: 'UNSUPPORTED_MEDIA_TYPE',
  422: 'UNPROCESSABLE',
  429: 'RATE_LIMITED',
};

export interface ErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

/** Every error leaves the API as `{ error: { code, message, details?, requestId } }`. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('Errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request & { id?: string }>();
    const requestId = req.id ? String(req.id) : undefined;

    let status: number = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_ERROR';
    let message = 'Something went wrong. Please try again.';
    let details: unknown;

    if (exception instanceof AppError) {
      ({ status, code, message, details } = exception);
    } else if (exception instanceof DomainError) {
      status = DOMAIN_STATUS[exception.code] ?? HttpStatus.UNPROCESSABLE_ENTITY;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      code = HTTP_CODES[status] ?? 'HTTP_ERROR';
      const response = exception.getResponse();
      if (status === HttpStatus.BAD_REQUEST && typeof response === 'object' && response) {
        const validation = (response as { message?: unknown }).message;
        if (Array.isArray(validation)) {
          code = 'VALIDATION_FAILED';
          message = 'Some fields are invalid';
          details = validation;
        } else {
          message = exception.message;
        }
      } else {
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error({ err: exception, requestId }, 'Unhandled error');
    }

    const body: ErrorBody = { error: { code, message, details, requestId } };
    res.status(status).json(body);
  }
}
