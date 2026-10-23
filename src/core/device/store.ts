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
const tutorialKey = "accessroute.tutorial";

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

// the guided person's own name, asked once before the tutorial
const guestKey = "accessroute.guest";

export function useGuestName() {
  return useDeviceValue<string>(guestKey);
}

export function readGuestName() {
  return readDeviceValue<string>(guestKey);
}

export function saveGuestName(name: string) {
  writeDeviceValue(guestKey, name.trim());
}

// the guided user's tutorial is played once, help plays it again
export function useTutorialDone() {
  return useDeviceValue<boolean>(tutorialKey);
}

export function saveTutorialDone(done: boolean) {
  writeDeviceValue(tutorialKey, done);
}

// the room where the last trip ended, the best guess for where a guided person starts the next one
const lastRoomKey = "accessroute.last-room";

export function readLastRoom() {
  return readDeviceValue<string>(lastRoomKey);
}

export function saveLastRoom(mapId: string) {
  writeDeviceValue(lastRoomKey, mapId);
}

// how this person walks with this phone: the length of a step, and how many real steps one counted
// step is (a phone that counts 12 when 10 were walked has a factor of 10 / 12)
export type StepProfile = { length: number; factor: number; calibrated: boolean };

const stepKey = "accessroute.steps";
export const defaultStepProfile: StepProfile = { length: 0.7, factor: 1, calibrated: false };

export function useStepProfile() {
  return useDeviceValue<StepProfile>(stepKey) ?? defaultStepProfile;
}

export function readStepProfile() {
  return readDeviceValue<StepProfile>(stepKey) ?? defaultStepProfile;
}

export function saveStepProfile(profile: StepProfile) {
  writeDeviceValue(stepKey, profile);
}

// a walking step is about 41% of a person's height
export function stepLengthFromHeight(centimetres: number) {
  return Math.round(Math.min(1, Math.max(0.45, centimetres * 0.00415)) * 100) / 100;
}

export function stepFactor(walked: number, counted: number) {
  if (counted <= 0) return null;
  return Math.round(Math.min(2.5, Math.max(0.4, walked / counted)) * 100) / 100;
}
