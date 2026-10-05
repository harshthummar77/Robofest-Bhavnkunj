/**
 * INGEST — one entry point for every payload from every node.
 *
 * PROJECT_CONTEXT.md §12.1 says the dashboard must treat N independent hosts
 * as the normal case. It does not say which host sends what, and on this rover
 * that split is genuinely fluid: the Pi may publish cameras and thermal
 * together, one ESP32 may publish BME280 + MQ gas, the other iBUS + LiDAR +
 * battery — or the whole lot may arrive from a single address.
 *
 * So routing is by **payload content, not by host**. This module takes any
 * JSON object from any node, recognises the values a component in §11 can
 * actually produce, and emits a patch keyed by telemetry field. The store tags
 * each field with the node that delivered it, and the module that owns that
 * field renders it — thermal data lands on the thermal page no matter which IP
 * it came from.
 *
 * Three rules hold the trust boundary:
 *
 * 1. **Recognise, never guess.** A key is accepted only when its name (or its
 *    parent's name) matches a known sensor alias AND the value passes a range
 *    check for that physical quantity. Anything else is reported as an
 *    unrecognised key in Settings, not silently mapped.
 * 2. **Absent stays absent.** A field that is not in a payload is simply not
 *    in the patch, so it resolves to "unavailable" instead of zero.
 *    §12.1 rule 7.
 * 3. **No invented units.** Conversions only happen where the unit is
 *    unambiguous (Pa to hPa, mm to cm, knots to km/h, centi-degrees to
 *    degrees); otherwise the value is taken as the sensor's native unit.
 */

import { z } from "zod";
import { hotspotBand, percentFromPackVoltage } from "./thresholds";
import type {
  BatteryReading,
  Detection,
  DriveReading,
  GasReading,
  GpsReading,
  Hotspot,
  ImuReading,
  LidarReading,
  Pose,
  RfLinkReading,
  StatusLevel,
  TelemetryField,
  ThermalFrame,
} from "./types";

export type FieldPatch = Partial<Record<TelemetryField, unknown>>;

export interface IngestResult {
  patch: FieldPatch;
  /** Fields this payload actually carried. */
  fields: TelemetryField[];
  /** Payload keys nothing in the catalogue matched. */
  unknownKeys: string[];
  /** Node-reported time, or receipt time when the node sends none usable. */
  timestamp: number;
  /** Person IDs this payload confirms thermally. */
  confirmsPersonIds: string[];
}

/* ------------------------------------------------------------------ */
/* Leaf index                                                          */
/* ------------------------------------------------------------------ */

type Scalar = number | boolean | string;

interface Leaf {
  /** Dotted path, as written in the payload. */
  path: string;
  /** Last path segment, normalised. */
  key: string;
  /** Whole path, normalised and concatenated. */
  scope: string;
  value: Scalar;
}

interface ArrayNode {
  path: string;
  key: string;
  scope: string;
  value: unknown[];
}

/**
 * Sensor blocks a node has declared unavailable.
 *
 * Firmware commonly reports `{ "bme280": { "available": false, "temperature": 0 } }`
 * when a sensor failed to initialise. Those zeros are not readings, and
 * displaying them would be the exact failure §12.1 rule 7 forbids — a false
 * 0 reads as a real measurement. Everything under such a block is dropped.
 */
function unavailablePrefixes(raw: Record<string, unknown>): string[] {
  const prefixes: string[] = [];
  for (const [key, value] of Object.entries(raw)) {
    if (value === null || typeof value !== "object" || Array.isArray(value)) continue;
    const block = value as Record<string, unknown>;
    const flag = block.available ?? block.ok ?? block.present ?? block.detected;
    if (flag === false) prefixes.push(`${key}.`);
  }
  return prefixes;
}

function norm(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9]/g, "");
}

const MAX_DEPTH = 6;

/** Flatten an arbitrary payload into scalar leaves and arrays. */
function index(raw: Record<string, unknown>): { leaves: Leaf[]; arrays: ArrayNode[] } {
  const leaves: Leaf[] = [];
  const arrays: ArrayNode[] = [];

  function walk(value: unknown, path: string[], depth: number): void {
    if (depth > MAX_DEPTH) return;

    if (Array.isArray(value)) {
      const key = path[path.length - 1] ?? "";
      arrays.push({
        path: path.join("."),
        key: norm(key),
        scope: norm(path.join("")),
        value,
      });
      return;
    }

    if (value !== null && typeof value === "object") {
      for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
        walk(child, [...path, key], depth + 1);
      }
      return;
    }

    if (typeof value === "number" || typeof value === "boolean" || typeof value === "string") {
      const key = path[path.length - 1] ?? "";
      leaves.push({
        path: path.join("."),
        key: norm(key),
        scope: norm(path.join("")),
        value,
      });
    }
  }

  walk(raw, [], 0);

  const dropped = unavailablePrefixes(raw);
  if (dropped.length === 0) return { leaves, arrays };

  const kept = (path: string) => !dropped.some((prefix) => path.startsWith(prefix));
  return {
    leaves: leaves.filter((leaf) => kept(leaf.path)),
    arrays: arrays.filter((entry) => kept(entry.path)),
  };
}

/* ------------------------------------------------------------------ */
/* Sensor scopes — the parent names that disambiguate a generic key     */
/* ------------------------------------------------------------------ */

