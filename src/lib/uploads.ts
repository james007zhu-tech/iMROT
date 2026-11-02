/** File storage for photos, parameter backups and attachments: local disk under UPLOADS_DIR, served by /api/uploads/:name. */
import { mkdir, writeFile } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";

export const UPLOADS_DIR = process.env.UPLOADS_DIR ?? path.join(process.cwd(), "uploads", "files");
const SAFE = /[^A-Za-z0-9._-]/g;

export async function saveUpload(file: File, prefix = "f"): Promise<{ name: string; url: string }> {
  if (file.size > 25 * 1024 * 1024) throw new Error("file larger than 25 MB");
  await mkdir(UPLOADS_DIR, { recursive: true });
  const ext = path.extname(file.name).toLowerCase().replace(SAFE, "").slice(0, 10);
  const name = `${prefix}-${Date.now()}-${randomBytes(4).toString("hex")}${ext}`;
  await writeFile(path.join(UPLOADS_DIR, name), Buffer.from(await file.arrayBuffer()));
  return { name, url: `/api/uploads/${name}` };
}
