import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = { title: "AgentGrid", description: "AI customer engagement & business automation" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
