"use client";

import fixWebmDuration from "fix-webm-duration";

const types = ["video/webm;codecs=vp9", "video/webm;codecs=vp8", "video/webm", "video/mp4"];

export function createVideoRecorder(stream: MediaStream) {
  const mimeType = types.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t));
  // ~600 kbit/s keeps one minute of video around 4.5 mb, enough to check the walk
  const recorder = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 600_000 });
  const chunks: Blob[] = [];
  recorder.ondataavailable = (event) => {
    if (event.data.size > 0) chunks.push(event.data);
  };

  function collected() {
    return new Blob(chunks, { type: recorder.mimeType || "video/webm" });
  }

  // chrome writes webm files without a duration, which breaks seeking in the review video
  async function stop(durationMs: number): Promise<Blob> {
    const blob =
      recorder.state === "inactive"
        ? collected()
        : await new Promise<Blob>((resolve) => {
            recorder.onstop = () => resolve(collected());
            recorder.stop();
          });
    if (!blob.type.includes("webm")) return blob;
    try {
      return await fixWebmDuration(blob, durationMs, { logger: false });
    } catch {
      return blob;
    }
  }

  return {
    start: () => recorder.start(1000),
    pause: () => recorder.state === "recording" && recorder.pause(),
    resume: () => recorder.state === "paused" && recorder.resume(),
    stop,
  };
}

export function canRecordVideo() {
  return typeof window !== "undefined" && typeof MediaRecorder !== "undefined" && Boolean(navigator.mediaDevices);
}
