"use client";

import { upload } from "@vercel/blob/client";
import type { FloorMap, View } from "@/core/map";
import { requestJson } from "@/core/storage/client";

type Config = { blob: boolean; ai: boolean };

export function fetchConfig() {
  return requestJson<Config>("/api/config");
}

function extension(type: string) {
  return type.includes("mp4") ? "mp4" : "webm";
}

function putWithProgress(url: string, body: Blob, onProgress: (percent: number) => void) {
  return new Promise<{ url: string }>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", url);
    xhr.setRequestHeader("Content-Type", body.type || "video/webm");
    xhr.upload.onprogress = (event) => event.lengthComputable && onProgress(Math.round((event.loaded / event.total) * 100));
    xhr.onload = () => (xhr.status < 300 ? resolve(JSON.parse(xhr.responseText)) : reject(new Error("Video upload failed")));
    xhr.onerror = () => reject(new Error("Video upload failed, check the connection"));
    xhr.send(body);
  });
}

export async function uploadVideo(mapId: string, video: Blob, onProgress: (percent: number) => void) {
  const config = await fetchConfig();
  if (!config.blob) return (await putWithProgress(`/api/videos?id=${mapId}`, video, onProgress)).url;
  // on vercel the video goes straight to blob storage, function bodies are limited to 4.5 mb
  const result = await upload(`videos/${mapId}.${extension(video.type)}`, video, {
    access: "public",
    handleUploadUrl: "/api/videos/upload",
    contentType: video.type || "video/webm",
    multipart: video.size > 8_000_000,
    onUploadProgress: ({ percentage }) => onProgress(Math.round(percentage)),
  });
  return result.url;
}

export function createMap(map: FloorMap, views: View[]) {
  return requestJson<FloorMap>("/api/maps", { method: "POST", body: JSON.stringify({ map, views }) });
}