const SCOPE = {
  env: ["bme280", "bme", "environment", "env", "climate", "atmosphere", "air"],
  imu: ["mpu6050", "mpu", "imu", "gyro", "gyroscope", "accel", "accelerometer", "orientation"],
  lidar: ["tfluna", "luna", "lidar", "tof", "rangefinder", "obstacle"],
  cpu: ["cpu", "soc", "board", "system", "host", "pi", "raspberry", "throttle_state"],
  thermal: ["mlx90640", "mlx", "thermal", "ir", "heat", "thermography"],
  battery: ["battery", "batt", "pack", "power", "supply"],
  gps: ["gps", "gnss", "neo6m", "neo", "ublox"],
  rf: ["ibus", "rf", "rc", "flysky", "fsi6", "fsia6b", "transmitter", "receiver", "radio", "rclink"],
  drive: ["drive", "motor", "motors", "bts7960", "wheel", "wheels", "locomotion"],
  camera: ["camera", "vision", "rgb", "picam", "cam", "video"],
  pose: ["pose", "position", "odom", "odometry", "location", "coords", "coordinates"],
} as const;

function inScope(leaf: { scope: string }, scopes: readonly string[]): boolean {
  return scopes.some((scope) => leaf.scope.includes(scope));
}

/* ------------------------------------------------------------------ */
/* Picker                                                              */
/* ------------------------------------------------------------------ */

interface PickOptions {
  /** Accept only when the path sits under one of these sensor scopes. */
  under?: readonly string[];
  /** Reject when the path sits under one of these scopes. */
  notUnder?: readonly string[];
  /** Inclusive sanity range for a numeric value. */
  range?: [number, number];
}

class Picker {
  private readonly consumed = new Set<string>();
  private readonly leaves: Leaf[];
  private readonly arrays: ArrayNode[];

  constructor(leaves: Leaf[], arrays: ArrayNode[]) {
    this.leaves = leaves;
    this.arrays = arrays;
  }

  /** First leaf matching any alias, respecting scope and range constraints. */
  leaf(aliases: readonly string[], options: PickOptions = {}): Leaf | null {
    // Scoped matches win over bare ones: `bme280.temperature` beats `temp`.
    const candidates = this.leaves.filter((leaf) => {
      if (!aliases.includes(leaf.key)) return false;
      if (options.notUnder && inScope(leaf, options.notUnder)) return false;
      if (options.under && !inScope(leaf, options.under)) return false;
      if (options.range && typeof leaf.value === "number") {
        if (!Number.isFinite(leaf.value)) return false;
        if (leaf.value < options.range[0] || leaf.value > options.range[1]) return false;
      }
      return true;
    });
    if (candidates.length === 0) return null;
    const scoped = options.under
      ? candidates
      : candidates.filter((leaf) => leaf.scope !== leaf.key);
    const chosen = (scoped.length > 0 ? scoped : candidates)[0];
    this.consumed.add(chosen.path);
    return chosen;
  }

  number(aliases: readonly string[], options: PickOptions = {}): number | null {
    const leaf = this.leaf(aliases, options);
    if (!leaf) return null;
    const value =
      typeof leaf.value === "number"
        ? leaf.value
        : typeof leaf.value === "string" && leaf.value.trim() !== ""
          ? Number(leaf.value)
          : Number.NaN;
    return Number.isFinite(value) ? value : null;
  }

  /** Same as `number`, but also reports which key supplied it. */
  numberWithKey(
    aliases: readonly string[],
    options: PickOptions = {},
  ): { value: number; key: string } | null {
    const leaf = this.leaf(aliases, options);
    if (!leaf) return null;
    const value = typeof leaf.value === "number" ? leaf.value : Number(leaf.value);
    return Number.isFinite(value) ? { value, key: leaf.key } : null;
  }

  boolean(aliases: readonly string[], options: PickOptions = {}): boolean | null {
    const leaf = this.leaf(aliases, options);
    if (!leaf) return null;
    if (typeof leaf.value === "boolean") return leaf.value;
    if (typeof leaf.value === "number") return leaf.value !== 0;
    const text = leaf.value.trim().toLowerCase();
    if (["true", "yes", "ok", "online", "connected", "1", "up"].includes(text)) return true;
    if (["false", "no", "offline", "lost", "0", "down"].includes(text)) return false;
    return null;
  }

  string(aliases: readonly string[], options: PickOptions = {}): string | null {
    const leaf = this.leaf(aliases, options);
    if (!leaf) return null;
    return typeof leaf.value === "string" ? leaf.value : String(leaf.value);
  }

  array(aliases: readonly string[], options: { under?: readonly string[] } = {}): ArrayNode | null {
    const match = this.arrays.find((entry) => {
      if (!aliases.includes(entry.key)) return false;
      if (options.under && !inScope(entry, options.under)) return false;
      return true;
    });
    if (!match) return null;
    this.consumed.add(match.path);
    return match;
  }

  /** Any numeric array of a plausible thermal-frame length. */
  numericArray(aliases: readonly string[], minLength: number): ArrayNode | null {
    const match = this.arrays.find(
      (entry) =>
        aliases.includes(entry.key) &&
        entry.value.length >= minLength &&
        entry.value.every((cell) => typeof cell === "number"),
    );
    if (!match) return null;
    this.consumed.add(match.path);
    return match;
  }

  consume(path: string): void {
    this.consumed.add(path);
  }

