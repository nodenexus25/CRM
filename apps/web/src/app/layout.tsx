import type { Metadata, Viewport } from 'next';

import '@talentflow/ui/tokens.css';
import './globals.css';

import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { env } from '@/lib/env';
import { QueryProvider } from '@/providers/query-provider';
import { SessionProvider } from '@/providers/session-provider';
import { ThemeProvider } from '@/providers/theme-provider';

export const metadata: Metadata = {
  metadataBase: new URL(env.appUrl),
  title: {
    default: `${env.appName} — ATS & Recruitment CRM`,
    template: `%s · ${env.appName}`,
  },
  description:
    'TalentFlow is the applicant tracking system and recruitment CRM that staffing agencies and recruiting firms run their whole desk on: jobs, candidates, submissions, clients and placements in one workspace.',
  applicationName: env.appName,
  keywords: ['ATS', 'recruitment CRM', 'staffing software', 'applicant tracking', 'recruiting agency'],
  openGraph: {
    type: 'website',
    siteName: env.appName,
    title: `${env.appName} — ATS & Recruitment CRM`,
    description:
      'Run jobs, candidates, submissions, clients and placements in one multi-tenant workspace built for staffing agencies.',
    url: env.appUrl,
  },
  twitter: { card: 'summary_large_image' },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0b1220' },
  ],
};

/**
 * Provider order matters: the theme flips CSS classes on `<html>`, the query
 * client owns every cache, and the session provider reads `/auth/session`
 * through that client. Tooltips sit innermost so any component can wrap itself
 * in a `Tooltip` without re-declaring a provider.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        {/* eslint-disable-next-line @next/next/no-page-custom-font */}
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        <ThemeProvider>
          <QueryProvider>
            <SessionProvider>
              <TooltipProvider delayDuration={200}>
                {children}
                <Toaster />
              </TooltipProvider>
            </SessionProvider>
          </QueryProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
