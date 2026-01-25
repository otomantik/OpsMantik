import type { Metadata } from "next";
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
    <html lang="en">
      <body
        className="antialiased"
        style={{
          fontFamily: 'var(--font-inter), system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        {children}
      </body>
    </html>
  );
}