  /** Every path the extractors did not claim. */
  unclaimed(): string[] {
    const ignorable = new Set([
      "timestamp",
      "ts",
      "time",
      "millis",
      "uptime",
      "uptimems",
      "node",
      "nodeid",
      "id",
      "name",
      "ok",
      "status",
      "version",
      "fw",
      "firmware",
      "seq",
      "count",
      "freeheap",
      "rssi",
      "wifirssi",
      "ip",
      "mac",
      "ssid",
      // Housekeeping a node reports about itself, not a measurement.
      "available",
      "present",
      "online",
      "enabled",
      "charactersreceived",
      "bytesreceived",
    ]);
    const out: string[] = [];
    for (const leaf of this.leaves) {
      if (this.consumed.has(leaf.path)) continue;
      if (ignorable.has(leaf.key)) continue;
      // Pin assignments and similar wiring detail are configuration, not data.
      if (/gpio|pin$|_pin/.test(leaf.key)) continue;
      out.push(leaf.path);
    }
    for (const entry of this.arrays) {
      if (this.consumed.has(entry.path)) continue;
      out.push(`${entry.path}[]`);
    }
    return out.slice(0, 40);
  }
}

/* ------------------------------------------------------------------ */
/* Structured sub-payloads — validated at the boundary                 */
/* ------------------------------------------------------------------ */

const boxSchema = z.union([
  z.object({ x: z.number(), y: z.number(), w: z.number(), h: z.number() }),
  z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }),
  z.object({ x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number() }),
  z.object({ xmin: z.number(), ymin: z.number(), xmax: z.number(), ymax: z.number() }),
  z.array(z.number()).length(4),
]);

const detectionSchema = z.object({
  personId: z.string().optional(),
  id: z.union([z.string(), z.number()]).optional(),
  trackId: z.union([z.string(), z.number()]).optional(),
  track_id: z.union([z.string(), z.number()]).optional(),
  confidence: z.number().optional(),
  score: z.number().optional(),
  label: z.string().optional(),
  class: z.string().optional(),
  className: z.string().optional(),
  detectedAt: z.number().optional(),
  box: boxSchema.optional(),
  bbox: boxSchema.optional(),
  bounds: boxSchema.optional(),
  x: z.number().optional(),
  y: z.number().optional(),
  w: z.number().optional(),
  h: z.number().optional(),
});

const gasEntrySchema = z.object({
  sensorId: z.string().optional(),
  id: z.string().optional(),
  sensor: z.string().optional(),
  label: z.string().optional(),
  name: z.string().optional(),
  raw: z.number().optional(),
  value: z.number().optional(),
  adc: z.number().optional(),
  unit: z.string().optional(),
  adcMax: z.number().optional(),
});

const hotspotEntrySchema = z.object({
  x: z.number(),
  y: z.number(),
  celsius: z.number().optional(),
  temp: z.number().optional(),
  temperature: z.number().optional(),
  humanLike: z.boolean().optional(),
  human: z.boolean().optional(),
});

/* ------------------------------------------------------------------ */
/* Per-component extractors                                           */
/* ------------------------------------------------------------------ */

/** MLX90640 row length, assumed when a node omits the frame dimensions. */
const MLX_WIDTH = 32;

function extractThermalFrame(pick: Picker): ThermalFrame | null {
  const array = pick.numericArray(
    ["cells", "pixels", "frame", "data", "temps", "temperatures", "matrix", "grid", "thermal"],
    64,
  );
  if (!array) return null;

  let cells = array.value as number[];
  // Some drivers publish centi-degrees as integers. 768 cells all above 200 is
  // not a thermal scene, it is a scale factor.
  if (cells.every((cell) => Math.abs(cell) > 200)) cells = cells.map((cell) => cell / 100);
  if (!cells.every((cell) => Number.isFinite(cell) && cell > -50 && cell < 400)) return null;

  const width =
    pick.number(["width", "cols", "columns"], { range: [2, 1024] }) ??
    (cells.length % MLX_WIDTH === 0 ? MLX_WIDTH : null);
  const height =
    pick.number(["height", "rows"], { range: [2, 1024] }) ??
    (width ? Math.floor(cells.length / width) : null);

  if (!width || !height || width * height > cells.length) return null;
  return { width, height, cells: cells.slice(0, width * height) };
}

/**
 * Hotspots from a raw frame, for a node that sends pixels and nothing else.
 *
 * A greedy cluster pass over cells warmer than the scene's own baseline. This
 * is interpretation, so it lives behind the same threshold module every other
 * status derivation uses (§13) — a component never derives its own.
 */
function deriveHotspots(frame: ThermalFrame): Hotspot[] {
  const { width, height, cells } = frame;
  const sorted = [...cells].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const floorC = Math.max(median + 5, 28);

  const seen = new Uint8Array(cells.length);
  const hotspots: Hotspot[] = [];

  for (let i = 0; i < cells.length && hotspots.length < 6; i += 1) {
    if (seen[i] || cells[i] < floorC) continue;

    // Flood fill the warm blob this cell belongs to.
    const stack = [i];
    let sumX = 0;
    let sumY = 0;
    let size = 0;
    let peak = cells[i];
    seen[i] = 1;

    while (stack.length > 0) {
      const index_ = stack.pop() as number;
      const x = index_ % width;
      const y = Math.floor(index_ / width);
      sumX += x;
      sumY += y;
      size += 1;
      if (cells[index_] > peak) peak = cells[index_];

      const neighbours = [
        x > 0 ? index_ - 1 : -1,
        x < width - 1 ? index_ + 1 : -1,
        y > 0 ? index_ - width : -1,
        y < height - 1 ? index_ + width : -1,
      ];
      for (const next of neighbours) {
        if (next < 0 || seen[next] || cells[next] < floorC) continue;
        seen[next] = 1;
        stack.push(next);
      }
    }

    // A single warm pixel is noise, not a finding.
    if (size < 4) continue;
    hotspots.push({
      x: sumX / size / width,
      y: sumY / size / height,
      celsius: peak,
      band: hotspotBand(peak),
      humanLike: peak >= 30 && peak <= 42,
    });
  }

  return hotspots;
}

