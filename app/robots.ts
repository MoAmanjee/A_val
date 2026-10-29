import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.APP_URL ?? "https://mochachospotch.co.za").replace(/\/$/, "");
  const host = base.replace(/^https?:\/\//, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: ["/kitchen", "/ops", "/promotions", "/api/"],
      },
    ],
    sitemap: `${base}/sitemap.xml`,
    host,
  };
}
