import { Global, Module } from '@nestjs/common';
import { ConfigModule as NestConfigModule } from '@nestjs/config';

import { configuration } from './configuration';
import { validateEnv } from './validation';

/**
 * Wraps `@nestjs/config` so the rest of the app injects a typed `AppConfig`.
 *
 * Paths are relative to the API's working directory (`apps/api`), which is how
 * pnpm and the Docker image both launch it. Real deployments supply the same
 * variables through the environment, so the files are simply absent there.
 */
@Global()
@Module({
  imports: [
    NestConfigModule.forRoot({
      isGlobal: true,
      cache: true,
      expandVariables: true,
      envFilePath: ['.env.local', '.env', '../../.env'],
      load: [configuration],
      validate: validateEnv,
    }),
  ],
  exports: [NestConfigModule],
})
export class AppConfigModule {}
