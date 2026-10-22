import { open } from "node:fs/promises";
import { mapIdSchema } from "@/core/map";
import { localFile, useBlob, writeLocalFile } from "@/core/storage/blob";

// local only: on vercel videos go straight to blob storage through /api/videos/upload
const maxBytes = 200_000_000;

function videoPath(id: string, type: string) {
  return `videos/${id}.${type.includes("mp4") ? "mp4" : "webm"}`;
}

export async function PUT(request: Request) {
  if (useBlob) return Response.json({ error: "Upload videos through blob storage." }, { status: 400 });
  const id = new URL(request.url).searchParams.get("id") ?? "";
  if (!mapIdSchema.safeParse(id).success) return Response.json({ error: "Unknown map" }, { status: 400 });
  const type = request.headers.get("content-type") ?? "video/webm";
  const data = Buffer.from(await request.arrayBuffer());
  if (data.length === 0 || data.length > maxBytes) return Response.json({ error: "The video is empty or too large." }, { status: 400 });
  await writeLocalFile(videoPath(id, type), data);
  return Response.json({ url: `/api/videos?id=${id}&type=${type.includes("mp4") ? "mp4" : "webm"}` });
}

// a browser cancels video requests all the time while seeking, a stream closed under node then crashes the
// server ("controller is already closed"), so every answer is a plain buffer of at most a few megabytes
const chunk = 4_000_000;

async function readPart(file: string, start: number, end: number) {
  const handle = await open(file, "r");
  try {
    const buffer = Buffer.alloc(end - start + 1);
    await handle.read(buffer, 0, buffer.length, start);
    return buffer;
  } finally {
    await handle.close();
  }
}

// supports range requests so reviewers can jump around in the video
export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const id = params.get("id") ?? "";
  const ext = params.get("type") === "mp4" ? "mp4" : "webm";
  if (!mapIdSchema.safeParse(id).success) return new Response("Not found", { status: 404 });
  const found = await localFile(`videos/${id}.${ext}`);
  if (!found) return new Response("Not found", { status: 404 });

  const contentType = ext === "mp4" ? "video/mp4" : "video/webm";
  const range = /bytes=(\d*)-(\d*)/.exec(request.headers.get("range") ?? "");
  if (!range && found.size <= chunk) {
    const body = await readPart(found.file, 0, found.size - 1);
    return new Response(new Uint8Array(body), { headers: { "Content-Type": contentType, "Content-Length": String(found.size), "Accept-Ranges": "bytes" } });
  }
  const start = range?.[1] ? Number(range[1]) : 0;
  const end = Math.min(range?.[2] ? Number(range[2]) : start + chunk - 1, start + chunk - 1, found.size - 1);
  if (start > end) return new Response(null, { status: 416, headers: { "Content-Range": `bytes */${found.size}` } });
  const body = await readPart(found.file, start, end);
  return new Response(new Uint8Array(body), {
    status: 206,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(body.length),
      "Content-Range": `bytes ${start}-${end}/${found.size}`,
      "Accept-Ranges": "bytes",
    },
  });
}
