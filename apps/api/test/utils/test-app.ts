import { RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import type { Server } from 'node:http';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from '@/app.module';
import { requestContextMiddleware } from '@/common/middleware/request-context.middleware';
import type { AppConfig } from '@/config/configuration';
import { PrismaService } from '@/infra/prisma/prisma.service';

export interface TestApp {
  app: NestExpressApplication;
  prisma: PrismaService;
  /** The underlying HTTP server, for supertest. */
  server: Server;
  /** Versioned prefix every request path must carry, e.g. `api/v1`. */
  prefix: string;
  close(): Promise<void>;
}

/**
 * Boots the real `AppModule` in-process.
 *
 * Only the parts of `main.ts` that affect request semantics are reproduced —
 * cookie parsing, the `AsyncLocalStorage` request context and the global
 * prefix. Guards, interceptors and the exception filter come from `AppModule`
 * itself, so the suite exercises the same pipeline production does, not a
 * mock of it.
 */
export async function createTestApp(): Promise<TestApp> {
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();

  const app = moduleRef.createNestApplication<NestExpressApplication>({ logger: false });

  app.use(cookieParser());
  app.use(requestContextMiddleware);

  const config = app.get(ConfigService<AppConfig, true>);
  const prefix = config.get('apiPrefix', { infer: true });

  app.setGlobalPrefix(prefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  await app.init();

  return {
    app,
    prisma: app.get(PrismaService),
    server: app.getHttpServer() as Server,
    prefix,
    async close() {
      await app.close();
    },
  };
}

/** Builds a request path inside the versioned prefix. */
export function apiPath(prefix: string, path: string): string {
  const suffix = path.startsWith('/') ? path : `/${path}`;
  return `/${prefix}${suffix}`;
}
