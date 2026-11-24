import { cn } from '@talentflow/ui';

import { env } from '@/lib/env';

interface LogoProps {
  className?: string;
  /** Hides the wordmark, leaving only the glyph. */
  markOnly?: boolean;
}

/**
 * The product mark.
 *
 * A single inline SVG so it stays crisp at every size and inherits `currentColor`
 * — the app shell renders it on a dark sidebar, the auth screens on white, and
 * neither needs a second asset or a recolour.
 */
export function Logo({ className, markOnly = false }: LogoProps) {
  return (
    <span className={cn('flex items-center gap-2.5', className)}>
      <LogoMark className="size-7 shrink-0" />
      {markOnly ? null : (
        <span className="text-[0.95rem] font-semibold tracking-tight">{env.appName}</span>
      )}
    </span>
  );
}

export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      role="img"
      aria-label={env.appName}
      className={cn('size-7', className)}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <rect width="32" height="32" rx="8" fill="currentColor" />
      <path
        d="M9 11.5h14M16 11.5V22M12.5 22h7"
        stroke="#fff"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="8" r="1.8" fill="#fff" />
    </svg>
  );
}
