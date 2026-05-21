import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "LiveRoom - Voice Chat with AI Transcription",
  description:
    "Real-time peer-to-peer voice communication platform with live AI-powered transcription and synchronized chat display.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="h-full antialiased dark">
      <body className="min-h-full flex flex-col bg-[#07070a] text-gray-200">
        {children}
      </body>
    </html>
  );
}
