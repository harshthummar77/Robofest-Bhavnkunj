/**
 * Core domain types for OrionPax.
 *
 * Two rules shape everything here:
 *
 * 1. PROJECT_CONTEXT.md §12.1 — telemetry arrives from N independent hosts and
 *    every stored value carries provenance.
 * 2. Every field below maps to a physical component on the rover
 *    (PROJECT_CONTEXT.md §11). Nothing is displayed that no component can
 *    report, and nothing is fabricated when a component is silent.
 */

/* ------------------------------------------------------------------ */
/* Nodes (data sources)                                                */
/* ------------------------------------------------------------------ */

/** Stable key for a node. The registry is a list — the count is not fixed. */
export type SourceId = string;

/**
 * How a node publishes telemetry.
 *
 * `none` is for a node that serves only an MJPEG stream and has no JSON
 * endpoint — it still appears in the registry so its camera path has a home.
 */
export type Transport = "http-poll" | "websocket" | "none";

/** Which mock streams a node stands in for while in mock data mode. */
export type MockProfile = "vision" | "thermal" | "environment" | "motion";

/**
 * One rover node. Addresses live only in the registry
 * (`src/config/nodes.ts` + the Settings view) — never in a component.
 */
export interface NodeConfig {
  id: SourceId;
  /** Operator-facing name, e.g. "ESP32 A — environment". */
  label: string;
  /** Host + port, no trailing slash. */
  baseUrl: string;
  transport: Transport;
  /** Path appended to baseUrl for the JSON telemetry channel. */
  telemetryPath: string;
  /** Expected update cadence in ms. Staleness is derived from this. */
  expectedIntervalMs: number;
  /** A disabled node is not polled and is not counted in overall comms. */
  enabled: boolean;
  /** MJPEG/snapshot path for an RGB camera this node serves. */
  cameraPath?: string;
  /** MJPEG/snapshot path for a thermal camera this node serves as an image. */
  thermalPath?: string;
  /** Which mock streams this node emits in mock data mode. */
  mockProfiles?: MockProfile[];
}

/**
 * Per-node connection state.
 *
 * STALE is distinct from OFFLINE on purpose: a socket that is still open but
 * silent is not online. §12.1 rule 5.
 */
export type SourceState = "ONLINE" | "DEGRADED" | "STALE" | "OFFLINE";

export interface SourceHealth {
  id: SourceId;
  label: string;
  baseUrl: string;
  transport: Transport;
  state: SourceState;
  /** Mission-clock ms of the last accepted payload, null if never. */
  lastUpdateAt: number | null;
  /** Consecutive failed connect/poll attempts. */
  failureCount: number;
  /** Last transport-level error, kept for the technical panel only. */
  lastError: string | null;
  /** Fields this node has actually delivered. */
  fields: TelemetryField[];
  /** Payload keys the ingest layer did not recognise. Shown in Settings. */
  unknownKeys: string[];
}

/* ------------------------------------------------------------------ */
/* Telemetry fields — one per thing a rover component can report       */
/* ------------------------------------------------------------------ */

/**
 * Every field the dashboard can display, grouped by the component that
 * produces it. A field with no live owner resolves to "unavailable".
 */
export type TelemetryField =
  /* Pi Camera 3 + AI HAT+ */
  | "detections"
  | "aiStatus"
  | "cameraFps"
  /* MLX90640 thermal camera */
  | "thermalFrame"
  | "hotspots"
  | "heatSignatures"
  | "thermalPeakC"
  | "thermalMinC"
  | "thermalAmbientC"
  /* BME280 */
  | "temperature"
  | "humidity"
  | "pressure"
  /* MQ-2 / MQ-135 */
  | "gas"
  /* Node-side interpretation, when a node supplies one */
  | "safetyState"
  /* TF-Luna LiDAR */
  | "lidar"
  /* MPU6050 */
  | "imu"
  /* Node-side pose estimate (odometry + IMU fusion) */
  | "pose"
  | "heading"
  /* GPS NEO-6M — surface only */
  | "gps"
  /* FlySky FS-i6 via iBUS */
  | "rfLink"
  | "rfChannels"
  /* BTS7960 + DC gear motors */
  | "drive"
  /* 12 V battery pack */
  | "battery"
  /* Raspberry Pi 5 board */
  | "cpuTemp";

/** Operator-facing label and the component behind each field. */
export interface FieldMeta {
  field: TelemetryField;
  label: string;
  /** The physical component that produces it. §11 */
  component: string;
  /** Which module view displays it. */
  module: ModuleId;
}

/**
 * A stored telemetry value with mandatory provenance.
 * A value with no known source is never displayed. §12.1 rule 4.
 */
export interface Reading<T = unknown> {
  value: T;
  sourceId: SourceId;
  /** Timestamp as reported by the node (may drift). */
  sourceTimestamp: number;
  /** Mission-clock ms at which the dashboard accepted it. */
  receivedAt: number;
  /** Node state at acceptance time. */
  state: SourceState;
}

