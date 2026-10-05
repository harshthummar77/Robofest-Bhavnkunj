/**
 * DATA MODE — mock or real, one switch for the whole dashboard.
 *
 * `real` connects the per-node connectors to the addresses in the registry.
 * `mock` runs a simulated rover inside the browser instead: no node, no
 * network, no mock server to start. Both paths feed the identical ingest
 * pipeline, so what you see in mock mode is what the real payloads will drive.
 *
 * The mode is visible everywhere it matters — the header carries a MOCK badge
 * while it is on — because a simulated reading must never be mistaken for a
 * reading off the rover.
 */

import { create } from "zustand";

export type DataMode = "mock" | "real";

const STORAGE_KEY = "orionpax:data-mode";

function load(): DataMode {
  try {
    return localStorage.getItem(STORAGE_KEY) === "real" ? "real" : "mock";
  } catch {
    return "mock";
  }
}

interface DataModeState {
  mode: DataMode;
  setMode(mode: DataMode): void;
  toggle(): void;
}

export const useDataModeStore = create<DataModeState>()((set, get) => ({
  mode: load(),
  setMode(mode) {
    if (get().mode === mode) return;
    try {
      localStorage.setItem(STORAGE_KEY, mode);
    } catch {
      /* ignore */
    }
    set({ mode });
  },
  toggle() {
    get().setMode(get().mode === "mock" ? "real" : "mock");
  },
}));

/** Current mode, outside React. */
export function dataMode(): DataMode {
  return useDataModeStore.getState().mode;
}

/** Subscribe to the mode. */
export function useDataMode(): DataMode {
  return useDataModeStore((state) => state.mode);
}

export function useIsMockMode(): boolean {
  return useDataModeStore((state) => state.mode === "mock");
}
