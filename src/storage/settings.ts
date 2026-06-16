import { STORAGE_KEYS } from "../config";
import type { Settings } from "../types";

const DEFAULT: Settings = {
  notificationRequested: false,
  installGuideDismissed: false,
};

export function getSettings(): Settings {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.settings);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<Settings>) };
  } catch {
    return { ...DEFAULT };
  }
}

export function setSettings(patch: Partial<Settings>): Settings {
  const next = { ...getSettings(), ...patch };
  localStorage.setItem(STORAGE_KEYS.settings, JSON.stringify(next));
  return next;
}
