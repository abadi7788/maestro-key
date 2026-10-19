import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { requiredPublicImages, verifyPublicAssets } from "../src/lib/asset-preflight";

async function main() {
  const root = process.cwd();
  const report = verifyPublicAssets(root);
  for (const image of report) {
    const metadata = await sharp(path.join(root, image.file)).metadata();
    assert.equal(metadata.format, "png");
    assert.equal(metadata.width, image.width);
    assert.equal(metadata.height, image.height);
    await sharp(path.join(root, image.file)).raw().toBuffer();
  }
  console.log("PASS all 15 live PNG files decode and match their stated dimensions.");
  const badge = await sharp(path.join(root, "public/icons/notification-badge-v3-96.png")).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let clear = 0;
  let visible = 0;
  for (let i = 0; i < badge.data.length; i += 4) {
    if (badge.data[i + 3] === 0) clear++;
    else {
      visible++;
      assert.ok(badge.data[i] > 245 && badge.data[i + 1] > 245 && badge.data[i + 2] > 245);
    }
  }
  assert.ok(clear > 5000 && visible > 700);
  console.log("PASS Android notification badge is white-on-transparent, not an opaque square.");

  const temp = await fs.mkdtemp(path.join(os.tmpdir(), "maestro-assets-test-"));
  const paths = [...requiredPublicImages.map((entry) => entry.file), "src/app/icon.png", "public/manifest.json", "public/sw.js", "src/components/AlertWatcher.tsx"];
  try {
    for (const file of paths) {
      await fs.mkdir(path.dirname(path.join(temp, file)), { recursive: true });
      await fs.copyFile(path.join(root, file), path.join(temp, file));
    }
    assert.equal(verifyPublicAssets(temp).length, 15);
    const logo = path.join(temp, "public/logo.png");
    await fs.rename(logo, path.join(temp, "public/Logo.png"));
    assert.throws(() => verifyPublicAssets(temp), /Missing image: public\/logo.png/);
    await fs.rename(path.join(temp, "public/Logo.png"), logo);
    const original = await fs.readFile(logo);
    await fs.writeFile(logo, "version https://git-lfs.github.com/spec/v1\noid sha256:test\nsize 123\n");
    assert.throws(() => verifyPublicAssets(temp), /Git LFS pointer/);
    await fs.writeFile(logo, "<!doctype html><title>Login instead of image</title>");
    assert.throws(() => verifyPublicAssets(temp), /actual PNG image/);
    await fs.writeFile(logo, original);
    console.log("PASS missing/case-mismatched images, Git LFS pointers and false PNG files fail clearly.");

    const iconFile = path.join(temp, "public/icons/app-white-v3-192.png");
    const icon = await fs.readFile(iconFile);
    const wrong = Buffer.from(icon);
    wrong.writeUInt32BE(512, 16);
    await fs.writeFile(iconFile, wrong);
    assert.throws(() => verifyPublicAssets(temp), /expected 192x192/);
    await fs.writeFile(iconFile, icon);
    const manifestFile = path.join(temp, "public/manifest.json");
    const manifest = JSON.parse(await fs.readFile(manifestFile, "utf8"));
    manifest.icons[0].src = "/public/icons/app-white-v3-192.png";
    await fs.writeFile(manifestFile, JSON.stringify(manifest));
    assert.throws(() => verifyPublicAssets(temp), /manifest\.json/);
    console.log("PASS mismatched icon sizes and manifest URLs with /public are rejected.");
  } finally {
    await fs.rm(temp, { recursive: true, force: true });
  }
  console.log("Asset preflight tests complete; original project files were not changed by the tests.");
}

main().catch((error) => { console.error(error.message); process.exitCode = 1; });
