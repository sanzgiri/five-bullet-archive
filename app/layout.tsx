import type { Metadata } from "next";
import { Geist } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });

const title = "Five Bullet Index — Tim Ferriss Recommendations";
const description =
  "Search books, music, films, podcasts, quotes, and ideas recommended in Tim Ferriss’s 5-Bullet Friday newsletter.";

export const metadata: Metadata = {
  metadataBase: new URL("https://sanzgiri.github.io/five-bullet-archive/"),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    images: [{ url: "og.png", width: 1731, height: 899, alt: "Five Bullet Index" }],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["og.png"],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={geist.variable}>{children}</body>
    </html>
  );
}
