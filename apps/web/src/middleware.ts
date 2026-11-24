import { NextResponse, type NextRequest } from 'next/server';

import { env } from '@/lib/env';

/** Names match `COOKIE_NAMES` in the API config. */
const ACCESS_COOKIE = 'tf_at';
const REFRESH_COOKIE = 'tf_rt';

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/jobs',
  '/candidates',
  '/clients',
  '/submissions',
  '/users',
  '/roles',
  '/teams',
  '/settings',
] as const;

/** Signed-in users are bounced away from these. */
const GUEST_ONLY_ROUTES = ['/login', '/signup'] as const;

function matchesPrefix(pathname: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}

/**
 * Edge guard for the workspace routes.
 *
 * This only checks that a session cookie is *present* — it cannot verify a
 * signature at the edge, and it must never be treated as authorisation. The
 * API re-authenticates and re-authorises every request; this exists so an
 * anonymous visitor gets a login screen instead of a shell that flashes empty
 * for a round trip.
 */
export function middleware(request: NextRequest): NextResponse {
  const { pathname, search } = request.nextUrl;
  const hasSessionCookie =
    Boolean(request.cookies.get(ACCESS_COOKIE)?.value) || Boolean(request.cookies.get(REFRESH_COOKIE)?.value);

  if (!hasSessionCookie && matchesPrefix(pathname, PROTECTED_PREFIXES)) {
    const url = request.nextUrl.clone();
    url.pathname = '/login';
    url.search = '';
    if (pathname !== '/dashboard') {
      url.searchParams.set('next', `${pathname}${search}`);
    }
    return NextResponse.redirect(url);
  }

  if (hasSessionCookie && matchesPrefix(pathname, GUEST_ONLY_ROUTES)) {
    const url = request.nextUrl.clone();
    url.pathname = '/dashboard';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!api|_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml|.*\\..*).*)'],
};

/** Re-exported for tests and for `next.config` parity checks. */
export const ROUTE_GUARD = { PROTECTED_PREFIXES, GUEST_ONLY_ROUTES, rootDomain: env.rootDomain } as const;
