import { STORAGE_KEYS } from "../config";
import type { SyncMeta } from "../types";

const DEFAULT: SyncMeta = { lastSyncedAt: null, taskListId: null };

export function getSyncMeta(): SyncMeta {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.syncMeta);
    if (!raw) return { ...DEFAULT };
    return { ...DEFAULT, ...(JSON.parse(raw) as Partial<SyncMeta>) };
  } catch {
    return { ...DEFAULT };
  }
}

export function setSyncMeta(patch: Partial<SyncMeta>): SyncMeta {
  const next = { ...getSyncMeta(), ...patch };
  localStorage.setItem(STORAGE_KEYS.syncMeta, JSON.stringify(next));
  return next;
}
