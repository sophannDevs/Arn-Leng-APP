import { FREE_EPISODES } from '@inkline/shared';
import type { Metadata, Viewport } from 'next';
import { NextIntlClientProvider } from 'next-intl';
import { getLocale, getTranslations } from 'next-intl/server';
import { Bangers, Barlow_Condensed, Poppins } from 'next/font/google';
import type { ReactNode } from 'react';
import { env } from '@/env';
import './globals.css';

const poppins = Poppins({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-poppins',
});
const barlow = Barlow_Condensed({
  subsets: ['latin'],
  weight: ['600', '700'],
  variable: '--font-barlow',
});
// The comic lettering is used for the logo and decoration only: let it load without holding up the page.
const bangers = Bangers({
  subsets: ['latin'],
  weight: '400',
  variable: '--font-bangers',
  preload: false,
});

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('metadata');
  const description = t('description', { freeEpisodes: FREE_EPISODES });
  return {
    // Relative addresses (canonical, Open Graph images) are made absolute from the site address.
    metadataBase: new URL(env.NEXT_PUBLIC_SITE_URL),
    title: { default: t('title'), template: '%s · Inkline' },
    description,
    applicationName: 'Inkline',
    openGraph: {
      siteName: 'Inkline',
      type: 'website',
      locale: 'en_US',
      title: t('title'),
      description,
    },
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = { themeColor: '#d91e1e' };

export default async function RootLayout({ children }: { children: ReactNode }) {
  const locale = await getLocale();
  return (
    <html lang={locale} className={`${poppins.variable} ${barlow.variable} ${bangers.variable}`}>
      {/* Browser extensions (e.g. Grammarly) inject attributes into <body> before hydration. */}
      <body suppressHydrationWarning>
        <NextIntlClientProvider>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
