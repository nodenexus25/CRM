/**
 * Candidate search helpers: value normalisation for duplicate detection and a
 * parser that turns the recruiter-facing boolean query syntax
 * (`java AND (spring OR microservices) NOT junior`) into a Postgres `tsquery`.
 *
 * The parser exists so the query string is *built*, never concatenated from raw
 * user input: every lexeme is reduced to a safe character set and re-emitted in
 * tsquery quotes, so a crafted search cannot inject operators or escape into a
 * malformed `to_tsquery` (which would surface as a 500 rather than a 422).
 */

// ---------------------------------------------------------------------------
// Normalisation
// ---------------------------------------------------------------------------

/** Lower-cased, trimmed email — the form stored in `Candidate.emailNormalized`. */
export function normalizeEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Digits-only phone with an optional leading `+`. Formatting is presentation;
 * `+91 98765 43210` and `+919876543210` are the same human.
 */
export function normalizePhone(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 6) return null;
  return hasPlus ? `+${digits}` : digits;
}

/**
 * LinkedIn profile slug, lower-cased: `/in/ada-lovelace` from any of the
 * `https://www.linkedin.com/in/ada-lovelace/?trk=…` shapes people paste.
 */
export function normalizeLinkedin(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim().toLowerCase();
  if (trimmed.length === 0) return null;

  const match = /linkedin\.[a-z.]+\/(?:in|pub)\/([^/?#]+)/.exec(trimmed);
  const slug = match?.[1];
  if (slug) return slug.replace(/\/+$/, '');
  return trimmed.replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/[?#].*$/, '').replace(/\/+$/, '');
}

/**
 * Composite key used for the fast exact-duplicate lookup. Any of the three
 * identifiers is enough; they are separated so `ab` + `c` cannot collide with
 * `a` + `bc`.
 */
export function buildDedupeKey(parts: {
  email?: string | null;
  phone?: string | null;
  linkedinUrl?: string | null;
}): string | null {
  const segments = [normalizeEmail(parts.email), normalizePhone(parts.phone), normalizeLinkedin(parts.linkedinUrl)].filter(
    (segment): segment is string => Boolean(segment),
  );
  return segments.length > 0 ? segments.join('|') : null;
}

// ---------------------------------------------------------------------------
// Boolean search → tsquery
// ---------------------------------------------------------------------------

type Node =
  | { kind: 'term'; value: string }
  | { kind: 'phrase'; words: string[] }
  | { kind: 'not'; child: Node }
  | { kind: 'and'; children: Node[] }
  | { kind: 'or'; children: Node[] };

/**
 * Splits the query into keywords, quoted phrases and parentheses. `-term` is
 * kept as a separate `-` token so the parser can treat it as `NOT`.
 */
function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < input.length) {
    const char = input.charAt(index);

    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    if (char === '(' || char === ')') {
      tokens.push(char);
      index += 1;
      continue;
    }
    if (char === '"') {
      const end = input.indexOf('"', index + 1);
      tokens.push(`"${end === -1 ? input.slice(index + 1) : input.slice(index + 1, end)}"`);
      index = end === -1 ? input.length : end + 1;
      continue;
    }
    if (char === '-') {
      tokens.push('-');
      index += 1;
      continue;
    }
    if (char === '!' || char === '|' || char === '&') {
      tokens.push(char);
      index += 1;
      continue;
    }

    let end = index;
    while (end < input.length && !/[\s()"!|&-]/.test(input.charAt(end))) end += 1;
    if (end === index) {
      index += 1;
      continue;
    }
    tokens.push(input.slice(index, end));
    index = end;
  }

  return tokens;
}

/** Reduces a word to characters `to_tsquery` treats as an ordinary lexeme. */
function sanitizeWord(word: string): string | null {
  const cleaned = word.toLowerCase().replace(/[^a-z0-9_+#.]/g, '');
  return cleaned.length > 0 ? cleaned : null;
}

function toTerm(value: string): Node | null {
  const word = sanitizeWord(value);
  return word ? { kind: 'term', value: word } : null;
}

function toPhrase(value: string): Node | null {
  const words = value
    .split(/\s+/)
    .map(sanitizeWord)
    .filter((word): word is string => Boolean(word));
  if (words.length === 0) return null;
  const [first] = words;
  if (!first) return null;
  return words.length === 1 ? { kind: 'term', value: first } : { kind: 'phrase', words };
}

/**
 * Recursive-descent parser. `NOT` (or a leading `-` / `!`) binds tighter than
 * `AND`, which binds tighter than `OR`; adjacency is an implicit `AND`, matching
 * what people expect from a search box.
 */
function parse(tokens: string[]): Node | null {
  let position = 0;

  const peek = (): string | undefined => tokens[position];

  const parseOr = (): Node | null => {
    const children: Node[] = [];
    const first = parseAnd();
    if (first) children.push(first);
    while (peek()?.toUpperCase() === 'OR' || peek() === '|') {
      position += 1;
      const next = parseAnd();
      if (next) children.push(next);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? (children[0] ?? null) : { kind: 'or', children };
  };

  const parseAnd = (): Node | null => {
    const children: Node[] = [];
    const first = parseNot();
    if (first) children.push(first);
    for (;;) {
      const token = peek();
      if (token === undefined || token === ')' || token.toUpperCase() === 'OR' || token === '|') break;
      if (token.toUpperCase() === 'AND' || token === '&') {
        position += 1;
        const next = parseNot();
        if (next) children.push(next);
        continue;
      }
      const next = parseNot();
      if (!next) break;
      children.push(next);
    }
    if (children.length === 0) return null;
    return children.length === 1 ? (children[0] ?? null) : { kind: 'and', children };
  };

  const parseNot = (): Node | null => {
    const token = peek();
    if (token !== undefined && (token.toUpperCase() === 'NOT' || token === '-' || token === '!')) {
      position += 1;
      const child = parseNot();
      return child ? { kind: 'not', child } : null;
    }
    return parsePrimary();
  };

  const parsePrimary = (): Node | null => {
    const token = peek();
    if (token === undefined) return null;
    if (token === '(') {
      position += 1;
      const inner = parseOr();
      if (peek() === ')') position += 1;
      return inner;
    }
    if (token === ')') return null;
    position += 1;
    if (token.startsWith('"')) return toPhrase(token.slice(1, -1));
    return toTerm(token);
  };

  return parseOr();
}

function wrap(node: Node): string {
  return node.kind === 'and' || node.kind === 'or' ? `(${render(node)})` : render(node);
}

function render(node: Node): string {
  switch (node.kind) {
    case 'term':
      return `'${node.value}'`;
    case 'phrase':
      return node.words.map((word) => `'${word}'`).join(' <-> ');
    case 'not':
      return `!${wrap(node.child)}`;
    case 'and':
      return node.children.map(wrap).join(' & ');
    case 'or':
      return node.children.map(wrap).join(' | ');
  }
}

/**
 * Compiles a boolean search string into a Postgres `tsquery` literal, or `null`
 * when the input carries no usable terms (which callers treat as "no search").
 */
export function compileBooleanQuery(input: string | undefined): string | null {
  if (!input) return null;
  const tree = parse(tokenize(input));
  if (!tree) return null;
  const rendered = render(tree);
  return rendered.length > 0 ? rendered : null;
}
