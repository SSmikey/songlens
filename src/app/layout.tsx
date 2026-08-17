import type { Metadata, Viewport } from "next";
import { Prompt, Sarabun } from "next/font/google";
import "./globals.css";

// Prompt for headings, Sarabun for body copy — both support the Thai
// subset (the app is Thai-first content).
const prompt = Prompt({
  variable: "--font-prompt",
  subsets: ["thai", "latin"],
  weight: ["500", "600", "700"],
});

const sarabun = Sarabun({
  variable: "--font-sarabun",
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600"],
});

export const metadata: Metadata = {
  title: "SongLens — ค้นหาเพลงจากเสียง",
  description: "พูดหรือพิมพ์เนื้อเพลงที่จำได้ ให้ SongLens ช่วยหาเพลงลูกทุ่งที่ใช่",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fdf8ec" },
    { media: "(prefers-color-scheme: dark)", color: "#1c1410" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="th" className={`${prompt.variable} ${sarabun.variable}`}>
      <body>{children}</body>
    </html>
  );
}
