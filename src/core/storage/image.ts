"use client";

// shrink on the phone before upload, this keeps both the request size and the ai cost low
export function drawToJpeg(source: CanvasImageSource, width: number, height: number, maxSize: number, quality = 0.7) {
  const scale = Math.min(1, maxSize / Math.max(width, height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  canvas.getContext("2d")?.drawImage(source, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

export function captureVideoFrame(video: HTMLVideoElement, maxSize: number, quality = 0.7) {
  if (!video.videoWidth) return null;
  return drawToJpeg(video, video.videoWidth, video.videoHeight, maxSize, quality);
}
