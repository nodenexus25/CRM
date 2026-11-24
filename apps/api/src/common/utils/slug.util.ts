/**
 * Derives a workspace slug from a company name.
 *
 * Accents are stripped so "Café Recruiting" becomes `cafe-recruiting` rather
 * than losing the word entirely.
 */
export function slugify(value: string): string {
  const base = value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return base.length >= 2 ? base : `workspace-${Math.random().toString(36).slice(2, 8)}`;
}

/** Appends a numeric suffix until the candidate is no longer taken. */
export function withSuffix(slug: string, attempt: number): string {
  return attempt === 0 ? slug : `${slug.slice(0, 44)}-${attempt}`;
}
