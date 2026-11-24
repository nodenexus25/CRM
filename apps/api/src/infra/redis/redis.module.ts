import { Global, Module } from '@nestjs/common';

import { REDIS_CLIENT } from './redis.constants';
import { RedisService } from './redis.service';
import { ThrottlerRedisStorage } from './throttler-redis.storage';

@Global()
@Module({
  providers: [
    RedisService,
    ThrottlerRedisStorage,
    { provide: REDIS_CLIENT, useExisting: RedisService },
  ],
  exports: [RedisService, ThrottlerRedisStorage, REDIS_CLIENT],
})
export class RedisModule {}
