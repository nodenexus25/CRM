import type { Env } from './validation';

/**
 * Nested, typed view of the environment. `ConfigService<AppConfig, true>` uses
 * this shape so reads are checked at compile time.
 */
export interface AppConfig {
  nodeEnv: Env['NODE_ENV'];
  isProduction: boolean;
  isDevelopment: boolean;
  isTest: boolean;
  appName: string;
  appUrl: string;
  apiUrl: string;
  apiPrefix: string;
  webOrigin: string;
  rootDomain: string;
  port: number;

  database: { url: string };
  redis: { url: string };

  storage: {
    endpoint: string;
    region: string;
    accessKey: string;
    secretKey: string;
    bucket: string;
    forcePathStyle: boolean;
    publicUrl: string;
    signedUrlTtl: number;
  };

  jwt: {
    accessSecret: string;
    refreshSecret: string;
    accessTtl: string;
    refreshTtl: string;
  };

  argon2: { memoryCost: number; timeCost: number; parallelism: number };

  cookie: {
    domain: string;
    secure: boolean;
    accessName: string;
    refreshName: string;
    csrfName: string;
    csrfHeader: string;
  };

  mail: {
    host: string;
    port: number;
    secure: boolean;
    user?: string;
    password?: string;
    from: string;
    mailpitUiUrl: string;
  };

  throttle: { ttl: number; limit: number; authTtl: number; authLimit: number };

  billing: {
    stripeSecretKey?: string;
    stripeWebhookSecret?: string;
    razorpayKeyId?: string;
    razorpayKeySecret?: string;
  };

  ai: {
    provider: 'openai' | 'anthropic' | 'regex' | 'none';
    apiKey?: string;
    model: string;
    baseUrl: string;
  };

  seed: { demoEmail: string; demoPassword: string };
}

/** Cookie names are fixed constants shared with the web app's BFF routes. */
export const COOKIE_NAMES = {
  access: 'tf_at',
  refresh: 'tf_rt',
  csrf: 'tf_csrf',
} as const;

export const CSRF_HEADER = 'x-csrf-token';

export function configuration(): AppConfig {
  // `ConfigModule` validated and stored the parsed env before this factory runs.
  const env = process.env as unknown as Record<string, string | undefined>;
  const nodeEnv = (env.NODE_ENV ?? 'development') as AppConfig['nodeEnv'];

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isDevelopment: nodeEnv === 'development',
    isTest: nodeEnv === 'test',
    appName: env.APP_NAME ?? 'TalentFlow',
    appUrl: env.APP_URL ?? 'http://localhost:3000',
    apiUrl: env.API_URL ?? 'http://localhost:4000',
    apiPrefix: env.API_PREFIX ?? 'api/v1',
    webOrigin: env.WEB_ORIGIN ?? 'http://localhost:3000',
    rootDomain: env.ROOT_DOMAIN ?? 'talentflow.app',
    port: Number(env.PORT ?? 4000),

    database: { url: env.DATABASE_URL ?? '' },
    redis: { url: env.REDIS_URL ?? 'redis://localhost:6380' },

    storage: {
      endpoint: env.S3_ENDPOINT ?? 'http://localhost:9020',
      region: env.S3_REGION ?? 'us-east-1',
      accessKey: env.S3_ACCESS_KEY ?? 'talentflow',
      secretKey: env.S3_SECRET_KEY ?? 'talentflow123',
      bucket: env.S3_BUCKET ?? 'talentflow-files',
      forcePathStyle: env.S3_FORCE_PATH_STYLE !== 'false',
      publicUrl: env.S3_PUBLIC_URL ?? env.S3_ENDPOINT ?? 'http://localhost:9020',
      signedUrlTtl: Number(env.S3_SIGNED_URL_TTL ?? 900),
    },

    jwt: {
      accessSecret: env.JWT_ACCESS_SECRET ?? '',
      refreshSecret: env.JWT_REFRESH_SECRET ?? '',
      accessTtl: env.JWT_ACCESS_TTL ?? '15m',
      refreshTtl: env.JWT_REFRESH_TTL ?? '30d',
    },

    argon2: {
      memoryCost: Number(env.ARGON2_MEMORY_COST ?? 19456),
      timeCost: Number(env.ARGON2_TIME_COST ?? 2),
      parallelism: Number(env.ARGON2_PARALLELISM ?? 1),
    },

    cookie: {
      domain: env.COOKIE_DOMAIN ?? 'localhost',
      secure: env.COOKIE_SECURE === 'true',
      accessName: COOKIE_NAMES.access,
      refreshName: COOKIE_NAMES.refresh,
      csrfName: COOKIE_NAMES.csrf,
      csrfHeader: CSRF_HEADER,
    },

    mail: {
      host: env.SMTP_HOST ?? 'localhost',
      port: Number(env.SMTP_PORT ?? 1035),
      secure: env.SMTP_SECURE === 'true',
      user: env.SMTP_USER || undefined,
      password: env.SMTP_PASSWORD || undefined,
      from: env.MAIL_FROM ?? 'TalentFlow <no-reply@talentflow.local>',
      mailpitUiUrl: env.MAILPIT_UI_URL ?? 'http://localhost:8035',
    },

    throttle: {
      ttl: Number(env.THROTTLE_TTL ?? 60),
      limit: Number(env.THROTTLE_LIMIT ?? 120),
      authTtl: Number(env.THROTTLE_AUTH_TTL ?? 60),
      authLimit: Number(env.THROTTLE_AUTH_LIMIT ?? 10),
    },

    billing: {
      stripeSecretKey: env.STRIPE_SECRET_KEY || undefined,
      stripeWebhookSecret: env.STRIPE_WEBHOOK_SECRET || undefined,
      razorpayKeyId: env.RAZORPAY_KEY_ID || undefined,
      razorpayKeySecret: env.RAZORPAY_KEY_SECRET || undefined,
    },

    ai: {
      provider: (env.LLM_PROVIDER as AppConfig['ai']['provider']) ?? 'regex',
      apiKey: env.LLM_API_KEY || undefined,
      model: env.LLM_MODEL ?? 'gpt-4o-mini',
      baseUrl: env.LLM_BASE_URL ?? 'https://api.openai.com/v1',
    },

    seed: {
      demoEmail: env.SEED_DEMO_EMAIL ?? 'admin@acme-demo.test',
      demoPassword: env.SEED_DEMO_PASSWORD ?? 'Passw0rd!23',
    },
  };
}
