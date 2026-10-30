import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";

export const dynamic = "force-dynamic";

export async function GET() {
  const filePath = path.join(process.cwd(), "public/downloads/maestro-key-fixes.zip");

  if (!fs.existsSync(filePath)) {
    return new NextResponse("File not found", { status: 404 });
  }

  const fileBuffer = fs.readFileSync(filePath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": 'attachment; filename="maestro-key-fixes.zip"',
      "Content-Length": fileBuffer.length.toString(),
      "Cache-Control": "no-cache, no-store, must-revalidate",
      "Pragma": "no-cache",
    },
  });
}
