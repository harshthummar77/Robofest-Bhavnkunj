/**
 * TELEMETRY STORE — normalized, provenance-tagged, multi-source.
 *
 * PROJECT_CONTEXT.md §12.1:
 *  - every stored field carries `{ value, sourceId, sourceTimestamp, receivedAt, state }`
 *  - per-node health is four-state, and silence is staleness, not health
 *  - a missing value resolves to "unavailable", never to zero
 *  - cross-source correlation places a detection using the pose at the
 *    detection timestamp, from a short pose history buffer
 *
 * Field ownership is **discovered, not configured**. Whichever node delivers a
 * field becomes its owner, and the module that displays that field picks it up
 * — so moving the MLX90640 from the Pi to an ESP32, or collapsing three nodes
 * into one, changes an address and nothing else.
 */

import { create } from "zustand";
import { useShallow } from "zustand/react/shallow";
import { OFFLINE_FACTOR, STALE_FACTOR, activeNodes, tryGetNode } from "../config/nodes";
import { missionNow, observeSourceTime, toMissionTime } from "./mission-clock";
import { ingestPayload, resetTracking } from "./ingest";
import { interpretHeatSignature, worst } from "./thresholds";
import type {
  Alert,
  Detection,
  FieldResolution,
  Hotspot,
  Mission,
  MissionEvent,
  MissionEventKind,
  NodeConfig,
  PersonHistoryEntry,
  PersonRecord,
  Pose,
  Reading,
  SourceHealth,
  SourceId,
  SourceState,
  StatusLevel,
  TelemetryField,
} from "./types";

/** How much pose history to keep, for placing late detections. §12.1 rule 8. */
const POSE_HISTORY_MS = 30_000;
const MAX_EVENTS = 2000;

/** Fields whose loss means the operator can no longer be told the area is safe. */
const SAFETY_FIELDS: TelemetryField[] = ["gas", "temperature", "humidity", "safetyState"];

interface PoseSample {
  at: number;
  pose: Pose;
}

export interface TelemetryState {
  mission: Mission;
  readings: Partial<Record<TelemetryField, Reading>>;
  /** Which node currently supplies each field. Discovered on ingest. */
  fieldOwners: Partial<Record<TelemetryField, SourceId>>;
  health: Record<SourceId, SourceHealth>;
  poseHistory: PoseSample[];
  persons: Record<string, PersonRecord>;
  events: MissionEvent[];
  alerts: Alert[];
  /** Bumped on every ingest so live views can animate off a single subscription. */
  revision: number;

  /* ---- connector sink ---- */
  /** Accept a raw payload from a node. Recognition happens in lib/ingest. */
  ingest(sourceId: SourceId, raw: unknown): void;
  markUp(sourceId: SourceId): void;
  markError(sourceId: SourceId, error: string): void;
  markDown(sourceId: SourceId, error: string | null): void;
  /** Re-evaluate staleness. Driven by one interval, not per component. */
  tick(): void;
  /** Rebuild the health table after the node registry changes. */
  syncNodes(nodes: NodeConfig[]): void;
  /** Drop every reading — used when switching between mock and real data. */
  resetData(): void;

