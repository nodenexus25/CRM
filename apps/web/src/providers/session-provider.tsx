'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  type ReactNode,
} from 'react';

import type { AuthSessionResponse, SessionTenant, SessionUser } from '@talentflow/types';

import { api } from '@/lib/api-client';
import { queryKeys } from '@/lib/query-keys';

interface SessionContextValue {
  user: SessionUser | null;
  tenant: SessionTenant | null;
  availableTenants: SessionTenant[];
  permissions: string[];
  /** True until the first `/auth/session` response lands. */
  isPending: boolean;
  isAuthenticated: boolean;
  /** Permission check against the effective set the API returned. */
  has: (permission: string) => boolean;
  hasAny: (...permissions: string[]) => boolean;
  hasAll: (...permissions: string[]) => boolean;
  refetch: () => Promise<void>;
  logout: () => Promise<void>;
  switchTenant: (tenantId: string) => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

/**
 * Holds the signed-in user, active workspace and effective permissions.
 *
 * The API is the only authority on permissions: the client mirrors the set it
 * returned so menus and buttons can be hidden, but never treats that as
 * authorisation — every write is still checked server-side.
 */
export function SessionProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const query = useQuery({
    queryKey: queryKeys.session,
    queryFn: () => api.get<AuthSessionResponse>('/auth/session'),
    staleTime: 60_000,
    retry: false,
  });

  const refetch = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: queryKeys.session });
  }, [queryClient]);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // A failed revoke must not trap the user in a signed-in shell.
    }
    queryClient.clear();
    router.replace('/login');
  }, [queryClient, router]);

  const switchTenant = useCallback(
    async (tenantId: string) => {
      await api.post('/auth/switch-tenant', { tenantId });
      queryClient.clear();
      router.replace('/dashboard');
    },
    [queryClient, router],
  );

  const value = useMemo<SessionContextValue>(() => {
    const permissions = query.data?.user.permissions ?? [];
    const granted = new Set(permissions);

    return {
      user: query.data?.user ?? null,
      tenant: query.data?.tenant ?? null,
      availableTenants: query.data?.availableTenants ?? [],
      permissions,
      isPending: query.isPending,
      isAuthenticated: Boolean(query.data),
      has: (permission: string) => granted.has(permission),
      hasAny: (...keys: string[]) => keys.some((key) => granted.has(key)),
      hasAll: (...keys: string[]) => keys.every((key) => granted.has(key)),
      refetch,
      logout,
      switchTenant,
    };
  }, [logout, query.data, query.isPending, refetch, switchTenant]);

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>.');
  return context;
}
