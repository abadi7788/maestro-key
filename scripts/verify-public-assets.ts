import { verifyPublicAssets } from "../src/lib/asset-preflight";

try {
  const images = verifyPublicAssets();
  for (const image of images) console.log(`OK ${image.file} (${image.width}x${image.height} PNG) -> ${image.url}`);
  console.log(`PASS ${images.length} public images, manifest, Next.js favicon and both notification icon references.`);
} catch (error) {
  console.error(error instanceof Error ? error.message : "Static assets could not be verified.");
  process.exitCode = 1;
}