/**
 * Bounding box in normalised 0..1 form.
 *
 * Pixel coordinates are converted only when the payload also states the frame
 * size — guessing 640x480 would silently misplace every overlay.
 */
function normaliseBox(
  raw: unknown,
  frame: { width: number; height: number } | null,
): Detection["box"] | null {
  if (raw === null || raw === undefined) return null;

  let x: number;
  let y: number;
  let w: number;
  let h: number;

  if (Array.isArray(raw) && raw.length === 4 && raw.every((n) => typeof n === "number")) {
    [x, y, w, h] = raw as number[];
  } else if (typeof raw === "object") {
    const box = raw as Record<string, number>;
    if (box.x2 !== undefined || box.xmax !== undefined) {
      const x1 = box.x1 ?? box.xmin ?? 0;
      const y1 = box.y1 ?? box.ymin ?? 0;
      const x2 = box.x2 ?? box.xmax ?? 0;
      const y2 = box.y2 ?? box.ymax ?? 0;
      x = Math.min(x1, x2);
      y = Math.min(y1, y2);
      w = Math.abs(x2 - x1);
      h = Math.abs(y2 - y1);
    } else {
      x = box.x ?? 0;
      y = box.y ?? 0;
      w = box.w ?? box.width ?? 0;
      h = box.h ?? box.height ?? 0;
    }
  } else {
    return null;
  }

  if (![x, y, w, h].every((value) => Number.isFinite(value))) return null;

  const looksLikePixels = x > 1.5 || y > 1.5 || w > 1.5 || h > 1.5;
  if (looksLikePixels) {
    if (!frame) return null;
    x /= frame.width;
    y /= frame.height;
    w /= frame.width;
    h /= frame.height;
  }

  if (w <= 0 || h <= 0) return null;
  return {
    x: Math.min(1, Math.max(0, x)),
    y: Math.min(1, Math.max(0, y)),
    w: Math.min(1, w),
    h: Math.min(1, h),
  };
}

/**
 * Person-ID assignment for nodes that do not track.
 *
 * A node that reports a track id keeps it. A node that only reports boxes gets
 * ids assigned here by nearest-centroid match against the previous frame — a
 * deliberate minimum, not re-identification. Re-identification across loss of
 * track is explicitly out of scope (PROJECT_CONTEXT.md §14), so a person who
 * leaves and returns may be given a new ID, and the UI never claims otherwise.
 */
interface Tracker {
  counter: number;
  previous: { id: string; cx: number; cy: number }[];
}

const trackers = new Map<string, Tracker>();

function assignPersonId(
  sourceId: string,
  box: Detection["box"],
  claimed: string | undefined,
  matched: Set<string>,
): string {
  if (claimed) return claimed;

  const tracker = trackers.get(sourceId) ?? { counter: 0, previous: [] };
  trackers.set(sourceId, tracker);

  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;

  let best: { id: string; distance: number } | null = null;
  for (const entry of tracker.previous) {
    if (matched.has(entry.id)) continue;
    const distance = Math.hypot(entry.cx - cx, entry.cy - cy);
    if (distance < 0.18 && (best === null || distance < best.distance)) {
      best = { id: entry.id, distance };
    }
  }

  if (best) return best.id;
  tracker.counter += 1;
  return `P-${String(tracker.counter).padStart(3, "0")}`;
}

function rememberTracks(sourceId: string, detections: Detection[]): void {
  const tracker = trackers.get(sourceId);
  if (!tracker) return;
  tracker.previous = detections.map((detection) => ({
    id: detection.personId,
    cx: detection.box.x + detection.box.w / 2,
    cy: detection.box.y + detection.box.h / 2,
  }));
}

/** Reset detection tracking — called when a mission starts or the mode flips. */
export function resetTracking(): void {
  trackers.clear();
}

const PERSON_LABELS = new Set(["person", "people", "human", "man", "woman", "body"]);

function extractDetections(
  pick: Picker,
  sourceId: string,
  timestamp: number,
): Detection[] | null {
  const array = pick.array([
    "detections",
    "people",
    "persons",
    "boxes",
    "objects",
    "results",
    "predictions",
  ]);
  if (!array) return null;

  const frameWidth = pick.number(["framewidth", "imagewidth", "width"], { range: [16, 8192] });
  const frameHeight = pick.number(["frameheight", "imageheight", "height"], { range: [16, 8192] });
  const frame =
    frameWidth && frameHeight ? { width: frameWidth, height: frameHeight } : null;

  const matched = new Set<string>();
  const detections: Detection[] = [];

  for (const entry of array.value) {
    const parsed = detectionSchema.safeParse(entry);
    if (!parsed.success) continue;
    const data = parsed.data;

    const box = normaliseBox(
      data.box ??
        data.bbox ??
        data.bounds ??
        (data.x !== undefined && data.y !== undefined
          ? { x: data.x, y: data.y, w: data.w ?? 0, h: data.h ?? 0 }
          : null),
      frame,
    );
    if (!box) continue;

    const label = data.label ?? data.class ?? data.className;
    // Only people become person records; other classes still render as boxes.
    if (label && !PERSON_LABELS.has(label.toLowerCase())) {
      detections.push({
        personId: label,
        confidence: data.confidence ?? data.score ?? 0,
        box,
        detectedAt: data.detectedAt ?? timestamp,
        label,
      });
      continue;
    }

    const claimed =
      data.personId ??
      (data.id !== undefined ? `P-${String(data.id).padStart(3, "0")}` : undefined) ??
      (data.trackId !== undefined ? `P-${String(data.trackId).padStart(3, "0")}` : undefined) ??
      (data.track_id !== undefined ? `P-${String(data.track_id).padStart(3, "0")}` : undefined);

    const personId = assignPersonId(sourceId, box, claimed, matched);
    matched.add(personId);

    const confidence = data.confidence ?? data.score ?? 0;
    detections.push({
      personId,
      confidence: confidence > 1 ? Math.min(1, confidence / 100) : Math.max(0, confidence),
      box,
      detectedAt: data.detectedAt ?? timestamp,
      label: label ?? "person",
    });
  }

  rememberTracks(
    sourceId,
    detections.filter((detection) => detection.label === "person"),
  );
  return detections;
}

