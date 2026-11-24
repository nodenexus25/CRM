/** Header a super admin sends to act inside another tenant. */
export const IMPERSONATION_HEADER = 'x-tenant-id';

/** Reads a possibly-repeated header as a single trimmed value. */
export function readHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string,
): string | undefined {
  const raw = headers[name];
  const value = Array.isArray(raw) ? raw[0] : raw;
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
