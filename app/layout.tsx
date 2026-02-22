import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";
import { getServerLocale } from "@/lib/i18n/getServerLocale";
import { translate } from "@/lib/i18n/t";

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getServerLocale();
  return {
    title: translate(locale, 'public.meta.title'),
    description: translate(locale, 'public.meta.description'),
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getServerLocale();
  const lang = locale.split('-')[0] || 'en';

  return (
    <html lang={lang} suppressHydrationWarning>
      {/* NOTE: Avoid next/font/google in offline/CI builds (network-restricted). */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
