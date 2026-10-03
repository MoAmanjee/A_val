import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Mochachos Potch CBD",
  description: "WhatsApp ordering for Mochachos Potchefstroom CBD",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
