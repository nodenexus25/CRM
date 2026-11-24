// Must be first: loads `.env` before any module reads `process.env` at import
// time (per-route rate limits are baked into decorators when controllers are
// defined).
import './env';

import { Logger, RequestMethod } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import type { NestExpressApplication } from '@nestjs/platform-express';

import { AppModule } from './app.module';
import { REQUEST_ID_HEADER, requestContextMiddleware } from './common/middleware/request-context.middleware';
import type { AppConfig } from './config/configuration';

const SERVICE_VERSION = process.env.APP_VERSION ?? '0.1.0';

async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create<NestExpressApplication>(AppModule);

  const config = app.get(ConfigService<AppConfig, true>);
  const appName = config.get('appName', { infer: true });
  const apiPrefix = config.get('apiPrefix', { infer: true });
  const apiUrl = config.get('apiUrl', { infer: true });
  const webOrigin = config.get('webOrigin', { infer: true });
  const port = config.get('port', { infer: true });
  const isProduction = config.get('isProduction', { infer: true });
  const cookie = config.get('cookie', { infer: true });

  // Behind a load balancer the client IP is in `X-Forwarded-For`; the rate
  // limiter and the audit trail both key off it.
  app.set('trust proxy', 1);

  app.use(
    helmet({
      // The API answers with JSON; the CSP that matters belongs to the web app.
      // Swagger UI at `/api/docs` needs inline scripts, which the default
      // policy blocks.
      contentSecurityPolicy: false,
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );

  // Populates `req.cookies`, which the auth guards and CSRF guard both read.
  app.use(cookieParser());

  // Opens layer 1 of tenant isolation: an `AsyncLocalStorage` context that the
  // guards hydrate and the Prisma extension reads.
  app.use(requestContextMiddleware);

  const allowedOrigins = webOrigin
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);

  app.enableCors({
    origin: allowedOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      cookie.csrfHeader,
      'X-Tenant-Id',
      REQUEST_ID_HEADER,
    ],
    exposedHeaders: [REQUEST_ID_HEADER],
    maxAge: 86_400,
  });

  // Probes are mounted outside the versioned surface: an orchestrator should
  // never have to know which API version is deployed.
  app.setGlobalPrefix(apiPrefix, {
    exclude: [
      { path: 'health', method: RequestMethod.GET },
      { path: 'health/ready', method: RequestMethod.GET },
    ],
  });

  if (!isProduction) {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle(`${appName} API`)
        .setDescription('Multi-tenant ATS + Recruitment CRM — REST API')
        .setVersion(SERVICE_VERSION)
        .addCookieAuth(cookie.accessName, { type: 'apiKey', in: 'cookie' }, 'session')
        .addBearerAuth({ type: 'http', scheme: 'bearer', bearerFormat: 'JWT' }, 'bearer')
        .build(),
    );

    SwaggerModule.setup('api/docs', app, document, {
      useGlobalPrefix: false,
      jsonDocumentUrl: 'api/docs-json',
      swaggerOptions: { persistAuthorization: true, withCredentials: true },
    });
  }

  app.enableShutdownHooks();

  await app.listen(port, '0.0.0.0');

  logger.log(`${appName} API v${SERVICE_VERSION} listening on ${apiUrl}/${apiPrefix}`);
  logger.log(`Allowed web origins: ${allowedOrigins.join(', ') || '(none configured)'}`);
  if (!isProduction) {
    logger.log(`OpenAPI docs: ${apiUrl.replace(/\/$/, '')}/api/docs`);
  }
}

void bootstrap();
