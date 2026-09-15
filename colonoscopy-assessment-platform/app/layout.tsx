import type { Metadata } from "next";
import "survey-core/survey-core.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "lesion detection",
  description: "Video-based lesion detection assessment."
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
