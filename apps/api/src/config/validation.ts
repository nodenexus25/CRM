import { z } from 'zod';

/**
 * Boot-time environment contract.
 *
 * The process refuses to start when this fails, so a misconfigured deployment
 * fails fast at deploy time instead of at the first request.
 */
export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

    APP_NAME: z.string().trim().min(1).default('TalentFlow'),
    APP_URL: z.string().trim().url().default('http://localhost:3000'),
    API_URL: z.string().trim().url().default('http://localhost:4000'),
    API_PREFIX: z.string().trim().min(1).default('api/v1'),
    WEB_ORIGIN: z.string().trim().default('http://localhost:3000'),
    ROOT_DOMAIN: z.string().trim().default('talentflow.app'),
    PORT: z.coerce.number().int().min(1).max(65535).default(4000),

    DATABASE_URL: z.string().trim().min(1, 'DATABASE_URL is required'),
    REDIS_URL: z.string().trim().min(1).default('redis://localhost:6380'),

    S3_ENDPOINT: z.string().trim().url().default('http://localhost:9020'),
    S3_REGION: z.string().trim().default('us-east-1'),
    S3_ACCESS_KEY: z.string().trim().min(1).default('talentflow'),
    S3_SECRET_KEY: z.string().trim().min(1).default('talentflow123'),
    S3_BUCKET: z.string().trim().min(1).default('talentflow-files'),
    S3_FORCE_PATH_STYLE: z.coerce.boolean().default(true),
    S3_PUBLIC_URL: z.string().trim().default('http://localhost:9020'),
    S3_SIGNED_URL_TTL: z.coerce.number().int().min(60).max(86400).default(900),

    JWT_ACCESS_SECRET: z.string().trim().min(32, 'JWT_ACCESS_SECRET must be at least 32 characters'),
    JWT_REFRESH_SECRET: z.string().trim().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
    JWT_ACCESS_TTL: z.string().trim().default('15m'),
    JWT_REFRESH_TTL: z.string().trim().default('30d'),

    ARGON2_MEMORY_COST: z.coerce.number().int().min(8192).default(19456),
    ARGON2_TIME_COST: z.coerce.number().int().min(1).max(10).default(2),
    ARGON2_PARALLELISM: z.coerce.number().int().min(1).max(8).default(1),

    COOKIE_DOMAIN: z.string().trim().default('localhost'),
    COOKIE_SECURE: z.coerce.boolean().default(false),

    SMTP_HOST: z.string().trim().default('localhost'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(1035),
    SMTP_SECURE: z.coerce.boolean().default(false),
    SMTP_USER: z.string().trim().optional(),
    SMTP_PASSWORD: z.string().trim().optional(),
    MAIL_FROM: z.string().trim().default('TalentFlow <no-reply@talentflow.local>'),
    MAILPIT_UI_URL: z.string().trim().default('http://localhost:8035'),

    THROTTLE_TTL: z.coerce.number().int().min(1).default(60),
    THROTTLE_LIMIT: z.coerce.number().int().min(1).default(120),
    THROTTLE_AUTH_TTL: z.coerce.number().int().min(1).default(60),
    THROTTLE_AUTH_LIMIT: z.coerce.number().int().min(1).default(10),

    STRIPE_SECRET_KEY: z.string().trim().optional(),
    STRIPE_WEBHOOK_SECRET: z.string().trim().optional(),
    RAZORPAY_KEY_ID: z.string().trim().optional(),
    RAZORPAY_KEY_SECRET: z.string().trim().optional(),

    LLM_PROVIDER: z.enum(['openai', 'anthropic', 'regex', 'none']).default('regex'),
    LLM_API_KEY: z.string().trim().optional(),
    LLM_MODEL: z.string().trim().default('gpt-4o-mini'),
    LLM_BASE_URL: z.string().trim().default('https://api.openai.com/v1'),

    SEED_DEMO_EMAIL: z.string().trim().default('admin@acme-demo.test'),
    SEED_DEMO_PASSWORD: z.string().trim().default('Passw0rd!23'),
  })
  .superRefine((env, ctx) => {
    if (env.NODE_ENV !== 'production') return;

    const forbidden = ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET'] as const;
    for (const key of forbidden) {
      if (env[key].includes('dev-only') || env[key].includes('change-me')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [key],
          message: `${key} still contains the development placeholder — set a real secret in production`,
        });
      }
    }
    if (!env.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message: 'COOKIE_SECURE must be true in production',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

/** Used by `ConfigModule.forRoot({ validate })`. */
export function validateEnv(raw: Record<string, unknown>): Env {
  const result = envSchema.safeParse(raw);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  • ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