/** MQ-series sensors: ADC counts in, proportion of scale out. */
const GAS_SENSORS: Record<string, { label: string; responds: string }> = {
  mq2: { label: "MQ-2", responds: "LPG, propane, methane, hydrogen, smoke" },
  mq135: { label: "MQ-135", responds: "NH3, NOx, benzene, alcohol, smoke, CO2" },
  mq4: { label: "MQ-4", responds: "methane, natural gas" },
  mq6: { label: "MQ-6", responds: "LPG, butane" },
  mq7: { label: "MQ-7", responds: "carbon monoxide" },
  mq8: { label: "MQ-8", responds: "hydrogen" },
  mq9: { label: "MQ-9", responds: "carbon monoxide, flammable gas" },
};

/** ESP32 ADC is 12-bit. A node on different hardware can say so explicitly. */
const DEFAULT_ADC_MAX = 4095;

function toProportion(value: number, adcMax: number): { raw: number; rawAdc?: number } {
  if (value <= 1 && value >= 0) return { raw: value };
  return { raw: Math.min(1, Math.max(0, value / adcMax)), rawAdc: value };
}

function extractGas(pick: Picker): GasReading[] | null {
  const adcMax = pick.number(["adcmax", "adcresolution", "fullscale"], { range: [255, 65535] }) ??
    DEFAULT_ADC_MAX;

  const readings: GasReading[] = [];

  // 1. A proper array of sensor objects.
  const array = pick.array(["gas", "gases", "gassensors", "sensors"]);
  if (array) {
    for (const entry of array.value) {
      const parsed = gasEntrySchema.safeParse(entry);
      if (!parsed.success) continue;
      const data = parsed.data;
      const value = data.raw ?? data.value ?? data.adc;
      if (value === undefined || !Number.isFinite(value)) continue;
      const sensorId = norm(data.sensorId ?? data.id ?? data.sensor ?? data.name ?? "gas");
      const known = GAS_SENSORS[sensorId];
      const { raw, rawAdc } = toProportion(value, data.adcMax ?? adcMax);
      readings.push({
        sensorId,
        label: data.label ?? known?.label ?? sensorId.toUpperCase(),
        raw,
        rawAdc,
        adcMax: rawAdc === undefined ? undefined : data.adcMax ?? adcMax,
        responds: known?.responds,
      });
    }
  }

  // 2. Named MQ scalars, the shape an ESP32 sketch usually emits.
  for (const [sensorId, meta] of Object.entries(GAS_SENSORS)) {
    if (readings.some((reading) => reading.sensorId === sensorId)) continue;
    const value = pick.number([sensorId, `${sensorId}raw`, `${sensorId}adc`, `${sensorId}value`]);
    if (value === null) continue;
    const { raw, rawAdc } = toProportion(value, adcMax);
    readings.push({
      sensorId,
      label: meta.label,
      raw,
      rawAdc,
      adcMax: rawAdc === undefined ? undefined : adcMax,
      responds: meta.responds,
    });
  }

  // 3. A single unnamed gas channel.
  if (readings.length === 0) {
    const value = pick.number(["gaslevel", "gasraw", "airquality", "gasvalue", "smoke"]);
    if (value !== null) {
      const { raw, rawAdc } = toProportion(value, adcMax);
      readings.push({
        sensorId: "gas",
        label: "Gas sensor",
        raw,
        rawAdc,
        adcMax: rawAdc === undefined ? undefined : adcMax,
      });
    }
  }

  return readings.length > 0 ? readings : null;
}

