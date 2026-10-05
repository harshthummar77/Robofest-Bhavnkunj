/**
 * NODE REGISTRY — the only place in the codebase that holds an address.
 *
 * PROJECT_CONTEXT.md §12.1: data arrives from N independent hosts. The count
 * is not fixed and the split is not fixed either: a node publishes whatever
 * its hardware can read, and the ingest layer routes each recognised field to
 * the module that displays it. Adding, moving or merging a node is a registry
 * edit (env var or the Settings view), never a code edit.
 *
 * Defaults match the rover hardware in §11 — one Raspberry Pi 5 and two
 * ESP32s — so three addresses cover the whole machine.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import type { NodeConfig, SourceId } from "../lib/types";

const STORAGE_KEY = "orionpax:nodes-v2";

const env = import.meta.env;

function envUrl(key: string, fallback: string): string {
  const value = env[key as keyof typeof env] as string | undefined;
  return typeof value === "string" && value.length > 0 ? value.replace(/\/$/, "") : fallback;
}

/**
 * Compiled-in defaults.
 *
 * The split mirrors the hardware: the Pi 5 carries both cameras and the AI
 * HAT+, ESP32 A carries the environment sensors, ESP32 B reads iBUS and drives
 * the motors. Any other split works — the dashboard routes by payload content,
 * not by which host sent it.
 */
export function defaultNodes(): NodeConfig[] {
  return [
    {
      id: "pi",
      label: "Raspberry Pi 5 — cameras + AI",
      baseUrl: envUrl("VITE_NODE_PI", "http://192.168.1.50:8000"),
      transport: "http-poll",
      telemetryPath: "/telemetry",
      expectedIntervalMs: 500,
      enabled: true,
      cameraPath: "/stream.mjpg",
      thermalPath: "/thermal.mjpg",
      mockProfiles: ["vision", "thermal"],
    },
    {
      id: "esp32a",
      label: "ESP32 A — environment sensors",
      baseUrl: envUrl("VITE_NODE_ESP32_A", "http://192.168.1.51"),
      transport: "http-poll",
      telemetryPath: "/api/sensors",
      expectedIntervalMs: 2000,
      enabled: true,
      mockProfiles: ["environment"],
    },
    {
      id: "esp32b",
      label: "ESP32 B — drive, LiDAR, RC link",
      baseUrl: envUrl("VITE_NODE_ESP32_B", "http://192.168.1.52"),
      transport: "http-poll",
      telemetryPath: "/api/status",
      expectedIntervalMs: 300,
      enabled: true,
      mockProfiles: ["motion"],
    },
  ];
}

/* ------------------------------------------------------------------ */
/* Tuning constants                                                    */
/* ------------------------------------------------------------------ */

/**
 * Staleness multipliers. A node is STALE once it has been silent for longer
 * than `expectedIntervalMs * STALE_FACTOR`, and OFFLINE after
 * `expectedIntervalMs * OFFLINE_FACTOR` or a failed connection.
 */
export const STALE_FACTOR = 3;
export const OFFLINE_FACTOR = 10;

/** Reconnect backoff, milliseconds. Per node, independent. §12.1 rule 2. */
export const BACKOFF_MS = [500, 1000, 2000, 4000, 8000, 15000] as const;

/* ------------------------------------------------------------------ */
/* Persistence                                                         */
/* ------------------------------------------------------------------ */

function sanitise(entry: unknown, index: number): NodeConfig | null {
  if (typeof entry !== "object" || entry === null) return null;
  const raw = entry as Record<string, unknown>;
  const baseUrl = typeof raw.baseUrl === "string" ? raw.baseUrl.replace(/\/$/, "") : "";
  const id = typeof raw.id === "string" && raw.id.length > 0 ? raw.id : `node${index + 1}`;
  const transport =
    raw.transport === "websocket" || raw.transport === "none" ? raw.transport : "http-poll";

  return {
    id,
    label: typeof raw.label === "string" && raw.label.length > 0 ? raw.label : id,
    baseUrl,
    transport,
    telemetryPath: typeof raw.telemetryPath === "string" ? raw.telemetryPath : "/telemetry",
    expectedIntervalMs:
      typeof raw.expectedIntervalMs === "number" && raw.expectedIntervalMs >= 50
        ? raw.expectedIntervalMs
        : 1000,
    enabled: raw.enabled !== false,
    cameraPath: typeof raw.cameraPath === "string" && raw.cameraPath ? raw.cameraPath : undefined,
    thermalPath:
      typeof raw.thermalPath === "string" && raw.thermalPath ? raw.thermalPath : undefined,
    mockProfiles: Array.isArray(raw.mockProfiles)
      ? (raw.mockProfiles.filter(
          (profile) =>
            profile === "vision" ||
            profile === "thermal" ||
            profile === "environment" ||
            profile === "motion",
        ) as NodeConfig["mockProfiles"])
      : undefined,
  };
}

