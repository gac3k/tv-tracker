import type { NextConfig } from "next";

const API_URL = process.env.API_URL ?? "http://127.0.0.1:3000";

const nextConfig: NextConfig = {
  // TMDB posters are served straight from their CDN.
  images: { remotePatterns: [{ protocol: "https", hostname: "image.tmdb.org" }] },
  // Proxy browser calls to the API server so the web app never needs CORS.
  async rewrites() {
    return [{ source: "/api/:path*", destination: `${API_URL}/:path*` }];
  },
};

export default nextConfig;
