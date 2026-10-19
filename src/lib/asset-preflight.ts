import fs from "node:fs";
import path from "node:path";

export type AssetSpec = { file: string; size?: number; minSize?: number; usage: string };

/** Paths are relative to the Next.js project root, including the public folder. */
export const requiredPublicImages: readonly AssetSpec[] = [
  { file: "public/logo.png", minSize: 256, usage: "Login, sidebar, header and store background" },
  { file: "public/icons/app-white-v3-192.png", size: 192, usage: "PWA launcher icon (any)" },
  { file: "public/icons/app-white-v3-512.png", size: 512, usage: "PWA launcher icon (any)" },
  { file: "public/icons/app-white-v3-maskable-192.png", size: 192, usage: "Android adaptive launcher icon" },
  { file: "public/icons/app-white-v3-maskable-512.png", size: 512, usage: "Android adaptive launcher icon" },
  { file: "public/icons/apple-touch-white-v3-180.png", size: 180, usage: "iPhone/iPad home-screen icon" },
  { file: "public/icons/favicon-white-v3-64.png", size: 64, usage: "Browser tab icon" },
  { file: "public/icons/notification-white-v3-192.png", size: 192, usage: "Expanded notification icon" },
  { file: "public/icons/notification-badge-v3-96.png", size: 96, usage: "White-on-transparent Android status-bar key" },
  { file: "public/platforms/netflix.png", minSize: 128, usage: "Netflix platform artwork" },
  { file: "public/platforms/shahid.png", minSize: 128, usage: "Shahid platform artwork" },
  { file: "public/platforms/disney.png", minSize: 128, usage: "Disney platform artwork" },
  { file: "public/platforms/youtube.png", minSize: 128, usage: "YouTube platform artwork" },
  { file: "public/platforms/osn.png", minSize: 128, usage: "OSN platform artwork" },
  { file: "public/platforms/tod.png", minSize: 128, usage: "TOD / beIN platform artwork" },
];

const pngSignature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function imageInfo(root: string, spec: AssetSpec) {
  const target = path.join(root, spec.file);
  if (!fs.existsSync(target)) {
    throw new Error(`Missing image: ${spec.file}. Upload the real file to GitHub using exactly this spelling and case. See ASSETS_VERCEL.md.`);
  }
  const content = fs.readFileSync(target);
  if (content.subarray(0, 100).toString("utf8").startsWith("version https://git-lfs.github.com/spec/")) {
    throw new Error(`${spec.file} is a Git LFS pointer, not an image. Include the actual PNG in the deployment.`);
  }
  if (content.length < 33 || !content.subarray(0, 8).equals(pngSignature) || content.subarray(12, 16).toString("ascii") !== "IHDR") {
    throw new Error(`${spec.file} must contain an actual PNG image; renaming a JPG/SVG/HTML file to .png is not sufficient.`);
  }
  const width = content.readUInt32BE(16);
  const height = content.readUInt32BE(20);
  if (width !== height || width < (spec.minSize || spec.size || 1) || (spec.size && (width !== spec.size || height !== spec.size))) {
    throw new Error(`${spec.file}: found ${width}x${height}; expected ${spec.size ? `${spec.size}x${spec.size}` : `a square image at least ${spec.minSize}x${spec.minSize}`} pixels.`);
  }
  return { ...spec, width, height, url: `/${spec.file.slice("public/".length)}`, bytes: content.length };
}

/** Build-time guard only. No database/provider calls and no secret values. */
export function verifyPublicAssets(root = process.cwd()) {
  const images = requiredPublicImages.map((spec) => imageInfo(root, spec));
  const manifestPath = path.join(root, "public/manifest.json");
  if (!fs.existsSync(manifestPath)) throw new Error("public/manifest.json is missing from the repository.");
  let manifest: { id?: string; start_url?: string; scope?: string; display?: string; icons?: { src?: string; sizes?: string; type?: string; purpose?: string }[] };
  try { manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8")); }
  catch { throw new Error("public/manifest.json must contain valid JSON."); }
  if (manifest.id !== "/" || manifest.start_url !== "/sale" || manifest.scope !== "/" || manifest.display !== "standalone") {
    throw new Error("PWA identity or start URL changed. Expected id=/, scope=/, start_url=/sale and display=standalone.");
  }
  for (const [src, sizes, purpose] of [
    ["/icons/app-white-v3-192.png", "192x192", "any"],
    ["/icons/app-white-v3-512.png", "512x512", "any"],
    ["/icons/app-white-v3-maskable-192.png", "192x192", "maskable"],
    ["/icons/app-white-v3-maskable-512.png", "512x512", "maskable"],
  ]) {
    const entry = manifest.icons?.find((icon) => icon.src === src && icon.purpose === purpose);
    if (!entry || entry.sizes !== sizes || entry.type !== "image/png") {
      throw new Error(`manifest.json: expected ${src} with sizes=${sizes}, type=image/png, purpose=${purpose}. Do not include /public in browser URLs.`);
    }
  }
  const fileIcon = { file: "src/app/icon.png", size: 64, usage: "Next.js file-based favicon" };
  imageInfo(root, fileIcon);
  if (!fs.readFileSync(path.join(root, fileIcon.file)).equals(fs.readFileSync(path.join(root, "public/icons/favicon-white-v3-64.png")))) {
    throw new Error("src/app/icon.png overrides favicon metadata and differs from the current favicon. Regenerate or copy the matching 64px PNG.");
  }
  for (const file of ["public/sw.js", "src/components/AlertWatcher.tsx"]) {
    const source = fs.readFileSync(path.join(root, file), "utf8");
    for (const url of ["/icons/notification-white-v3-192.png", "/icons/notification-badge-v3-96.png"]) {
      if (!source.includes(url)) throw new Error(`${file} does not reference the required notification image ${url}.`);
    }
  }
  return images;
}
