import type { Metadata, Viewport } from "next";
import "./globals.css";

const siteUrl = process.env.APP_URL?.replace(/\/$/, "") || "https://mochachospotch.co.za";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Mochachos Potch CBD",
    template: "%s · Mochachos Potch CBD",
  },
  description: "Order Mochachos Potchefstroom CBD online — photo menu, meals, and kitchen-ready notes. Same kitchen as WhatsApp.",
  applicationName: "Mochachos Potch CBD",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/icon.png", type: "image/png", sizes: "192x192" },
    ],
    apple: [{ url: "/apple-icon.png", sizes: "180x180" }],
  },
  openGraph: {
    type: "website",
    locale: "en_ZA",
    url: siteUrl,
    siteName: "Mochachos Potch CBD",
    title: "Mochachos Potch CBD",
    description: "Order online from Mochachos Potchefstroom CBD.",
    images: [{ url: "/order-food/brand-mark-512.png", width: 512, height: 512, alt: "Mochachos" }],
  },
  twitter: {
    card: "summary",
    title: "Mochachos Potch CBD",
    description: "Order online from Mochachos Potchefstroom CBD.",
    images: ["/order-food/brand-mark-512.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#e10600",
  colorScheme: "light",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en-ZA">
      <body>{children}</body>
    </html>
  );
}