  /* ---- mission ---- */
  startMission(name?: string): void;
  completeMission(): void;
  addEvent(event: Omit<MissionEvent, "id" | "at"> & { at?: number }): void;
  acknowledgeAlert(id: string): void;
  acknowledgeAll(): void;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function blankHealth(node: NodeConfig): SourceHealth {
  return {
    id: node.id,
    label: node.label,
    baseUrl: node.baseUrl,
    transport: node.transport,
    state: "OFFLINE",
    lastUpdateAt: null,
    failureCount: 0,
    lastError: null,
    fields: [],
    unknownKeys: [],
  };
}

function healthTable(nodes: NodeConfig[]): Record<SourceId, SourceHealth> {
  return Object.fromEntries(nodes.map((node) => [node.id, blankHealth(node)]));
}

let idCounter = 0;
function nextId(prefix: string): string {
  idCounter += 1;
  return `${prefix}-${idCounter.toString(36)}-${Date.now().toString(36)}`;
}

/** Derive staleness from the node's declared cadence. §12.1 rule 5. */
function deriveState(health: SourceHealth, now: number): SourceState {
  if (health.lastUpdateAt === null) return "OFFLINE";
  const node = tryGetNode(health.id);
  const interval = node?.expectedIntervalMs ?? 1000;
  const age = now - health.lastUpdateAt;
  if (age > interval * OFFLINE_FACTOR) return "OFFLINE";
  if (age > interval * STALE_FACTOR) return "STALE";
  if (health.failureCount > 0) return "DEGRADED";
  return "ONLINE";
}

/**
 * Pose at a given instant, interpolated from the history buffer.
 * A detection is placed where the rover was when it was seen, not where the
 * rover is now. §12.1 rule 8.
 */
function poseAt(history: PoseSample[], at: number): Pose | null {
  if (history.length === 0) return null;
  if (at <= history[0].at) return history[0].pose;
  const last = history[history.length - 1];
  if (at >= last.at) return last.pose;

  for (let i = 1; i < history.length; i += 1) {
    const previous = history[i - 1];
    const current = history[i];
    if (current.at >= at) {
      const span = current.at - previous.at;
      const ratio = span === 0 ? 0 : (at - previous.at) / span;
      return {
        x: previous.pose.x + (current.pose.x - previous.pose.x) * ratio,
        y: previous.pose.y + (current.pose.y - previous.pose.y) * ratio,
        heading: previous.pose.heading,
      };
    }
  }
  return last.pose;
}

/* ------------------------------------------------------------------ */
/* Store                                                               */
/* ------------------------------------------------------------------ */

export const useTelemetry = create<TelemetryState>()((set, get) => ({
  mission: {
    id: nextId("M"),
    name: "Untitled Mission",
    phase: "READY",
    startedAt: null,
    endedAt: null,
  },
  readings: {},
  fieldOwners: {},
  health: healthTable(activeNodes()),
  poseHistory: [],
  persons: {},
  events: [],
  alerts: [],
  revision: 0,

  ingest(sourceId, raw) {
    const parsed = ingestPayload(sourceId, raw);
    if (!parsed.ok) {
      get().markError(sourceId, parsed.error);
      return;
    }

    const { patch, fields, unknownKeys, timestamp, confirmsPersonIds } = parsed.result;
    const now = missionNow();
    observeSourceTime(sourceId, timestamp);
    const missionTimestamp = toMissionTime(sourceId, timestamp);

    const newEvents: MissionEvent[] = [];
    const newAlerts: Alert[] = [];
    let persons = get().persons;
    let poseHistory = get().poseHistory;

    /* --- pose first: a detection in this same payload must be placed with it */
    const pose = patch.pose as Pose | undefined;
    if (pose) {
      poseHistory = [...poseHistory, { at: missionTimestamp, pose }].filter(
        (sample) => missionTimestamp - sample.at <= POSE_HISTORY_MS,
      );
    }

    /* --- people seen by the camera -------------------------------- */
    const detections = (patch.detections as Detection[] | undefined) ?? [];
    for (const detection of detections) {
      // Non-person classes render as overlays but create no person record.
      if (detection.label && detection.label !== "person") continue;

      const detectedAtMission = toMissionTime(sourceId, detection.detectedAt);
      const detectionPose = poseAt(poseHistory, detectedAtMission);
      const existing = persons[detection.personId];
      const historyEntry: PersonHistoryEntry = {
        at: detectedAtMission,
        sensor: "rgb",
        sourceId,
        pose: detectionPose,
        confidence: detection.confidence,
      };

      if (!existing) {
        persons = {
          ...persons,
          [detection.personId]: {
            personId: detection.personId,
            status: "DETECTED",
            firstDetectedAt: detectedAtMission,
            lastSeenAt: detectedAtMission,
            lastKnownPose: detectionPose,
            rgbConfirmed: true,
            thermalConfirmed: false,
            bestConfidence: detection.confidence,
            history: [historyEntry],
          },
        };
        newEvents.push({
          id: nextId("E"),
          kind: "PERSON_DETECTED",
          level: "CRITICAL",
          at: detectedAtMission,
          message: `Person detected ahead — ${detection.personId}`,
          sourceId,
          pose: detectionPose,
        });
        newAlerts.push({
          id: nextId("A"),
          level: "CRITICAL",
          subject: "Vision & Detection",
          message: `Person detected — ${detection.personId}`,
          at: detectedAtMission,
          sourceId,
          moduleId: "vision",
          acknowledged: false,
        });
      } else {
        persons = {
          ...persons,
          [detection.personId]: {
            ...existing,
            status: existing.status === "LAST_SEEN" ? "RECONFIRMED" : "TRACKING",
            lastSeenAt: detectedAtMission,
            lastKnownPose: detectionPose ?? existing.lastKnownPose,
            rgbConfirmed: true,
            bestConfidence: Math.max(existing.bestConfidence, detection.confidence),
            history: [...existing.history, historyEntry].slice(-200),
          },
        };
      }
    }

    /* --- thermal findings and confirmations ----------------------- */
    const hotspots = patch.hotspots as Hotspot[] | undefined;
    const peakC = patch.thermalPeakC as number | undefined;

    for (const personId of confirmsPersonIds) {
      const existing = persons[personId];
      if (!existing || existing.thermalConfirmed) continue;
      const thermalPose = poseAt(poseHistory, missionTimestamp);
      const thermalEntry: PersonHistoryEntry = {
        at: missionTimestamp,
        sensor: "thermal",
        sourceId,
        pose: thermalPose,
        confidence: existing.bestConfidence,
        celsius: peakC,
      };
      persons = {
        ...persons,
        [personId]: {
          ...existing,
          thermalConfirmed: true,
          status: "RECONFIRMED",
          history: [...existing.history, thermalEntry].slice(-200),
        },
      };
      newEvents.push({
        id: nextId("E"),
        kind: "PERSON_RECONFIRMED",
        level: "CRITICAL",
        at: missionTimestamp,
        message:
          peakC === undefined
            ? `${personId} confirmed by thermal`
            : `${personId} confirmed by thermal — ${peakC.toFixed(1)}°C`,
        sourceId,
        pose: thermalPose,
      });
    }

    if (hotspots) {
      // One event per human-like signature, not one per frame: the thermal node
      // reports continuously and the timeline must stay readable.
      const previous = get().readings.heatSignatures?.value as Hotspot[] | undefined;
      const wasPresent = (previous?.length ?? 0) > 0;
      const humanLike = hotspots.filter((hotspot) => hotspot.humanLike);
      if (humanLike.length > 0 && !wasPresent) {
        const interpretation = interpretHeatSignature(humanLike[0].celsius);
        newEvents.push({
          id: nextId("E"),
          kind: "THERMAL_FINDING",
          level: interpretation.level,
          at: missionTimestamp,
          message: interpretation.message,
          sourceId,
          pose: poseAt(poseHistory, missionTimestamp),
        });
      }
    }

    set((state) => {
      const previousHealth = state.health[sourceId] ?? blankHealth({
        id: sourceId,
        label: sourceId,
        baseUrl: "",
        transport: "http-poll",
        telemetryPath: "",
        expectedIntervalMs: 1000,
        enabled: true,
      });

      const health: SourceHealth = {
        ...previousHealth,
        lastUpdateAt: now,
        failureCount: 0,
        lastError: null,
        state: "ONLINE",
        fields,
        unknownKeys,
      };

      const readings = { ...state.readings };
      const fieldOwners = { ...state.fieldOwners };
      for (const [field, value] of Object.entries(patch) as [TelemetryField, unknown][]) {
        if (value === undefined) continue;
        readings[field] = {
          value,
          sourceId,
          sourceTimestamp: timestamp,
          receivedAt: now,
          state: "ONLINE",
        };
        fieldOwners[field] = sourceId;
      }

      const phase =
        state.mission.phase === "SURVEYING" && newEvents.some((event) => event.level === "CRITICAL")
          ? "EVENT_DETECTED"
          : state.mission.phase;

      return {
        readings,
        fieldOwners,
        persons,
        poseHistory,
        health: { ...state.health, [sourceId]: health },
        events: [...state.events, ...newEvents].slice(-MAX_EVENTS),
        alerts: [...state.alerts, ...newAlerts].slice(-200),
        mission: phase === state.mission.phase ? state.mission : { ...state.mission, phase },
        revision: state.revision + 1,
      };
    });
  },

  markUp(sourceId) {
    set((state) => {
      const previous = state.health[sourceId];
      if (!previous) return state;
      const restored = previous.state === "OFFLINE" && previous.lastUpdateAt !== null;
      return {
        health: {
          ...state.health,
          [sourceId]: {
            ...previous,
            failureCount: 0,
            lastError: null,
            // Transport up is not the same as data arriving. Stay cautious
            // until the first payload lands. §12.1 rule 5.
            state: previous.lastUpdateAt === null ? "DEGRADED" : previous.state,
          },
        },
        events: restored
          ? [
              ...state.events,
              {
                id: nextId("E"),
                kind: "SOURCE_RESTORED" as MissionEventKind,
                level: "NORMAL" as StatusLevel,
                at: missionNow(),
                message: `${previous.label} reconnected`,
                sourceId,
                pose: null,
              },
            ].slice(-MAX_EVENTS)
          : state.events,
      };
    });
  },

  markError(sourceId, error) {
    set((state) => {
      const previous = state.health[sourceId];
      if (!previous) return state;
      return {
        health: {
          ...state.health,
          [sourceId]: {
            ...previous,
            failureCount: previous.failureCount + 1,
            lastError: error,
            state: previous.state === "ONLINE" ? "DEGRADED" : previous.state,
          },
        },
      };
    });
  },

  markDown(sourceId, error) {
    set((state) => {
      const previous = state.health[sourceId];
      if (!previous) return state;
      const wasReachable = previous.state !== "OFFLINE";
      // A node that has never answered is a different event from one that was
      // working and stopped. Both deserve saying, but the never-answered case
      // is announced once, after a few attempts, so bringing the dashboard up
      // before the rover does not produce an alert on every page load.
      const neverArrived = previous.lastUpdateAt === null;
      const alreadyAnnounced = state.alerts.some(
        (alert) => alert.sourceId === sourceId && !alert.acknowledged,
      );
      // Transport errors and closes both count failures, so this waits for a
      // few attempts and then says it once, until the operator acknowledges.
      const announceUnreachable =
        neverArrived && previous.failureCount + 1 >= 3 && !alreadyAnnounced;

      // Escalation depends on what this node was supplying. Losing safety data
      // means the operator can no longer be told whether the area is safe, so
      // that is a WARNING; anything else is ATTENTION. §12.1 rule 10.
      const ownedSafety = SAFETY_FIELDS.some(
        (field) => state.fieldOwners[field] === sourceId,
      );
      const level: StatusLevel = ownedSafety ? "WARNING" : "ATTENTION";

      return {
        health: {
          ...state.health,
          [sourceId]: {
            ...previous,
            state: "OFFLINE",
            failureCount: previous.failureCount + 1,
            lastError: error,
          },
        },
        events:
          wasReachable || announceUnreachable
            ? [
                ...state.events,
                {
                  id: nextId("E"),
                  kind: "SOURCE_LOST" as MissionEventKind,
                  level,
                  at: missionNow(),
                  message: wasReachable
                    ? `${previous.label} unreachable`
                    : `${previous.label} is not answering at ${previous.baseUrl}`,
                  sourceId,
                  pose: null,
                },
              ].slice(-MAX_EVENTS)
            : state.events,
        alerts:
          wasReachable || announceUnreachable
            ? [
                ...state.alerts,
                {
                  id: nextId("A"),
                  level,
                  subject: previous.label,
                  message: wasReachable
                    ? `${previous.label} unreachable — data unavailable`
                    : `${previous.label} is not answering — check its address in Settings`,
                  at: missionNow(),
                  sourceId,
                  moduleId: "health" as const,
                  acknowledged: false,
                },
              ].slice(-200)
            : state.alerts,
      };
    });
  },

  tick() {
    const now = missionNow();
    set((state) => {
      let changed = false;
      const health: Record<SourceId, SourceHealth> = {};

      for (const [id, entry] of Object.entries(state.health)) {
        const derived = deriveState(entry, now);
        if (derived !== entry.state) changed = true;
        health[id] = derived === entry.state ? entry : { ...entry, state: derived };
      }

      // Age tracked people into LAST_SEEN once their detections stop.
      let persons = state.persons;
      let personsChanged = false;
      for (const person of Object.values(state.persons)) {
        const stale = now - person.lastSeenAt > 10_000;
        if (stale && person.status !== "LAST_SEEN") {
          if (!personsChanged) {
            persons = { ...state.persons };
            personsChanged = true;
          }
          persons[person.personId] = { ...person, status: "LAST_SEEN" };
        }
      }

      if (!changed && !personsChanged) return state;
      return { health, persons };
    });
  },

  syncNodes(nodes) {
    set((state) => {
      const health: Record<SourceId, SourceHealth> = {};
      for (const node of nodes) {
        const previous = state.health[node.id];
        health[node.id] =
          previous && previous.baseUrl === node.baseUrl
            ? { ...previous, label: node.label, transport: node.transport }
            : blankHealth(node);
      }
      return { health };
    });
  },

  resetData() {
    resetTracking();
    set((state) => ({
      readings: {},
      fieldOwners: {},
      poseHistory: [],
      persons: {},
      health: healthTable(activeNodes()),
      revision: state.revision + 1,
    }));
  },

  startMission(name) {
    const now = missionNow();
    const id = nextId("M");
    resetTracking();
    set((state) => ({
      mission: {
        id,
        name: name ?? `Mission ${new Date(now).toLocaleDateString()}`,
        phase: "SURVEYING",
        startedAt: now,
        endedAt: null,
      },
      persons: {},
      events: [
        {
          id: nextId("E"),
          kind: "MISSION_START",
          level: "NORMAL",
          at: now,
          message: "Mission started — recording timeline",
          sourceId: null,
          pose: null,
        },
      ],
      alerts: [],
      poseHistory: [],
      revision: state.revision + 1,
    }));
  },

  completeMission() {
    const now = missionNow();
    const event: MissionEvent = {
      id: nextId("E"),
      kind: "MISSION_COMPLETE",
      level: "NORMAL",
      at: now,
      message: "Mission complete — route finalized",
      sourceId: null,
      pose: null,
    };
    set((state) => ({
      mission: { ...state.mission, phase: "COMPLETE", endedAt: now },
      events: [...state.events, event].slice(-MAX_EVENTS),
      revision: state.revision + 1,
    }));
  },

  addEvent(event) {
    set((state) => ({
      events: [
        ...state.events,
        { ...event, id: nextId("E"), at: event.at ?? missionNow() },
      ].slice(-MAX_EVENTS),
    }));
  },

  acknowledgeAlert(id) {
    set((state) => ({
      alerts: state.alerts.map((alert) =>
        alert.id === id ? { ...alert, acknowledged: true } : alert,
      ),
    }));
  },

  acknowledgeAll() {
    set((state) => ({
      alerts: state.alerts.map((alert) => ({ ...alert, acknowledged: true })),
    }));
  },
}));

/* ------------------------------------------------------------------ */
/* Field resolution — the only sanctioned way to read telemetry        */
/* ------------------------------------------------------------------ */

/**
 * Resolve a field to available / stale / unavailable.
 *
 * A field whose owning node is STALE or OFFLINE never resolves to its last
 * value styled as current, and a missing value is never zero. §12.1 rule 7.
 */
export function resolveField<T>(state: TelemetryState, field: TelemetryField): FieldResolution<T> {
  const reading = state.readings[field] as Reading<T> | undefined;

  if (!reading) {
    // Nothing has ever sent this field. That is not an error — no node on this
    // rover may carry that component.
    return { status: "unavailable", reason: "never-received", sourceId: null };
  }

  const health = state.health[reading.sourceId];
  if (!health || health.state === "OFFLINE") {
    return { status: "unavailable", reason: "offline", sourceId: reading.sourceId };
  }
  if (health.state === "STALE") {
    return { status: "stale", reading };
  }
  return { status: "available", reading };
}

/** Convenience: the value when usable, else null. Never a substituted zero. */
export function fieldValue<T>(state: TelemetryState, field: TelemetryField): T | null {
  const resolution = resolveField<T>(state, field);
  return resolution.status === "unavailable" ? null : resolution.reading.value;
}

/* ------------------------------------------------------------------ */
/* Derived selectors                                                   */
/* ------------------------------------------------------------------ */

export function sourceHealthList(state: TelemetryState): SourceHealth[] {
  return activeNodes()
    .map((node) => state.health[node.id])
    .filter(Boolean);
}

/**
 * Overall comms = worst state among the enabled nodes that publish telemetry.
 * §4.6.
 *
 * A stream-only node (a camera, no JSON endpoint) is skipped: it has no
 * telemetry channel to be silent on, so counting it would report the whole
 * rover as offline whenever a camera is configured on its own host.
 */
export function overallCommsState(state: TelemetryState): SourceState {
  const order: SourceState[] = ["ONLINE", "DEGRADED", "STALE", "OFFLINE"];
  const reporting = activeNodes().filter((node) => node.transport !== "none");
  if (reporting.length === 0) return "OFFLINE";

  let worstIndex = 0;
  for (const node of reporting) {
    const entry = state.health[node.id];
    if (!entry) continue;
    worstIndex = Math.max(worstIndex, order.indexOf(entry.state));
  }
  return order[worstIndex];
}

/**
 * Whether a module has anything to show.
 *
 * A module is available when at least one of its fields is resolving — from
 * whichever node happens to be sending it. `missing` names the fields with no
 * live owner, so the view can say precisely what is absent.
 */
export function moduleAvailability(
  state: TelemetryState,
  fields: TelemetryField[],
): { available: boolean; missing: TelemetryField[]; downSources: SourceHealth[] } {
  if (fields.length === 0) return { available: true, missing: [], downSources: [] };

  const missing: TelemetryField[] = [];
  const downSources: SourceHealth[] = [];

  for (const field of fields) {
    const resolution = resolveField(state, field);
    if (resolution.status !== "unavailable") continue;
    missing.push(field);
    if (resolution.sourceId) {
      const health = state.health[resolution.sourceId];
      if (health && !downSources.some((entry) => entry.id === health.id)) {
        downSources.push(health);
      }
    }
  }

  return { available: missing.length < fields.length, missing, downSources };
}

/** Highest unacknowledged alert level, for the global indicator. §4 home screen. */
export function globalAlertLevel(state: TelemetryState): StatusLevel | null {
  const open = state.alerts.filter((alert) => !alert.acknowledged);
  if (open.length === 0) return null;
  return worst(...open.map((alert) => alert.level));
}

export function openAlerts(state: TelemetryState): Alert[] {
  return state.alerts.filter((alert) => !alert.acknowledged).slice().reverse();
}

export function personList(state: TelemetryState): PersonRecord[] {
  return Object.values(state.persons).sort((a, b) => b.lastSeenAt - a.lastSeenAt);
}

/** Mission path for the map: ordered pose samples. */
export function missionPath(state: TelemetryState): Pose[] {
  return state.poseHistory.map((sample) => sample.pose);
}

/**
 * Distance travelled, summed from the recorded path.
 *
 * The rover has no wheel encoders, so there is no odometer to read — this is
 * the length of the pose track the node reported, and nothing more.
 */
export function pathLengthM(state: TelemetryState): number {
  let total = 0;
  for (let i = 1; i < state.poseHistory.length; i += 1) {
    const from = state.poseHistory[i - 1].pose;
    const to = state.poseHistory[i].pose;
    total += Math.hypot(to.x - from.x, to.y - from.y);
  }
  return total;
}

/* ------------------------------------------------------------------ */
/* Subscription hooks                                                  */
/* ------------------------------------------------------------------ */

/**
 * Every selector above derives a fresh array or object on each call. zustand
 * compares selector output by reference, so subscribing to one directly would
 * re-render on every store change and spin. These hooks are the sanctioned way
 * to read derived state: shallow comparison keeps the subscription stable, and
 * nothing inside a selector may depend on the current time.
 */

export function useSourceHealthList(): SourceHealth[] {
  return useTelemetry(useShallow(sourceHealthList));
}

export function usePersonList(): PersonRecord[] {
  return useTelemetry(useShallow(personList));
}

export function useOpenAlerts(): Alert[] {
  return useTelemetry(useShallow(openAlerts));
}

export function useMissionPath(): Pose[] {
  return useTelemetry(useShallow(missionPath));
}

export function useFieldResolution<T>(field: TelemetryField): FieldResolution<T> {
  return useTelemetry(useShallow((state) => resolveField<T>(state, field)));
}

/** The value when usable, else null. Stored references stay stable. */
export function useFieldValue<T>(field: TelemetryField): T | null {
  return useTelemetry((state) => fieldValue<T>(state, field));
}

/**
 * Two subscriptions on purpose.
 *
 * `moduleAvailability` builds a fresh wrapper object on every call, so
 * subscribing to it directly would never compare equal and would spin the
 * component. Each array is shallow-compared instead: field names compare by
 * value, and health entries are the store's own stable objects.
 */
export function useModuleAvailability(fields: TelemetryField[]): {
  available: boolean;
  missing: TelemetryField[];
  downSources: SourceHealth[];
} {
  const missing = useTelemetry(
    useShallow((state) => moduleAvailability(state, fields).missing),
  );
  const downSources = useTelemetry(
    useShallow((state) => moduleAvailability(state, fields).downSources),
  );
  return {
    available: fields.length === 0 || missing.length < fields.length,
    missing,
    downSources,
  };
}

/** Module summaries are `{ status, summary }` of primitives — shallow is enough. */
export function useSummary(
  selector: (state: TelemetryState) => { status: StatusLevel; summary: string },
): { status: StatusLevel; summary: string } {
  return useTelemetry(useShallow(selector));
}
