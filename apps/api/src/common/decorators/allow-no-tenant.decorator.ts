import { SetMetadata } from '@nestjs/common';

export const NO_TENANT_KEY = 'tenant:notRequired';

/**
 * Marks a route that legitimately runs without a workspace — signup, login,
 * password reset, health checks and the super-admin platform endpoints.
 *
 * `TenantGuard` blocks every tenant-scoped route that reaches it without a
 * resolved tenant, so this decorator is the single, auditable list of
 * exceptions. It does not disable authentication.
 */
export const AllowNoTenant = () => SetMetadata(NO_TENANT_KEY, true);
