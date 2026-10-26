import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const base = (process.env.APP_URL ?? "https://mochachospotch.co.za").replace(/\/$/, "");
  const now = new Date();
  return [
    {
      url: `${base}/`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${base}/order`,
      lastModified: now,
      changeFrequency: "daily",
      priority: 1,
    },
  ];
}
