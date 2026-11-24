import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Per-request context propagated through `AsyncLocalStorage`.
 *
 * The tenant-scoping Prisma extension reads `tenantId` from here, which is what
 * makes cross-tenant leakage structurally impossible: a query issued outside a
 * tenant context throws instead of silently returning every row.
 */
export interface RequestContext {
  requestId: string;
  /** Tenant the request is scoped to. Absent for anonymous/platform requests. */
  tenantId?: string;
  userId?: string;
  /** True when the authenticated user holds `SUPER_ADMIN`. */
  isSuperAdmin: boolean;
  /** True when a super admin is acting inside another tenant. */
  isImpersonating: boolean;
  /**
   * Explicit opt-out from tenant scoping. Only platform maintenance jobs set
   * this, and only through `PrismaService.asSystem()`.
   */
  bypassTenant: boolean;
  /** Permissions resolved for the current user, used by `AuditInterceptor`. */
  permissions: readonly string[];
  /**
   * How the request proved its identity. Cookie-authenticated writes require a
   * CSRF token; bearer-token calls do not, because nothing is sent ambiently.
   */
  authMethod?: 'cookie' | 'bearer';
  ip?: string;
  userAgent?: string;
}

const storage = new AsyncLocalStorage<RequestContext>();

export const requestContext = {
  run<T>(context: RequestContext, callback: () => T): T {
    return storage.run(context, callback);
  },

  get(): RequestContext | undefined {
    return storage.getStore();
  },

  getOrThrow(): RequestContext {
    const context = storage.getStore();
    if (!context) {
      throw new Error(
        'No request context is active. Wrap the work in `requestContext.run(...)` or `PrismaService.asSystem(...)`.',
      );
    }
    return context;
  },

  /**
   * Runs `callback` inside a derived context pinned to `tenantId`, inheriting
   * the request id, ip and user agent. Used by flows that discover the tenant
   * mid-request — signup, login, verify-email — where the tenant-scoped writes
   * only become possible once the tenant is known.
   *
   * The callback is awaited *inside* the storage scope on purpose. Prisma query
   * builders are lazy thenables: a callback such as `() => prisma.user.update(…)`
   * does not run the query until someone awaits it. Awaiting it here means the
   * tenancy extension still sees the tenant; returning the bare thenable would
   * let it resolve after the scope has closed and the extension would (rightly)
   * block the write as unscoped.
   */
  runInTenant<T>(tenantId: string, callback: () => Promise<T>): Promise<T> {
    const current = storage.getStore() ?? createRequestContext();
    return storage.run({ ...current, tenantId, bypassTenant: false }, async () => callback());
  },

  /** Mutates the active context — used after authentication resolves. */
  patch(partial: Partial<RequestContext>): void {
    const context = storage.getStore();
    if (!context) return;
    Object.assign(context, partial);
  },

  get tenantId(): string | undefined {
    return storage.getStore()?.tenantId;
  },

  get userId(): string | undefined {
    return storage.getStore()?.userId;
  },
};

export function createRequestContext(partial: Partial<RequestContext> = {}): RequestContext {
  return {
    requestId: partial.requestId ?? 'system',
    isSuperAdmin: partial.isSuperAdmin ?? false,
    isImpersonating: partial.isImpersonating ?? false,
    bypassTenant: partial.bypassTenant ?? false,
    permissions: partial.permissions ?? [],
    ...partial,
  };
}
