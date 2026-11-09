import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const type = url.searchParams.get("type") || "full";

  let fileName = "maestro-key-full.zip";
  let downloadName = "maestro-key-full-project.zip";
  let contentType = "application/zip";

  if (type === "fixes") {
    fileName = "maestro-key-fixes.zip";
    downloadName = "maestro-key-fixes.zip";
  } else if (type === "sql") {
    fileName = "maestro-key-neon-schema.sql";
    downloadName = "maestro-key-neon-schema.sql";
    contentType = "text/plain; charset=utf-8";
  }

  const filePath = path.join(process.cwd(), "public/downloads", fileName);

  if (!fs.existsSync(filePath)) {
    return new NextResponse("File not found", { status: 404 });
  }

  const fileBuffer = fs.readFileSync(filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${downloadName}"`,
      "Content-Length": fileBuffer.length.toString(),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
