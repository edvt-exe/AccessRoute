"use client";

export async function openCamera(video: HTMLVideoElement, withAudio = false) {
  const stream = await navigator.mediaDevices.getUserMedia({
    // no fixed size: a landscape size request gives a sideways picture on a phone held upright
    video: { facingMode: { ideal: "environment" } },
    audio: withAudio,
  });
  video.srcObject = stream;
  video.muted = true;
  await video.play();
  return stream;
}

export function closeCamera(stream: MediaStream | null) {
  stream?.getTracks().forEach((track) => track.stop());
}

export function cameraErrorMessage(error: unknown) {
  const name = error instanceof DOMException ? error.name : "";
  if (name === "NotAllowedError") return "Camera access was blocked. Allow the camera for this site in the browser settings.";
  if (name === "NotFoundError") return "No camera was found on this device.";
  if (!window.isSecureContext) return "The camera only works on https or localhost.";
  return "The camera could not be started.";
}