function load(): NodeConfig[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultNodes();
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return defaultNodes();
    const nodes = parsed
      .map(sanitise)
      .filter((node): node is NodeConfig => node !== null && node.baseUrl.length > 0);
    return nodes.length > 0 ? nodes : defaultNodes();
  } catch {
    return defaultNodes();
  }
}

function persist(nodes: NodeConfig[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(nodes));
  } catch {
    // Private browsing / quota — the in-memory registry still works.
  }
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

interface NodeRegistryState {
  nodes: NodeConfig[];
  /** Bumped whenever the address set changes, so the runtime can restart. */
  revision: number;
  replaceAll(nodes: NodeConfig[]): void;
  resetToDefaults(): void;
}

export const useNodeRegistry = create<NodeRegistryState>()((set) => ({
  nodes: load(),
  revision: 0,
  replaceAll(nodes) {
    const cleaned = nodes
      .map(sanitise)
      .filter((node): node is NodeConfig => node !== null && node.baseUrl.length > 0);
    persist(cleaned);
    set((state) => ({ nodes: cleaned, revision: state.revision + 1 }));
  },
  resetToDefaults() {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* ignore */
    }
    set((state) => ({ nodes: defaultNodes(), revision: state.revision + 1 }));
  },
}));

/* ------------------------------------------------------------------ */
/* Reads                                                               */
/* ------------------------------------------------------------------ */

/** Every configured node, enabled or not. */
export function allNodes(): NodeConfig[] {
  return useNodeRegistry.getState().nodes;
}

/** The nodes the runtime should talk to. */
export function activeNodes(): NodeConfig[] {
  return allNodes().filter((node) => node.enabled);
}

export function tryGetNode(id: SourceId): NodeConfig | undefined {
  return allNodes().find((node) => node.id === id);
}

export function getNode(id: SourceId): NodeConfig {
  const node = tryGetNode(id);
  if (!node) throw new Error(`Unknown node id "${id}".`);
  return node;
}

/** Subscription hook. Shallow-compared so a re-render needs a real change. */
export function useNodes(): NodeConfig[] {
  return useNodeRegistry(useShallow((state) => state.nodes));
}

/* ------------------------------------------------------------------ */
/* URL building — the only sanctioned way to address a node            */
/* ------------------------------------------------------------------ */

export function nodeUrl(node: NodeConfig, path?: string): string {
  const base = node.baseUrl.replace(/\/$/, "");
  if (!path) return base;
  return `${base}${path.startsWith("/") ? path : `/${path}`}`;
}

/** Telemetry endpoint for a node, or null when it publishes no JSON. */
export function nodeTelemetryUrl(node: NodeConfig): string | null {
  if (node.transport === "none" || !node.telemetryPath) return null;
  return nodeUrl(node, node.telemetryPath);
}

/** WebSocket URL for a node, scheme-converted from its baseUrl. */
export function nodeSocketUrl(node: NodeConfig): string {
  return nodeUrl(node, node.telemetryPath || "/ws").replace(/^http/, "ws");
}

/**
 * Whether the browser will refuse to talk to this address.
 *
 * PROJECT_CONTEXT.md §12.1 rule 13: every node must share one scheme with the
 * dashboard. A page served over HTTPS cannot read an `http://` node — the
 * browser blocks the request as mixed content before it reaches the network,
 * and the only symptom is a node that never answers. A dashboard hosted on
 * Vercel (always HTTPS) therefore cannot reach a rover node on a plain-HTTP
 * LAN address, so the UI says so rather than letting it read as "offline".
 */
export function mixedContentBlocked(baseUrl: string): boolean {
  if (typeof window === "undefined") return false;
  if (window.location.protocol !== "https:") return false;
  return /^http:\/\//i.test(baseUrl.trim());
}

/** The first enabled node serving an RGB camera stream, if any. */
export function rgbStreamUrl(nodes: NodeConfig[] = activeNodes()): string | null {
  const node = nodes.find((entry) => entry.enabled && entry.cameraPath);
  return node ? nodeUrl(node, node.cameraPath) : null;
}

/** The first enabled node serving a thermal image stream, if any. */
export function thermalStreamUrl(nodes: NodeConfig[] = activeNodes()): string | null {
  const node = nodes.find((entry) => entry.enabled && entry.thermalPath);
  return node ? nodeUrl(node, node.thermalPath) : null;
}

/**
 * Where mission-recording commands are POSTed.
 *
 * The dashboard sends no motor commands at all (§4.7); this path only records
 * the mission. It goes to the first enabled node with a telemetry channel.
 */
export function commandEndpoint(): string | null {
  const node = activeNodes().find((entry) => entry.transport !== "none");
  return node ? nodeUrl(node, "/command") : null;
}
