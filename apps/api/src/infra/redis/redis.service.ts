import { Injectable, Logger, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

import type { AppConfig } from '@/config/configuration';

/** Thin lifecycle owner for the shared ioredis connection. */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis;

  constructor(config: ConfigService<AppConfig, true>) {
    const url = config.get('redis', { infer: true }).url;

    this.client = new Redis(url, {
      // BullMQ requires blocking commands to stay open indefinitely.
      maxRetriesPerRequest: null,
      enableReadyCheck: true,
      lazyConnect: false,
      retryStrategy: (attempt) => Math.min(attempt * 200, 3000),
    });

    this.client.on('error', (error: Error) => this.logger.error(`Redis error: ${error.message}`));
    this.client.on('ready', () => this.logger.log('Redis connection ready'));
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client.status !== 'end') {
      await this.client.quit().catch(() => undefined);
    }
  }

  /** Used by the health module. */
  async ping(): Promise<void> {
    await this.client.ping();
  }
}
