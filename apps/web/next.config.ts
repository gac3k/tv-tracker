import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),
  // TMDB posters are served straight from their CDN.
  images: { remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }] },
  // Proxy browser calls to the API server so the web app never needs CORS.
  async rewrites() {
    const api = process.env.API_URL ?? "http://127.0.0.1:3000";
    return [{ source: "/api/:path*", destination: `${api}/:path*` }];
  },
};

export default nextConfig;
