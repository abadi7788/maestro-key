import type { NextConfig } from "next";
import { PHASE_PRODUCTION_BUILD } from "next/constants";
import { verifyPublicAssets } from "./src/lib/asset-preflight";

export default function nextConfig(phase: string): NextConfig {
  if (phase === PHASE_PRODUCTION_BUILD) {
    const images = verifyPublicAssets();
    console.log(`[assets] Verified ${images.length} public images and PWA icon metadata.`);
  }
  return {
    async headers() {
      return [
        {
          source: "/sw.js",
          headers: [
            { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
            { key: "Service-Worker-Allowed", value: "/" },
            { key: "Content-Type", value: "application/javascript; charset=utf-8" },
            { key: "X-Content-Type-Options", value: "nosniff" },
          ],
        },
        {
          source: "/manifest.json",
          headers: [
            { key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" },
            { key: "Content-Type", value: "application/manifest+json; charset=utf-8" },
          ],
        },
        {
          source: "/icons/:path*",
          headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
        },
        {
          source: "/favicon.ico",
          headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
        },
        {
          source: "/downloads/maestro-key-vercel.env.example",
          headers: [
            { key: "Content-Type", value: "text/plain; charset=utf-8" },
            { key: "Content-Disposition", value: 'inline; filename="maestro-key-vercel.env.example"' },
            { key: "Cache-Control", value: "no-store" },
            { key: "X-Content-Type-Options", value: "nosniff" },
          ],
        },
        {
          source: "/downloads/maestro-key-neon-schema.sql",
          headers: [
            { key: "Content-Type", value: "text/plain; charset=utf-8" },
            { key: "Content-Disposition", value: 'inline; filename="maestro-key-neon-schema.sql"' },
            { key: "Cache-Control", value: "no-store" },
            { key: "X-Content-Type-Options", value: "nosniff" },
          ],
        },
      ];
    },
  };
}