function extractImu(pick: Picker): ImuReading | null {
  const accel = {
    x: pick.number(["accelx", "ax", "accelerationx", "accx"], { under: SCOPE.imu }) ??
      pick.number(["accelx", "accelerationx"]),
    y: pick.number(["accely", "ay", "accelerationy", "accy"], { under: SCOPE.imu }) ??
      pick.number(["accely", "accelerationy"]),
    z: pick.number(["accelz", "az", "accelerationz", "accz"], { under: SCOPE.imu }) ??
      pick.number(["accelz", "accelerationz"]),
  };
  const gyro = {
    x: pick.number(["gyrox", "gx"], { under: SCOPE.imu }) ?? pick.number(["gyrox"]),
    y: pick.number(["gyroy", "gy"], { under: SCOPE.imu }) ?? pick.number(["gyroy"]),
    z: pick.number(["gyroz", "gz"], { under: SCOPE.imu }) ?? pick.number(["gyroz"]),
  };

  let pitch = pick.number(["pitch"], { range: [-180, 180] });
  let roll = pick.number(["roll"], { range: [-180, 180] });
  const yaw = pick.number(["yaw"], { range: [-360, 360], under: SCOPE.imu });
  // The IMU's own die temperature, kept apart from the air temperature.
  const dieTempC = pick.number(["temperature", "temp"], {
    under: SCOPE.imu,
    range: [-40, 125],
  });

  // Pitch and roll are solvable from gravity alone; derive them when the node
  // sends only raw accelerometer counts. Yaw is never derived — without a
  // magnetometer the MPU6050 cannot observe it.
  const hasAccel = accel.x !== null && accel.y !== null && accel.z !== null;
  if ((pitch === null || roll === null) && hasAccel) {
    const ax = accel.x as number;
    const ay = accel.y as number;
    const az = accel.z as number;
    const degrees = 180 / Math.PI;
    if (pitch === null) pitch = Math.atan2(-ax, Math.hypot(ay, az)) * degrees;
    if (roll === null) roll = Math.atan2(ay, az) * degrees;
  }

  if (pitch === null && roll === null && !hasAccel) return null;

  return {
    pitch: pitch ?? 0,
    roll: roll ?? 0,
    yaw: yaw ?? undefined,
    dieTempC: dieTempC ?? undefined,
    accel: hasAccel
      ? { x: accel.x as number, y: accel.y as number, z: accel.z as number }
      : undefined,
    gyro:
      gyro.x !== null && gyro.y !== null && gyro.z !== null
        ? { x: gyro.x, y: gyro.y, z: gyro.z }
        : undefined,
  };
}

function extractPose(pick: Picker): Pose | null {
  const x =
    pick.number(["posex", "xm"], { range: [-10000, 10000] }) ??
    pick.number(["x"], { under: SCOPE.pose, range: [-10000, 10000] });
  const y =
    pick.number(["posey", "ym"], { range: [-10000, 10000] }) ??
    pick.number(["y"], { under: SCOPE.pose, range: [-10000, 10000] });
  if (x === null || y === null) return null;

  const heading =
    pick.number(["heading", "bearing", "course", "theta", "yawdeg"], {
      notUnder: SCOPE.gps,
      range: [-360, 360],
    }) ?? 0;

  return { x, y, heading: ((heading % 360) + 360) % 360 };
}

function extractGps(pick: Picker): GpsReading | null {
  const latitude = pick.number(["lat", "latitude"], { range: [-90, 90] });
  const longitude = pick.number(["lon", "lng", "long", "longitude"], { range: [-180, 180] });
  const satellites = pick.number(["satellites", "sats", "numsats", "satcount"], {
    range: [0, 64],
  });
  const fix = pick.boolean(["fix", "hasfix", "gpsfix", "valid", "fixvalid"]);
  const fixQuality = pick.number(["fixquality", "fixtype"], { range: [0, 8] });

  // A module with no fix still has a state worth reporting. Only a payload
  // that says nothing about GPS at all yields no reading.
  if (latitude === null && longitude === null && fix === null && satellites === null) {
    return null;
  }
  const speed = pick.numberWithKey(["speedkmh", "speedkph", "speedknots", "groundspeed", "speed"], {
    under: SCOPE.gps,
    range: [0, 400],
  });
  const altitude = pick.number(["altitudem", "altitude", "altm", "alt", "elevation"], {
    under: SCOPE.gps,
    range: [-500, 10000],
  });

  // 0,0 is what a GPS library emits when it has nothing — a position in the
  // Gulf of Guinea is not a plausible rover location, and showing it would put
  // a fabricated point on the map. §12.1 rule 7.
  const nullIsland = latitude === 0 && longitude === 0;
  const hasPosition = latitude !== null && longitude !== null && !nullIsland;

  return {
    latitude: hasPosition ? latitude : undefined,
    longitude: hasPosition ? longitude : undefined,
    fix:
      (fix ?? (fixQuality !== null ? fixQuality > 0 : (satellites ?? 0) >= 3)) && hasPosition,
    satellites: satellites ?? undefined,
    // Read either way so the key is accounted for, but only reported when
    // there is a fix behind it.
    altitudeM: hasPosition ? (altitude ?? undefined) : undefined,
    // NMEA reports ground speed in knots; convert only when the key says so.
    speedKmh: speed
      ? speed.key.includes("knot")
        ? speed.value * 1.852
        : speed.value
      : undefined,
    hdop: pick.number(["hdop"], { range: [0, 100] }) ?? undefined,
  };
}

function extractLidar(pick: Picker): LidarReading | null {
  const distance = pick.numberWithKey(
    ["distancecm", "distancemm", "distancem", "distance", "rangecm", "range", "dist"],
    { notUnder: SCOPE.gps, range: [0, 100000] },
  );
  if (!distance) return null;

  // TF-Luna reports centimetres natively; only an explicit unit suffix converts.
  const distanceCm = distance.key.endsWith("mm")
    ? distance.value / 10
    : distance.key.endsWith("m") && !distance.key.endsWith("cm")
      ? distance.value * 100
      : distance.value;

  if (!Number.isFinite(distanceCm) || distanceCm < 0 || distanceCm > 90000) return null;

  const strength = pick.number(["strength", "amplitude", "amp", "signalstrength", "signal"], {
    under: SCOPE.lidar,
    range: [0, 65535],
  });

  return { distanceCm, strength: strength ?? undefined };
}

