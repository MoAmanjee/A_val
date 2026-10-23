import type { Metadata } from "next";
import { ToastProvider } from "@/components/ui";
import "./globals.css";

export const metadata: Metadata = {
  title: "AutoQuote - WhatsApp parts & quoting",
  description: "AI-assisted WhatsApp enquiries, inventory-backed quotations and business approval for auto parts suppliers.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <ToastProvider>{children}</ToastProvider>
      </body>
    </html>
  );
}
