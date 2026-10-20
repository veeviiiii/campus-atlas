import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Static site: reads pack JSON at build time, no server and no AI calls at runtime.
  output: "export",
  // /c/<college>/<pack>/ -> .../index.html, so every static host (Vercel, python http.server) finds the page
  trailingSlash: true,
  images: { unoptimized: true },
  // Cache Components / partial prefetching need a server, so they stay off for a static export.
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
