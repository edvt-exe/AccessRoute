import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { get, list, put } from "@vercel/blob";

// without a blob token everything lives on disk, so the app runs locally with no setup.
// on vercel a blob store is required, otherwise every server instance has its own /tmp
export const useBlob = Boolean(process.env.BLOB_READ_WRITE_TOKEN);
const access = "public" as const;
export const localRoot = process.env.VERCEL ? path.join(os.tmpdir(), "accessroute") : path.join(process.cwd(), ".data");

function safe(pathname: string) {
  if (!/^[a-z0-9/_.-]+$/i.test(pathname) || pathname.includes("..")) throw new Error(`bad path ${pathname}`);
  return pathname;
}

export async function readJson<T>(pathname: string): Promise<T | null> {
  safe(pathname);
  try {
    if (!useBlob) return JSON.parse(await readFile(path.join(localRoot, pathname), "utf8")) as T;
    // useCache false skips the cdn, otherwise other phones would read stale state
    const result = await get(pathname, { access, useCache: false });
    if (!result || result.statusCode !== 200) return null;
    return JSON.parse(await new Response(result.stream).text()) as T;
  } catch {
    return null;
  }
}

export async function writeJson(pathname: string, data: unknown) {
  safe(pathname);
  const body = JSON.stringify(data);
  if (!useBlob) {
    const file = path.join(localRoot, pathname);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, body);
    return;
  }
  await put(pathname, body, {
    access,
    contentType: "application/json",
    addRandomSuffix: false,
    allowOverwrite: true,
    cacheControlMaxAge: 60,
  });
}

export async function listJson(prefix: string): Promise<string[]> {
  safe(prefix);
  if (useBlob) {
    const { blobs } = await list({ prefix });
    return blobs.map((b) => b.pathname).filter((p) => p.endsWith(".json"));
  }
  try {
    const files = await readdir(path.join(localRoot, prefix));
    return files.filter((f) => f.endsWith(".json")).map((f) => `${prefix}${f}`);
  } catch {
    return [];
  }
}

export async function writeLocalFile(pathname: string, data: Buffer) {
  const file = path.join(localRoot, safe(pathname));
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, data);
}

export async function localFile(pathname: string) {
  const file = path.join(localRoot, safe(pathname));
  try {
    const info = await stat(file);
    return { file, size: info.size };
  } catch {
    return null;
  }
}
