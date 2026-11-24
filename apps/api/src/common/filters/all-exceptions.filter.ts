import {
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

import { ERROR_CODES, type ApiErrorBody, type ErrorCode, type NextAction } from '@talentflow/types';

import { AppError } from '../errors/domain-errors';

interface NormalisedError {
  status: number;
  code: ErrorCode;
  message: string;
  details?: unknown;
  nextAction?: NextAction;
  /** Set for unexpected failures so they are logged with a stack trace. */
  unexpected?: unknown;
}

const HTTP_STATUS_TO_CODE: Record<number, ErrorCode> = {
  [HttpStatus.BAD_REQUEST]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.UNAUTHORIZED]: ERROR_CODES.UNAUTHENTICATED,
  [HttpStatus.FORBIDDEN]: ERROR_CODES.FORBIDDEN,
  [HttpStatus.NOT_FOUND]: ERROR_CODES.NOT_FOUND,
  [HttpStatus.CONFLICT]: ERROR_CODES.CONFLICT,
  [HttpStatus.GONE]: ERROR_CODES.TOKEN_EXPIRED,
  [HttpStatus.PAYLOAD_TOO_LARGE]: ERROR_CODES.PAYLOAD_TOO_LARGE,
  [HttpStatus.UNSUPPORTED_MEDIA_TYPE]: ERROR_CODES.UNSUPPORTED_MEDIA_TYPE,
  [HttpStatus.TOO_MANY_REQUESTS]: ERROR_CODES.RATE_LIMITED,
  [HttpStatus.UNPROCESSABLE_ENTITY]: ERROR_CODES.VALIDATION_FAILED,
  [HttpStatus.SERVICE_UNAVAILABLE]: ERROR_CODES.SERVICE_UNAVAILABLE,
};

/**
 * Converts every failure into the single error envelope defined in
 * `packages/types`, so clients only ever branch on `code`.
 *
 * Deliberate `AppError`s pass through untouched. Unexpected errors are logged
 * with a stack trace and reported generically — internals never leak.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    const normalised = this.normalise(exception);

    if (normalised.unexpected) {
      this.logger.error(
        `${request.method} ${request.url} failed: ${normalised.message}`,
        normalised.unexpected instanceof Error
          ? normalised.unexpected.stack
          : String(normalised.unexpected),
      );
    } else if (normalised.status >= 500) {
      this.logger.error(`${request.method} ${request.url} → ${normalised.code}: ${normalised.message}`);
    }

    const body: ApiErrorBody = {
      statusCode: normalised.status,
      code: normalised.code,
      message: normalised.message,
      details: normalised.details,
      nextAction: normalised.nextAction,
      requestId: request.requestContext?.requestId,
      timestamp: new Date().toISOString(),
      path: request.url,
    };

    if (response.headersSent) return;
    response.status(normalised.status).json(body);
  }

  private normalise(exception: unknown): NormalisedError {
    if (exception instanceof AppError) {
      return {
        status: exception.status,
        code: exception.code,
        message: exception.message,
        details: exception.details,
        nextAction: exception.nextAction,
      };
    }

    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        code: ERROR_CODES.VALIDATION_FAILED,
        message: 'The submitted data is invalid',
        details: exception.issues.map((issue) => ({
          path: issue.path.join('.'),
          message: issue.message,
          code: issue.code,
        })),
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      return this.fromPrisma(exception);
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const payload = exception.getResponse();
      const message =
        typeof payload === 'string'
          ? payload
          : ((payload as { message?: string | string[] }).message ?? exception.message);

      return {
        status,
        code: HTTP_STATUS_TO_CODE[status] ?? ERROR_CODES.INTERNAL_ERROR,
        message: Array.isArray(message) ? message.join(', ') : message,
        details: typeof payload === 'string' ? undefined : payload,
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: ERROR_CODES.INTERNAL_ERROR,
      message: 'Something went wrong on our side. Please try again.',
      unexpected: exception,
    };
  }

  private fromPrisma(exception: Prisma.PrismaClientKnownRequestError): NormalisedError {
    switch (exception.code) {
      case 'P2002': {
        const target = exception.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : String(target ?? 'value');
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: `A record with this ${fields} already exists`,
          details: { fields },
        };
      }
      case 'P2025':
        return {
          status: HttpStatus.NOT_FOUND,
          code: ERROR_CODES.NOT_FOUND,
          message: 'That record no longer exists',
        };
      case 'P2003':
        return {
          status: HttpStatus.CONFLICT,
          code: ERROR_CODES.CONFLICT,
          message: 'That action references a record that does not exist',
        };
      default:
        return {
          status: HttpStatus.INTERNAL_SERVER_ERROR,
          code: ERROR_CODES.INTERNAL_ERROR,
          message: 'Something went wrong on our side. Please try again.',
          details: { prismaCode: exception.code },
          unexpected: exception,
        };
    }
  }
}