/**
 * Resolution result for a field. Missing is never rendered as zero.
 *
 * Deliberately carries no computed age: this shape is produced inside store
 * selectors, and a value that changes on every call breaks reference equality
 * and spins the subscription. Age is derived at render time from
 * `reading.receivedAt`.
 */
export type FieldResolution<T> =
  | { status: "available"; reading: Reading<T> }
  | { status: "stale"; reading: Reading<T> }
  | { status: "unavailable"; reason: "offline" | "never-received"; sourceId: SourceId | null };

/* ------------------------------------------------------------------ */
/* Interpreted states                                                  */
/* ------------------------------------------------------------------ */

/**
 * The one status scale used across the entire interface. §2 rule 8, §5.
 * UNKNOWN exists so a lost safety source is never shown as NORMAL.
 */
export type StatusLevel = "NORMAL" | "ATTENTION" | "WARNING" | "CRITICAL" | "UNKNOWN";

export type HealthLevel = "HEALTHY" | "ATTENTION_REQUIRED" | "WARNING" | "CRITICAL" | "UNKNOWN";

/* ------------------------------------------------------------------ */
/* Component payloads                                                  */
/* ------------------------------------------------------------------ */

/**
 * Pose in the mission frame, as estimated on the node.
 *
 * There are no wheel encoders on this rover and GPS does not work underground
 * (§4.3), so this is an estimate the node publishes — the dashboard neither
 * invents it nor integrates it itself.
 */
export interface Pose {
  /** Metres in the mission frame, origin = mission start point. */
  x: number;
  y: number;
  /** Degrees, 0 = mission-frame north. */
  heading: number;
}

export interface Detection {
  /** Mission ID, e.g. "P-003". */
  personId: string;
  confidence: number;
  /** Normalised bounding box, 0..1, relative to the RGB frame. */
  box: { x: number; y: number; w: number; h: number };
  detectedAt: number;
  /** Class reported by the model when it reports one. */
  label?: string;
}

/**
 * One MQ-series gas sensor.
 *
 * MQ-2 (LPG, propane, methane, hydrogen, smoke) and MQ-135 (NH3, NOx,
 * benzene, smoke, CO2) are uncalibrated analog sensors: they output a voltage
 * that rises with total reducing-gas concentration. Converting that to ppm
 * requires a per-sensor calibration curve in clean air, which this rover does
 * not carry — so the dashboard shows the proportion of full scale and names
 * what the sensor responds to, and never prints a fabricated ppm figure.
 */
export interface GasReading {
  sensorId: string;
  label: string;
  /** 0..1 proportion of the ADC's full scale. */
  raw: number;
  /** The ADC count as reported, when the node sends counts. */
  rawAdc?: number;
  /** ADC full scale behind `rawAdc` (4095 on an ESP32). */
  adcMax?: number;
  /** What this sensor responds to, for the technical panel. */
  responds?: string;
}

export interface Hotspot {
  /** Normalised position in the thermal frame. */
  x: number;
  y: number;
  celsius: number;
  /** Plain-language band, not a raw threshold. */
  band: "NORMAL_HEAT" | "ELEVATED_HEAT" | "HIGH_HEAT";
  humanLike: boolean;
}

/** MLX90640 frame: 32 x 24 temperatures, row-major. */
export interface ThermalFrame {
  width: number;
  height: number;
  /** Celsius per cell, length === width * height. */
  cells: number[];
}

/**
 * Battery pack state.
 *
 * The pack is read through a voltage divider on an ADC. There is no coulomb
 * counter or fuel gauge on this rover, so there is no runtime estimate — a
 * "minutes remaining" figure would be invented. Percent is derived from the
 * pack voltage when the node does not send one.
 */
export interface BatteryReading {
  percent: number;
  volts: number;
  /** True when percent was derived from voltage rather than reported. */
  percentEstimated?: boolean;
}

/** TF-Luna: distance in cm, plus the return-signal amplitude it reports. */
export interface LidarReading {
  distanceCm: number;
  /** Signal amplitude. Below ~100 the reading is unreliable per the datasheet. */
  strength?: number;
}

export interface DriveReading {
  moving: boolean;
  /** 0..1 duty the ESP32 is applying to the BTS7960 drivers. */
  speed: number;
  /** Only present when the firmware actually checks the drivers. */
  motorsOk?: boolean;
  direction?: "forward" | "reverse" | "left" | "right" | "stopped";
}

/**
 * FlySky FS-i6 link state, reported by the ESP32 that reads iBUS.
 *
 * The transmitter is the drive authority (PROJECT_CONTEXT.md §4.7), so whether
 * that link is alive is operator-critical information the dashboard would
 * otherwise have no way to show.
 *
 * No RSSI field: the FS-iA6B receiver does not publish signal strength in its
 * iBUS servo frames, so a number here would have no source.
 */
