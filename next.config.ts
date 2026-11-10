import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Dev-only: let loopback and hosted preview origins load dev assets so pages hydrate.
  allowedDevOrigins: ["127.0.0.1", "*.preview.usehoplite.com"],
  cacheComponents: true,
  partialPrefetching: true,
  // Employee documents allow 4 MB files; the default 1 MB server-action limit would reject them.
  experimental: { serverActions: { bodySizeLimit: "5mb" } },
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
