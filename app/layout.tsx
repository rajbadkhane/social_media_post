import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "The Cliff News Poster Maker",
  description: "Create downloadable social-media news posters for The Cliff News.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