function extractBattery(pick: Picker): BatteryReading | null {
  const volts = pick.number(
    ["voltage", "volts", "vbat", "batteryvoltage", "packvoltage", "busvoltage"],
    { range: [0, 60] },
  );
  const reported = pick.number(
    ["percent", "percentage", "soc", "batterypercent", "charge", "capacity", "level"],
    { under: SCOPE.battery, range: [0, 100] },
  );

  if (volts === null && reported === null) return null;
  if (reported !== null) {
    return { percent: reported, volts: volts ?? 0 };
  }

  // Derive percent from pack voltage. One place, one curve. §13
  return {
    percent: percentFromPackVoltage(volts as number),
    volts: volts as number,
    percentEstimated: true,
  };
}

function extractDrive(pick: Picker): DriveReading | null {
  const speedRaw = pick.numberWithKey(
    ["speed", "throttle", "duty", "dutycycle", "pwm", "speedpct", "motorspeed"],
    { notUnder: SCOPE.gps, range: [-4096, 4096] },
  );
  const moving = pick.boolean(["moving", "ismoving", "inmotion"]);
  const motorsOk = pick.boolean(["motorsok", "motorok", "motorshealthy", "driverok", "driversok"]);
  const fault = pick.boolean(["motorfault", "driverfault", "fault"]);
  const direction = pick.string(["direction", "dir", "drivedirection", "movement"]);

  if (speedRaw === null && moving === null && direction === null) return null;

  // Normalise whatever scale the firmware applies: ratio, percent, or 8-bit PWM.
  let speed = 0;
  if (speedRaw) {
    const magnitude = Math.abs(speedRaw.value);
    speed = magnitude <= 1 ? magnitude : magnitude <= 100 ? magnitude / 100 : magnitude / 255;
    speed = Math.min(1, speed);
  }

  const normalisedDirection = direction?.toLowerCase().trim();
  const allowed = ["forward", "reverse", "left", "right", "stopped"] as const;

  return {
    moving: moving ?? (speedRaw ? Math.abs(speedRaw.value) > 0 : false),
    speed,
    motorsOk: motorsOk ?? (fault === null ? undefined : !fault),
    direction: allowed.find((entry) => entry === normalisedDirection),
  };
}

function extractRfLink(pick: Picker): RfLinkReading | null {
  const failsafe = pick.boolean(["failsafe", "infailsafe", "fs"]);
  const connected = pick.boolean([
    "connected",
    "linked",
    "islinked",
    "linkok",
    "ibusok",
    "rclinked",
    "rxconnected",
    "rclink",
  ]);
  const age = pick.number(
    ["lastpacketagems", "lastframeagems", "lastpacketage", "frameagems", "agems", "lastseenms"],
    { range: [0, 600000] },
  );

  if (connected === null && failsafe === null && age === null) return null;

  return {
    connected: connected ?? (failsafe === null ? true : !failsafe),
    failsafe: failsafe ?? false,
    lastPacketAgeMs: age,
  };
}

function extractRfChannels(pick: Picker): number[] | null {
  const array = pick.array(["channels", "ibuschannels", "rcchannels", "chans", "ch"]);
  if (!array) return null;
  const channels = array.value.filter((value): value is number => typeof value === "number");
  return channels.length > 0 ? channels.slice(0, 14) : null;
}

const SAFETY_STATES: StatusLevel[] = ["NORMAL", "ATTENTION", "WARNING", "CRITICAL", "UNKNOWN"];

function extractSafetyState(pick: Picker): StatusLevel | null {
  const value = pick.string(["safetystate", "safety", "airstate", "environmentstate"]);
  if (!value) return null;
  const upper = value.toUpperCase().trim();
  return SAFETY_STATES.find((state) => state === upper) ?? null;
}

/* ------------------------------------------------------------------ */
/* Timestamp                                                           */
/* ------------------------------------------------------------------ */

/**
 * Node-reported wall-clock time, when it is actually wall-clock time.
 *
 * An ESP32 sketch usually sends `millis()`, which is uptime, not an epoch. A
 * value that is not plausibly an epoch is rejected so it cannot skew the
 * mission clock — receipt time is used instead. §12.1 rule 9.
 */
function extractTimestamp(pick: Picker): number {
  const candidate = pick.number(["timestamp", "ts", "epoch", "epochms", "time", "unixtime"]);
  if (candidate === null) return Date.now();
  if (candidate > 1e12 && candidate < 4e12) return candidate;
  if (candidate > 1e9 && candidate < 4e9) return candidate * 1000;
  return Date.now();
}

/* ------------------------------------------------------------------ */
/* Entry point                                                         */
/* ------------------------------------------------------------------ */