export interface RfLinkReading {
  connected: boolean;
  /** True when the receiver has dropped to failsafe. */
  failsafe: boolean;
  /** Age of the last iBUS frame in ms, null when the node cannot measure it. */
  lastPacketAgeMs: number | null;
}

/** Raw iBUS channel values, 1000-2000 us. The FS-i6 has six channels. */
export type RfChannels = number[];

/**
 * MPU6050 output.
 *
 * Pitch and roll are solvable from the accelerometer alone. Yaw is not: the
 * MPU6050 has no magnetometer, so a yaw figure can only come from integrating
 * the Z gyro, which drifts. It is therefore optional and labelled as relative.
 */
export interface ImuReading {
  pitch: number;
  roll: number;
  /** Gyro-integrated relative yaw, when the node reports it. Drifts. */
  yaw?: number;
  accel?: { x: number; y: number; z: number };
  gyro?: { x: number; y: number; z: number };
}

/**
 * GPS NEO-6M. Usable on the surface only — see §4.3.
 *
 * Coordinates are optional because a module with no fix has none: underground
 * the NEO-6M still reports its state and satellite count, and that state is
 * worth showing. A missing position is never filled in with zeros, which
 * would place the rover off the coast of Africa.
 */
export interface GpsReading {
  /** True when the module reports a position fix. */
  fix: boolean;
  latitude?: number;
  longitude?: number;
  satellites?: number;
  altitudeM?: number;
  speedKmh?: number;
  /** Horizontal dilution of precision, as the module reports it. */
  hdop?: number;
}

/* ------------------------------------------------------------------ */
/* Personnel                                                           */
/* ------------------------------------------------------------------ */

export type PersonStatus = "DETECTED" | "TRACKING" | "RECONFIRMED" | "LAST_SEEN";

export interface PersonRecord {
  personId: string;
  status: PersonStatus;
  firstDetectedAt: number;
  lastSeenAt: number;
  /** Pose at the most recent confirmed detection. */
  lastKnownPose: Pose | null;
  rgbConfirmed: boolean;
  thermalConfirmed: boolean;
  /** Highest confidence seen for this person. */
  bestConfidence: number;
  history: PersonHistoryEntry[];
}

export interface PersonHistoryEntry {
  at: number;
  /** Which sensor produced this entry. */
  sensor: "rgb" | "thermal";
  /** Which host reported it. Provenance survives into the report. §12.1 rule 12. */
  sourceId: SourceId;
  pose: Pose | null;
  confidence: number;
  celsius?: number;
}

/* ------------------------------------------------------------------ */
/* Mission                                                             */
/* ------------------------------------------------------------------ */

export type MissionPhase =
  | "READY"
  | "SURVEYING"
  | "EVENT_DETECTED"
  | "INVESTIGATING"
  | "COMPLETE";

export type MissionEventKind =
  | "MISSION_START"
  | "MISSION_COMPLETE"
  | "PERSON_DETECTED"
  | "PERSON_RECONFIRMED"
  | "THERMAL_FINDING"
  | "ENVIRONMENT_WARNING"
  | "OBSTACLE"
  | "SOURCE_LOST"
  | "SOURCE_RESTORED"
  | "BOOKMARK";

export interface MissionEvent {
  id: string;
  kind: MissionEventKind;
  level: StatusLevel;
  /** Mission-clock ms. Ordering authority is the mission clock. §12.1 rule 9. */
  at: number;
  /** Operator-facing sentence. Never a raw value. §6. */
  message: string;
  /** Which host reported the underlying data. */
  sourceId: SourceId | null;
  pose: Pose | null;
  /** Optional structured detail for the technical panel. */
  detail?: Record<string, unknown>;
}

export interface Mission {
  id: string;
  name: string;
  phase: MissionPhase;
  startedAt: number | null;
  endedAt: number | null;
}

/* ------------------------------------------------------------------ */
/* Alerts                                                             */
/* ------------------------------------------------------------------ */

export interface Alert {
  id: string;
  level: StatusLevel;
  /** Short operator-facing line. */
  message: string;
  /** What the alert is about, e.g. "Environment Safety". */
  subject: string;
  at: number;
  sourceId: SourceId | null;
  /** Module to open when the operator acts on the alert. */
  moduleId?: ModuleId;
  acknowledged: boolean;
}

/* ------------------------------------------------------------------ */
/* Modules                                                             */
/* ------------------------------------------------------------------ */

export type ModuleId =
  | "vision"
  | "thermal"
  | "map"
  | "environment"
  | "personnel"
  | "health"
  | "control"
  | "reports";

export interface ModuleDefinition {
  id: ModuleId;
  /** Module name, e.g. "Vision & Detection". */
  label: string;
  /** Human meaning line shown on the card. §4. */
  meaning: string;
  /**
   * Fields this module needs. A module is available when at least one of them
   * has a live owner — whichever node happens to be sending it.
   */
  fields: TelemetryField[];
  /** Sentence shown when no node is reporting any of those fields. */
  degradedMessage: string;
}
