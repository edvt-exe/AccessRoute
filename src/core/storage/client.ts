"use client";

import { useEffect, useRef, useState } from "react";

export async function requestJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { "Content-Type": "application/json", ...init?.headers },
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof body.error === "string" ? body.error : `Request failed (${response.status})`);
  }
  return body as T;
}

type Loaded<T> = { status: "loading" } | { status: "ready"; data: T } | { status: "error"; error: string };

// loads once per url, reload() fetches again
export function useJson<T>(url: string | null) {
  const [state, setState] = useState<{ url: string | null; value: Loaded<T>; round: number }>({
    url: null,
    value: { status: "loading" },
    round: 0,
  });
  const [round, setRound] = useState(0);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    requestJson<T>(url)
      .then((data) => !cancelled && setState({ url, value: { status: "ready", data }, round }))
      .catch((error: Error) => !cancelled && setState({ url, value: { status: "error", error: error.message }, round }));
    return () => {
      cancelled = true;
    };
  }, [url, round]);

  const value: Loaded<T> = state.url === url ? state.value : { status: "loading" };
  return { ...value, reload: () => setRound((r) => r + 1) } as Loaded<T> & { reload: () => void };
}

// polls a json endpoint while the tab is visible and reports changes
export function usePolledJson<T>(url: string | null, intervalMs: number, onChange?: (next: T, previous: T | null) => void) {
  const [data, setData] = useState<{ url: string; value: T } | null>(null);
  const onChangeRef = useRef(onChange);
  const last = useRef<{ raw: string; value: T } | null>(null);

  useEffect(() => {
    onChangeRef.current = onChange;
  }, [onChange]);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    last.current = null;

    async function tick() {
      if (document.hidden) return;
      try {
        const response = await fetch(url!, { cache: "no-store" });
        if (!response.ok || cancelled) return;
        const raw = await response.text();
        if (cancelled || raw === last.current?.raw) return;
        const value = JSON.parse(raw) as T;
        const previous = last.current?.value ?? null;
        last.current = { raw, value };
        setData({ url: url!, value });
        onChangeRef.current?.(value, previous);
      } catch {
        // offline for a moment, the next tick tries again
      }
    }

    void tick();
    const timer = window.setInterval(tick, intervalMs);
    document.addEventListener("visibilitychange", tick);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", tick);
    };
  }, [url, intervalMs]);

  return data && data.url === url ? data.value : null;
}