export function ingestPayload(
  sourceId: string,
  raw: unknown,
): { ok: true; result: IngestResult } | { ok: false; error: string } {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return { ok: false, error: "payload is not a JSON object" };
  }

  const { leaves, arrays } = index(raw as Record<string, unknown>);
  if (leaves.length === 0 && arrays.length === 0) {
    return { ok: false, error: "payload is empty" };
  }

  const pick = new Picker(leaves, arrays);
  const timestamp = extractTimestamp(pick);
  const patch: FieldPatch = {};

  /* --- thermal: MLX90640 --------------------------------------- */
  const frame = extractThermalFrame(pick);
  if (frame) patch.thermalFrame = frame;

  const reportedHotspots = pick.array(["hotspots", "heatsignatures", "heatspots", "blobs"]);
  let hotspots: Hotspot[] | null = null;
  if (reportedHotspots) {
    const parsed: Hotspot[] = [];
    for (const entry of reportedHotspots.value) {
      const result = hotspotEntrySchema.safeParse(entry);
      if (!result.success) continue;
      const celsius = result.data.celsius ?? result.data.temp ?? result.data.temperature;
      if (celsius === undefined || !Number.isFinite(celsius)) continue;
      parsed.push({
        x: result.data.x > 1 && frame ? result.data.x / frame.width : result.data.x,
        y: result.data.y > 1 && frame ? result.data.y / frame.height : result.data.y,
        celsius,
        band: hotspotBand(celsius),
        humanLike:
          result.data.humanLike ?? result.data.human ?? (celsius >= 30 && celsius <= 42),
      });
    }
    hotspots = parsed;
  } else if (frame) {
    hotspots = deriveHotspots(frame);
  }

  if (hotspots) {
    patch.hotspots = hotspots;
    patch.heatSignatures = hotspots.filter((hotspot) => hotspot.humanLike);
  }

  const peak =
    pick.number(["maxcelsius", "maxtemp", "peakc", "peak", "hottest", "tmax", "max"], {
      under: SCOPE.thermal,
      range: [-50, 400],
    }) ?? (frame ? Math.max(...frame.cells) : null);
  if (peak !== null) patch.thermalPeakC = peak;

  const coldest =
    pick.number(["mincelsius", "mintemp", "tmin", "min", "coldest"], {
      under: SCOPE.thermal,
      range: [-50, 400],
    }) ?? (frame ? Math.min(...frame.cells) : null);
  if (coldest !== null) patch.thermalMinC = coldest;

  const ambient = pick.number(["ambient", "ambientc", "ta", "ambienttemperature"], {
    under: SCOPE.thermal,
    range: [-50, 150],
  });
  if (ambient !== null) patch.thermalAmbientC = ambient;

  /* --- vision: Pi Camera 3 + AI HAT+ --------------------------- */
  const detections = extractDetections(pick, sourceId, timestamp);
  if (detections) patch.detections = detections;

  const aiOnline = pick.boolean(["aionline", "aiready", "inferenceok", "modelloaded", "ai"]);
  const aiStatusText = pick.string(["aistatus"]);
  if (aiOnline !== null) patch.aiStatus = aiOnline ? "ONLINE" : "OFFLINE";
  else if (aiStatusText) patch.aiStatus = aiStatusText.toUpperCase();

  const fps = pick.number(["fps", "framerate", "framespersecond"], { range: [0, 240] });
  if (fps !== null) patch.cameraFps = fps;

  /* --- environment: BME280 + MQ-series ------------------------- */
  const temperature = pick.number(
    ["temperaturec", "tempc", "temperature", "temp", "airtemperature", "airtemp"],
    {
      notUnder: [...SCOPE.imu, ...SCOPE.cpu, ...SCOPE.lidar, ...SCOPE.thermal, ...SCOPE.battery],
      range: [-50, 100],
    },
  );
  if (temperature !== null) patch.temperature = temperature;

  const humidity = pick.number(["humiditypct", "humidity", "hum", "rh", "relativehumidity"], {
    range: [0, 100],
  });
  if (humidity !== null) patch.humidity = humidity;

  const pressureRaw = pick.number(
    ["pressurehpa", "pressure", "press", "barometricpressure", "baro", "pressurepa"],
    { range: [300, 200000] },
  );
  if (pressureRaw !== null) {
    // BME280 libraries publish either hPa or Pa. Convert only the unambiguous case.
    patch.pressure = pressureRaw > 20000 ? pressureRaw / 100 : pressureRaw;
  }

  const gas = extractGas(pick);
  if (gas) patch.gas = gas;

  const safetyState = extractSafetyState(pick);
  if (safetyState) patch.safetyState = safetyState;

  /* --- motion: MPU6050, TF-Luna, GPS, pose --------------------- */
  const pose = extractPose(pick);
  if (pose) {
    patch.pose = pose;
    patch.heading = pose.heading;
  }

  const imu = extractImu(pick);
  if (imu) patch.imu = imu;

  const lidar = extractLidar(pick);
  if (lidar) patch.lidar = lidar;

  const gps = extractGps(pick);
  if (gps) patch.gps = gps;

  /* --- drive chain: BTS7960 + FS-i6 ---------------------------- */
  const drive = extractDrive(pick);
  if (drive) patch.drive = drive;

  const rfLink = extractRfLink(pick);
  if (rfLink) patch.rfLink = rfLink;

  const rfChannels = extractRfChannels(pick);
  if (rfChannels) patch.rfChannels = rfChannels;

  /* --- power and board ----------------------------------------- */
  const battery = extractBattery(pick);
  if (battery) patch.battery = battery;

  const cpuTemp =
    pick.number(["cputemp", "cputemperature", "soctemp", "boardtemp"], { range: [-20, 130] }) ??
    pick.number(["temperature", "temp"], { under: SCOPE.cpu, range: [-20, 130] });
  if (cpuTemp !== null) patch.cpuTemp = cpuTemp;

  /* --- cross-source thermal confirmation ----------------------- */
  const confirms = pick.array([
    "confirms",
    "confirmspersonids",
    "confirmedids",
    "thermalconfirms",
  ]);
  const confirmsPersonIds = confirms
    ? confirms.value.filter((value): value is string => typeof value === "string")
    : [];

  const fields = Object.keys(patch) as TelemetryField[];
  if (fields.length === 0) {
    return { ok: false, error: "no recognised sensor values in payload" };
  }

  return {
    ok: true,
    result: {
      patch,
      fields,
      unknownKeys: pick.unclaimed(),
      timestamp,
      confirmsPersonIds,
    },
  };
}
