/**
 * `@talentflow/types` — the shared contract between `apps/api` and `apps/web`.
 *
 * Everything here is runtime-validated with Zod on the API boundary and reused
 * for form validation on the client, so request/response shapes can never drift.
 */

export * from './common';
export * from './auth';
export * from './tenant';
export * from './user';
export * from './role';
export * from './permissions';
export * from './enums';
export * from './search';
export * from './saved-search';
export * from './pipeline';
export * from './client';
export * from './job';
export * from './candidate';
export * from './application';
export * from './submission';
export * from './interview';
export * from './offer';
export * from './placement';
export * from './activity';
export * from './task';
export * from './note';
export * from './email';
export * from './bulk';
export * from './import';
export * from './resume';
