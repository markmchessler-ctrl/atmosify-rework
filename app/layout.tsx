// app/layout.tsx
// MODIFICATION INSTRUCTIONS:
// Add the MusicKit JS CDN script to your existing layout.tsx.
// Find the closing </head> tag (or the Script imports) and add:
//
//   import Script from "next/script";
//
//   Then in your <html> body, before </body>, add:
//
//   <Script
//     src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"
//     strategy="beforeInteractive"
//   />
//
// Full example layout.tsx (adapt to your existing code):

import type { Metadata } from "next";
import Script from "next/script";
import "./globals.css"; // keep your existing CSS import

export const metadata: Metadata = {
  title: "Atmosify — Dolby Atmos Playlist Maker",
  description: "Build premium Dolby Atmos playlists curated from 100k+ verified tracks",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body>
        {children}
        {/* MusicKit JS — loaded before interactive so it's available on first render */}
        <Script
          src="https://js-cdn.music.apple.com/musickit/v3/musickit.js"
          strategy="beforeInteractive"
        />
      </body>
    </html>
  );
}
