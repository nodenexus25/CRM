import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

/** Conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** `"Ada Lovelace"` → `"AL"` */
export function getInitials(value: string | null | undefined, max = 2): string {
  if (!value) return '';
  const parts = value.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '';
  if (parts.length === 1) return (parts[0] ?? '').slice(0, max).toUpperCase();
  return parts
    .slice(0, max)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase();
}

export function formatNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale).format(value);
}

export interface CurrencyOptions {
  /** Amount in major units (e.g. 1250.5 → $1,250.50). */
  amount: number;
  currency: string;
  locale?: string;
  maximumFractionDigits?: number;
  compact?: boolean;
}

export function formatCurrency({
  amount,
  currency,
  locale = 'en-US',
  maximumFractionDigits = 0,
  compact = false,
}: CurrencyOptions): string {
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    maximumFractionDigits,
    notation: compact ? 'compact' : 'standard',
  }).format(amount);
}

export function formatCompactNumber(value: number, locale = 'en-US'): string {
  return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
    value,
  );
}

type DateInput = Date | string | number | null | undefined;

function toDate(value: DateInput): Date | null {
  if (value === null || value === undefined) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Formats a date using the workspace's configured pattern.
 * Supports the four patterns the API allows in `Tenant.settings.dateFormat`.
 */
export function formatDate(
  value: DateInput,
  pattern = 'MM/DD/YYYY',
  timezone?: string,
  locale = 'en-US',
): string {
  const date = toDate(value);
  if (!date) return '—';

  const options: Intl.DateTimeFormatOptions = { timeZone: timezone, calendar: 'gregory' };
  switch (pattern) {
    case 'DD/MM/YYYY':
      return new Intl.DateTimeFormat('en-GB', { ...options, day: '2-digit', month: '2-digit', year: 'numeric' })
        .format(date)
        .replace(/\//g, '/');
    case 'YYYY-MM-DD': {
      const parts = new Intl.DateTimeFormat('en-CA', {
        ...options,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
      }).format(date);
      return parts;
    }
    case 'DD MMM YYYY':
      return new Intl.DateTimeFormat(locale, { ...options, day: '2-digit', month: 'short', year: 'numeric' })
        .format(date)
        .replace(',', '');
    case 'MM/DD/YYYY':
    default:
      return new Intl.DateTimeFormat('en-US', { ...options, month: '2-digit', day: '2-digit', year: 'numeric' }).format(
        date,
      );
  }
}

export function formatDateTime(
  value: DateInput,
  timezone?: string,
  locale = 'en-US',
  pattern = 'MM/DD/YYYY',
): string {
  const date = toDate(value);
  if (!date) return '—';
  const time = new Intl.DateTimeFormat(locale, {
    timeZone: timezone,
    hour: 'numeric',
    minute: '2-digit',
  }).format(date);
  return `${formatDate(date, pattern, timezone, locale)}, ${time}`;
}

const RELATIVE_UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 60 * 60 * 1000],
  ['month', 30 * 24 * 60 * 60 * 1000],
  ['week', 7 * 24 * 60 * 60 * 1000],
  ['day', 24 * 60 * 60 * 1000],
  ['hour', 60 * 60 * 1000],
  ['minute', 60 * 1000],
  ['second', 1000],
];

/** `"3 days ago"`, `"in 2 hours"`. Falls back to an absolute date beyond a year. */
export function formatRelativeTime(value: DateInput, locale = 'en-US', now: Date = new Date()): string {
  const date = toDate(value);
  if (!date) return '—';

  const diff = date.getTime() - now.getTime();
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });

  for (const [unit, ms] of RELATIVE_UNITS) {
    if (Math.abs(diff) >= ms) {
      return formatter.format(Math.round(diff / ms), unit);
    }
  }
  return 'just now';
}

export function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ${minutes % 60}m`;
  const days = Math.floor(hours / 24);
  return `${days}d ${hours % 24}h`;
}

/** Average time-to-fill style durations, expressed in days. */
export function formatDays(days: number | null | undefined, locale = 'en-US'): string {
  if (days === null || days === undefined || !Number.isFinite(days)) return '—';
  if (days < 1) return '< 1 day';
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(days)} days`;
}

const BYTE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const;

export function formatBytes(bytes: number | string | null | undefined, decimals = 1): string {
  const value = typeof bytes === 'string' ? Number(bytes) : bytes;
  if (value === null || value === undefined || !Number.isFinite(value)) return '—';
  if (value === 0) return '0 B';
  const index = Math.min(Math.floor(Math.log(Math.abs(value)) / Math.log(1024)), BYTE_UNITS.length - 1);
  const scaled = value / 1024 ** index;
  return `${scaled.toFixed(index === 0 ? 0 : decimals)} ${BYTE_UNITS[index]}`;
}

/** URL- and subdomain-safe slug. `"Acme Recruiting, Inc."` → `"acme-recruiting-inc"` */
export function slugify(input: string): string {
  return input
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function truncate(value: string, max = 80): string {
  if (value.length <= max) return value;
  return `${value.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function titleCase(value: string): string {
  return value
    .toLowerCase()
    .split(/[\s_-]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/** `"HIRED"` → `"Hired"`; `"CONTRACT_TO_HIRE"` → `"Contract to hire"`. */
export function humanizeEnum(value: string | null | undefined): string {
  if (!value) return '—';
  return titleCase(value.replace(/_/g, ' '));
}

export function absoluteUrl(path: string, base?: string): string {
  const origin = base ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return new URL(path, origin).toString();
}

/** Reads a nested value by dot-path: `get(obj, 'candidate.firstName')`. */
export function get<T = unknown>(source: unknown, path: string, fallback?: T): T | undefined {
  const result = path.split('.').reduce<unknown>((accumulator, key) => {
    if (accumulator === null || accumulator === undefined) return undefined;
    if (typeof accumulator !== 'object') return undefined;
    return (accumulator as Record<string, unknown>)[key];
  }, source);
  return (result === undefined ? fallback : result) as T | undefined;
}

/** Stable key for list rendering when no id is available. */
export function stableKey(...parts: (string | number | null | undefined)[]): string {
  return parts.filter((part) => part !== null && part !== undefined).join('-');
}
