// app/layout.tsx
// Root layout — Inter font via next/font, MusicKit JS CDN, club theme.

import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import Script from "next/script";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

export const metadata: Metadata = {
  title: "Atmosify — Dolby Atmos Playlist Maker",
  description:
    "Build premium Dolby Atmos playlists curated from 100k+ verified tracks",
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "Atmosify",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
  themeColor: "#0a0a1a",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={inter.variable}>
      <head>
        <link rel="apple-touch-icon" href="/icons/icon-192.png" />
      </head>
      <body>
        {children}
        {/* MusicKit JS — loaded before interactive so it's available on first render */}
        <Script
          src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"
          strategy="beforeInteractive"
        />
        {/* Service Worker registration */}
        <Script id="sw-register" strategy="afterInteractive">{`
          if ('serviceWorker' in navigator) {
            navigator.serviceWorker.register('/sw.js').catch(() => {});
          }
        `}</Script>
      </body>
    </html>
  );
}
