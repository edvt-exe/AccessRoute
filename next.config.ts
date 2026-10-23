import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // dev only: lets a phone load the dev bundles through an https tunnel
  allowedDevOrigins: ["*.trycloudflare.com", "*.ngrok-free.app"],
  cacheComponents: true,
  partialPrefetching: true,
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
