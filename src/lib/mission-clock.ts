/**
 * MISSION CLOCK — single authority for every displayed time.
 *
 * PROJECT_CONTEXT.md §12.1 rule 9: independent nodes drift. Each source's own
 * timestamp is kept for the record, but the mission timeline is ordered by one
 * declared authority — the dashboard's receipt clock — and the measured offset
 * per source is stored so report timelines stay reproducible.
 *
 * Every timestamp rendered anywhere in the UI goes through this module. A time
 * in a chart, on the map and in a report must mean the same instant.
 */

import type { SourceId } from "./types";

/** Measured offset per source: sourceTimestamp - missionNow, in ms. */
const offsets = new Map<SourceId, number>();

/** Smoothing factor for the offset estimate. Low = slow, stable tracking. */
const OFFSET_SMOOTHING = 0.1;

/** Mission-clock reading. The ordering authority for all events. */
export function missionNow(): number {
  return Date.now();
}

/**
 * Record a source's reported timestamp against our receipt time and update the
 * running offset estimate for that source.
 */
export function observeSourceTime(sourceId: SourceId, sourceTimestamp: number): void {
  const observed = sourceTimestamp - missionNow();
  const previous = offsets.get(sourceId);
  offsets.set(
    sourceId,
    previous === undefined ? observed : previous + (observed - previous) * OFFSET_SMOOTHING,
  );
}

/** Estimated clock offset for a source, in ms. 0 when not yet observed. */
export function offsetFor(sourceId: SourceId): number {
  return offsets.get(sourceId) ?? 0;
}

/**
 * Convert a source-reported timestamp into mission-clock time, correcting for
 * that source's measured drift. Use this before ordering or displaying any
 * time that came off a node.
 */
export function toMissionTime(sourceId: SourceId, sourceTimestamp: number): number {
  return sourceTimestamp - offsetFor(sourceId);
}

export function allOffsets(): Record<SourceId, number> {
  return Object.fromEntries(offsets);
}

/* ------------------------------------------------------------------ */
/* Formatting — the only sanctioned way to render a time              */
/* ------------------------------------------------------------------ */

const timeFormat = new Intl.DateTimeFormat(undefined, {
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

const dateTimeFormat = new Intl.DateTimeFormat(undefined, {
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

/** Clock time, e.g. "14:32:07". */
export function formatTime(at: number): string {
  return timeFormat.format(at);
}

/** Full stamp for reports, e.g. "03 Oct 2026, 14:32:07". */
export function formatDateTime(at: number): string {
  return dateTimeFormat.format(at);
}

/** Elapsed duration, e.g. "4m 12s" or "1h 06m". */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return "—";
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  if (minutes > 0) return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
  return `${seconds}s`;
}

/**
 * Age of a reading, phrased for an operator: "just now", "4s ago", "2 min ago".
 * Used wherever a stale value is shown — age is never hidden. §12.1 rule 7.
 */
export function formatAge(at: number | null, now: number = missionNow()): string {
  if (at === null) return "no data yet";
  const ms = now - at;
  if (ms < 1500) return "just now";
  if (ms < 60_000) return `${Math.floor(ms / 1000)}s ago`;
  if (ms < 3_600_000) return `${Math.floor(ms / 60_000)} min ago`;
  return `${Math.floor(ms / 3_600_000)} h ago`;
}
