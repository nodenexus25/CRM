/**
 * Loads `.env` files before the module graph is imported.
 *
 * `main.ts` imports this module first. `@nestjs/config` re-reads and validates
 * the same files for typed access inside the DI container, but a handful of
 * decisions — per-route rate limits, for instance — are baked into decorators
 * when the controller class is defined, which happens during that import.
 * Reading the environment at that point keeps those values configurable.
 */
import { config } from 'dotenv';

config({ path: ['.env.local', '.env', '../../.env'], quiet: true });
