import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "@/components/Providers";

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "LiveRoom — Voice Chat with AI Transcription",
  description:
    "Real-time peer-to-peer voice communication platform with live AI-powered transcription and synchronized chat display.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${inter.variable} h-full antialiased dark`}>
      <body className="min-h-full flex flex-col bg-[#07070a] text-gray-200 font-[var(--font-inter)]">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
