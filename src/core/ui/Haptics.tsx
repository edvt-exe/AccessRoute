"use client";

import { useEffect } from "react";

const pressable = "button, a[href], [role='button'], input[type='checkbox'], input[type='radio'], select, summary";

// a short buzz on every press, so a person who cannot see the screen feels that the tap was taken.
// one listener for the whole app; phones without vibration (iphone safari) simply stay quiet
export function Haptics() {
  useEffect(() => {
    const buzz = (event: PointerEvent) => {
      const target = event.target as Element | null;
      const control = target?.closest?.(pressable);
      if (!control || control.matches(":disabled, [aria-disabled='true']")) return;
      try {
        navigator.vibrate?.(25);
      } catch {
        // not allowed here, nothing to do
      }
    };
    document.addEventListener("pointerdown", buzz, { capture: true, passive: true });
    return () => document.removeEventListener("pointerdown", buzz, { capture: true });
  }, []);
  return null;
}
