import fs from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";

const root = process.cwd();
const directory = path.join(root, "public", "icons");
const white = { r: 255, g: 255, b: 255, alpha: 1 };
await fs.mkdir(directory, { recursive: true });

// Preserve the C/key logo and its white lettering. Remove only the light
// background connected to the source edges, then place the mark on a clean tile.
const { data, info } = await sharp(path.join(root, "public", "notify-icon.png"))
  .ensureAlpha()
  .raw()
  .toBuffer({ resolveWithObject: true });
const { width, height } = info;
const removed = new Uint8Array(width * height);
const queue = new Int32Array(width * height);
let head = 0;
let tail = 0;
const enqueue = (pixel) => {
  if (pixel < 0 || pixel >= removed.length || removed[pixel]) return;
  const offset = pixel * 4;
  const values = [data[offset], data[offset + 1], data[offset + 2]];
  if (data[offset + 3] > 0 && (Math.min(...values) < 160 || Math.max(...values) - Math.min(...values) > 85)) return;
  removed[pixel] = 1;
  queue[tail++] = pixel;
};
for (let x = 0; x < width; x++) {
  enqueue(x);
  enqueue((height - 1) * width + x);
}
for (let y = 0; y < height; y++) {
  enqueue(y * width);
  enqueue(y * width + width - 1);
}
while (head < tail) {
  const pixel = queue[head++];
  const x = pixel % width;
  if (x > 0) enqueue(pixel - 1);
  if (x + 1 < width) enqueue(pixel + 1);
  if (pixel >= width) enqueue(pixel - width);
  if (pixel + width < removed.length) enqueue(pixel + width);
}
for (let pixel = 0; pixel < removed.length; pixel++) {
  if (removed[pixel]) data[pixel * 4 + 3] = 0;
}
const mark = await sharp(data, { raw: { width, height, channels: 4 } })
  .trim({ background: "#00000000", threshold: 8 })
  .modulate({ brightness: 0.86, saturation: 0.96 })
  .png()
  .toBuffer();

const png = (image) => image.png({ palette: true, quality: 100, effort: 10, colours: 256 });
async function tile(size, fraction, filename, rounded = true) {
  const art = await sharp(mark)
    .resize(Math.round(size * fraction), Math.round(size * fraction), { fit: "contain", background: "#00000000" })
    .toBuffer();
  let image = await sharp({ create: { width: size, height: size, channels: 4, background: white } })
    .composite([{ input: art, gravity: "centre" }])
    .png()
    .toBuffer();
  if (rounded) {
    // Actual transparent corners, not a square white image inside another frame.
    const radius = Math.round(size * 0.23);
    const mask = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="white"/></svg>`);
    image = await sharp(image).composite([{ input: mask, blend: "dest-in" }]).png().toBuffer();
  }
  await png(sharp(image)).toFile(path.join(directory, filename));
}

// Standard launcher / expanded notification icons have rounded white tiles.
await tile(192, 0.84, "app-white-v3-192.png");
await tile(512, 0.84, "app-white-v3-512.png");
await tile(192, 0.84, "notification-white-v3-192.png");
await tile(64, 0.84, "favicon-white-v3-64.png");

// Android applies its own circle / squircle mask: full white bleed, safe artwork.
await tile(192, 0.76, "app-white-v3-maskable-192.png", false);
await tile(512, 0.76, "app-white-v3-maskable-512.png", false);
// iOS also applies its own corner mask; do not add transparent padding there.
await tile(180, 0.84, "apple-touch-white-v3-180.png", false);

// The Android status bar badge must remain a white glyph on transparent pixels.
// A full white square would be rendered as a blank block by the system.
await sharp(path.join(directory, "notification-badge-v2.svg"), { density: 288 })
  .resize(96, 96)
  .png({ palette: true, effort: 10 })
  .toFile(path.join(directory, "notification-badge-v3-96.png"));

// Also refresh legacy URLs and Next.js file-based icon metadata.
const aliases = {
  "icons/app-white-v3-192.png": ["public/app-icon-192.png"],
  "icons/app-white-v3-512.png": ["public/app-icon-512.png", "public/icon-512.png"],
  "icons/notification-white-v3-192.png": ["public/notify-192.png"],
  "icons/notification-badge-v3-96.png": ["public/notify-badge.png"],
  "icons/favicon-white-v3-64.png": ["src/app/icon.png"],
};
for (const [source, targets] of Object.entries(aliases)) {
  for (const target of targets) await fs.copyFile(path.join(root, "public", source), path.join(root, target));
}
console.log("Generated white rounded launcher and notification icons, with Android and Apple variants.");
console.log("The dark application theme, store logo, and all application functions are unchanged.");
