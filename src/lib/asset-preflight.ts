import fs from "node:fs";
import path from "node:path";

export type AssetSpec = { file: string; size?: number; minSize?: number; usage: string };

/** Paths relative to the Next.js root. PNG data and case must match on Linux/Vercel. */
export const requiredPublicImages: readonly AssetSpec[] = [
  { file: "public/logo.png", minSize: 256, usage: "Login, sidebar and store background" },
  { file: "public/icons/icon-192x192.png", size: 192, usage: "PWA icon and expanded notification icon" },
  { file: "public/icons/icon-512x512.png", size: 512, usage: "PWA icon" },
  { file: "public/icons/icon-maskable-512x512.png", size: 512, usage: "Android maskable icon" },
  { file: "public/icons/badge-72x72.png", size: 72, usage: "Monochrome notification status-bar badge" },
  { file: "public/icons/apple-touch-white-v3-180.png", size: 180, usage: "Apple touch icon" },
  { file: "public/icons/favicon-white-v3-64.png", size: 64, usage: "Browser favicon" },
  { file: "public/platforms/netflix.png", minSize: 128, usage: "Netflix platform artwork" },
  { file: "public/platforms/shahid.png", minSize: 128, usage: "Shahid platform artwork" },
  { file: "public/platforms/disney.png", minSize: 128, usage: "Disney platform artwork" },
  { file: "public/platforms/youtube.png", minSize: 128, usage: "YouTube platform artwork" },
  { file: "public/platforms/osn.png", minSize: 128, usage: "OSN platform artwork" },
  { file: "public/platforms/tod.png", minSize: 128, usage: "TOD / beIN artwork" },
];

const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function imageInfo(root: string, spec: AssetSpec) {
  const target = path.join(root, spec.file);
  if (!fs.existsSync(target)) throw new Error(`Missing image: ${spec.file}. Upload the real PNG with this exact name and case. See PWA_SETUP.md.`);
  const data = fs.readFileSync(target);
  if (data.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/")) throw new Error(`${spec.file} is a Git LFS pointer, not an image.`);
  if (data.length < 33 || !data.subarray(0, 8).equals(signature) || data.subarray(12, 16).toString("ascii") !== "IHDR") throw new Error(`${spec.file} must contain an actual PNG image, not renamed JPG/HTML data.`);
  const width = data.readUInt32BE(16), height = data.readUInt32BE(20);
  if (width !== height || width < (spec.minSize || spec.size || 1) || (spec.size && width !== spec.size)) throw new Error(`${spec.file}: found ${width}x${height}; expected ${spec.size ? `${spec.size}x${spec.size}` : `a square at least ${spec.minSize}px`} pixels.`);
  return { ...spec, width, height, url: `/${spec.file.slice("public/".length)}`, bytes: data.length };
}

/** Build-time validation; never contacts providers or reads credentials. */
export function verifyPublicAssets(root = process.cwd()) {
  const images = requiredPublicImages.map((spec) => imageInfo(root, spec));
  let manifest: { id?: string; name?: string; short_name?: string; start_url?: string; scope?: string; display?: string; prefer_related_applications?: boolean; icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[] };
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, "public/manifest.json"), "utf8")); }
  catch { throw new Error("public/manifest.json is missing or not valid JSON."); }
  if (manifest.id !== "/" || manifest.start_url !== "/sale" || manifest.scope !== "/" || manifest.display !== "standalone" || !(manifest.name || manifest.short_name) || manifest.prefer_related_applications === true) throw new Error("manifest.json needs a stable id, / scope, /sale start URL, standalone display, a name and prefer_related_applications=false.");
  for (const [src, sizes, purpose] of [
    ["/icons/icon-192x192.png", "192x192", "any"],
    ["/icons/icon-512x512.png", "512x512", "any"],
    ["/icons/icon-maskable-512x512.png", "512x512", "maskable"],
  ]) {
    const entry = manifest.icons?.find((icon) => icon.src === src && (icon.purpose || "any") === purpose);
    if (!entry || entry.sizes !== sizes || entry.type !== "image/png") throw new Error(`manifest.json: expected ${src}, sizes=${sizes}, type=image/png, purpose=${purpose}. Never include /public in the URL.`);
  }
  imageInfo(root, { file: "src/app/icon.png", size: 64, usage: "Next.js file-based favicon" });
  for (const file of ["public/sw.js", "src/components/AlertWatcher.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const url of ["/icons/icon-192x192.png", "/icons/badge-72x72.png"]) if (!source.includes(url)) throw new Error(`${file} is missing ${url}.`);
  }
  const worker = fs.readFileSync(path.join(root, "public/sw.js"), "utf8");
  for (const event of ["install", "activate", "fetch", "push", "notificationclick"]) if (!worker.includes(`addEventListener("${event}"`)) throw new Error(`public/sw.js is missing the ${event} handler.`);
  if (!fs.existsSync(path.join(root, "public/offline.html"))) throw new Error("public/offline.html is missing.");
  return images;
}
