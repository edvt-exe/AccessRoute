"use client";

import { useSyncExternalStore } from "react";
import type { Role } from "@/core/map";

// small preferences that only live on this device
const changeEvent = "accessroute-device";

function readRaw(key: string) {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeDeviceValue(key: string, value: unknown) {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // private mode or full storage, the app still works without memory
  }
  window.dispatchEvent(new Event(changeEvent));
}

function subscribe(callback: () => void) {
  window.addEventListener("storage", callback);
  window.addEventListener(changeEvent, callback);
  return () => {
    window.removeEventListener("storage", callback);
    window.removeEventListener(changeEvent, callback);
  };
}

const cache = new Map<string, { raw: string | null; value: unknown }>();

function parse<T>(key: string, raw: string | null): T | null {
  const hit = cache.get(key);
  if (hit && hit.raw === raw) return hit.value as T | null;
  let value: T | null = null;
  try {
    value = raw ? (JSON.parse(raw) as T) : null;
  } catch {
    value = null;
  }
  cache.set(key, { raw, value });
  return value;
}

// undefined while rendering on the server and during hydration
export function useDeviceValue<T>(key: string): T | null | undefined {
  const raw = useSyncExternalStore(subscribe, () => readRaw(key), () => undefined);
  return raw === undefined ? undefined : parse<T>(key, raw);
}

export function readDeviceValue<T>(key: string) {
  return parse<T>(key, readRaw(key));
}

const roleKey = "accessroute.role";
const nameKey = "accessroute.name";

export function useRole() {
  return useDeviceValue<Role>(roleKey);
}

export function saveRole(role: Role | null) {
  writeDeviceValue(roleKey, role);
}

export function useStaffName() {
  return useDeviceValue<string>(nameKey);
}

export function saveStaffName(name: string) {
  writeDeviceValue(nameKey, name.trim());
}
