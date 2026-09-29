import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ["pdfkit", "exceljs", "bcryptjs", "@prisma/client"],
  experimental: {
    serverActions: { bodySizeLimit: "12mb" },
  },
  poweredByHeader: false,
};

export default nextConfig;
