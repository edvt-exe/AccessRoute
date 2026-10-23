"use client";

let wide = false;

// true when the picture comes from the 0.5x wide camera: things then look smaller and farther away
export function isWideCamera() {
  return wide;
}

// the wide back camera (0.5x) shows much more of a room in one picture, so it is used when the phone has
// one: by name on iphones ("back ultra wide camera"), by zooming out on phones that allow it, else the normal one
export async function openCamera(video: HTMLVideoElement, withAudio = false) {
  // no fixed size: a landscape size request gives a sideways picture on a phone held upright
  let stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: withAudio });
  wide = false;
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const ultra = devices.find((d) => d.kind === "videoinput" && /ultra|0[.,]5x?/i.test(d.label) && !/front|fa(ţ|t)/i.test(d.label));
    const current = stream.getVideoTracks()[0];
    if (ultra && current?.getSettings().deviceId !== ultra.deviceId) {
      // ios gives one camera at a time, the first one is let go before the wide one is opened
      stream.getTracks().forEach((t) => t.stop());
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { deviceId: { exact: ultra.deviceId } }, audio: withAudio });
        wide = true;
      } catch {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: withAudio });
      }
    } else if (ultra) {
      wide = true;
    } else {
      const track = stream.getVideoTracks()[0];
      const zoom = (track?.getCapabilities?.() as { zoom?: { min: number; max: number } } | undefined)?.zoom;
      if (track && zoom && zoom.min < 1) {
        await track.applyConstraints({ advanced: [{ zoom: Math.max(zoom.min, 0.5) } as MediaTrackConstraintSet] });
        wide = true;
      }
    }
  } catch {
    // the normal camera is fine too
  }
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
