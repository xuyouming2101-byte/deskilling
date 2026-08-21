import type { Metadata } from "next";
import "survey-core/survey-core.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Colonoscopy Lesion Check",
  description: "Supabase-backed colonoscopy assessment queue"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
