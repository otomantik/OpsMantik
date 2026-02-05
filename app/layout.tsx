import type { Metadata } from "next";
import { Toaster } from "sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "OPSMANTIK - Google Ads Attribution & Lead Intelligence",
  description: "Real-time tracking and multi-touch attribution platform",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      {/* NOTE: Avoid next/font/google in offline/CI builds (network-restricted). */}
      <body className="antialiased" suppressHydrationWarning>
        {children}
        <Toaster position="bottom-right" richColors />
      </body>
    </html>
  );
}
