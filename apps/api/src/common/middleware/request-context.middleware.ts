import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import { createRequestContext, requestContext, type RequestContext } from '../request-context';

/** Header used to correlate logs and error envelopes across services. */
export const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express-serve-static-core' {
  interface Request {
    /** Populated by `requestContextMiddleware`, hydrated further by the guards. */
    requestContext?: RequestContext;
  }
}

/**
 * Entry point of layer 1 of tenant isolation.
 *
 * Every request gets an `AsyncLocalStorage` context before it reaches a guard,
 * interceptor, or service. The auth guards later `patch` this context with the
 * tenant and user once the token has been verified, which is what the Prisma
 * extension reads to scope queries.
 */
export function requestContextMiddleware(req: Request, res: Response, next: NextFunction): void {
  const headerValue = req.headers[REQUEST_ID_HEADER];
  const requestId = (Array.isArray(headerValue) ? headerValue[0] : headerValue) ?? randomUUID();

  res.setHeader(REQUEST_ID_HEADER, requestId);

  const context = createRequestContext({
    requestId,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  req.requestContext = context;

  requestContext.run(context, () => {
    next();
  });
}
