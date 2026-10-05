/**
 * THRESHOLDS — the one place that turns a number into a status.
 *
 * PROJECT_CONTEXT.md §13: the interpreted state is part of the data contract,
 * not something a component invents. Where a source supplies its own
 * interpreted state, that wins. Where it does not, it is derived here and
 * nowhere else.
 *
 * Also holds the operator-facing phrasing (§6): the UI shows a sentence, with
 * the exact value available alongside — never a bare number to decode.
 */

import type {
  BatteryReading,
  GasReading,
  GpsReading,
  Hotspot,
  LidarReading,
  RfLinkReading,
  StatusLevel,
} from "./types";

/* ------------------------------------------------------------------ */
/* Configured ranges                                                   */
/* ------------------------------------------------------------------ */

export const THRESHOLDS = {
  temperatureC: { attention: 35, warning: 45, critical: 60 },
  humidityPct: { attention: 80, warning: 90, critical: 95 },
  /** Normalised gas level, 0..1 of the sensor's reported scale. */
  gasLevel: { attention: 0.3, warning: 0.5, critical: 0.7 },
  /** Obstacle distance in cm — lower is worse, so bands invert. */
  obstacleCm: { attention: 100, warning: 50, critical: 25 },
  batteryPct: { attention: 40, warning: 20, critical: 10 },
  /** Human core-temperature window for a heat signature. */
  humanHeatC: { min: 30, max: 42 },
  hotspotC: { elevated: 45, high: 60 },
  /** Raspberry Pi 5 throttles at 80 °C and hard-limits at 85 °C. */
  cpuTempC: { attention: 70, warning: 80, critical: 85 },
  /**
   * TF-Luna return amplitude. The datasheet calls a reading unreliable below
   * 100 and saturated above 30000 — both mean "do not trust this distance".
   */
  lidarStrength: { minimum: 100, saturated: 30000 },
} as const;

/**
 * Pack voltage to state of charge, for a 3S lithium pack (12 V nominal,
 * 12.6 V full, 9.9 V empty — the 12 V 5200 mAh pack in §11).
 *
 * This is a resting-voltage approximation and it sags under motor load, so it
 * is reported as an estimate. There is no fuel gauge on the rover, so a
 * "minutes remaining" figure has no source and is never shown.
 */
const PACK_CURVE: [volts: number, percent: number][] = [
  [12.6, 100],
  [12.45, 90],
  [12.33, 80],
  [12.19, 70],
  [12.06, 60],
  [11.94, 50],
  [11.82, 40],
  [11.7, 30],
  [11.49, 20],
  [11.19, 10],
  [9.9, 0],
];

export function percentFromPackVoltage(volts: number): number {
  if (!Number.isFinite(volts)) return 0;
  if (volts >= PACK_CURVE[0][0]) return 100;
  const last = PACK_CURVE[PACK_CURVE.length - 1];
  if (volts <= last[0]) return 0;

  for (let i = 1; i < PACK_CURVE.length; i += 1) {
    const [highV, highPct] = PACK_CURVE[i - 1];
    const [lowV, lowPct] = PACK_CURVE[i];
    if (volts >= lowV) {
      const ratio = (volts - lowV) / (highV - lowV);
      return Math.round(lowPct + (highPct - lowPct) * ratio);
    }
  }
  return 0;
}

/** Rank used to combine several statuses into one. */
const RANK: Record<StatusLevel, number> = {
  NORMAL: 0,
  ATTENTION: 1,
  UNKNOWN: 2,
  WARNING: 3,
  CRITICAL: 4,
};

/**
 * Combine statuses, worst wins.
 *
 * UNKNOWN ranks above ATTENTION deliberately: not knowing whether the area is
 * safe is more serious than a known minor anomaly, and must never be absorbed
 * by a NORMAL reading from another sensor. §12.1 rule 10.
 */
export function worst(...levels: StatusLevel[]): StatusLevel {
  if (levels.length === 0) return "UNKNOWN";
  return levels.reduce((acc, level) => (RANK[level] > RANK[acc] ? level : acc));
}

/** Ascending band: value rises, status worsens. */
function bandAscending(
  value: number,
  bands: { attention: number; warning: number; critical: number },
): StatusLevel {
  if (!Number.isFinite(value)) return "UNKNOWN";
  if (value >= bands.critical) return "CRITICAL";
  if (value >= bands.warning) return "WARNING";
  if (value >= bands.attention) return "ATTENTION";
  return "NORMAL";
}

/** Descending band: value falls, status worsens. */
function bandDescending(
  value: number,
  bands: { attention: number; warning: number; critical: number },
): StatusLevel {
  if (!Number.isFinite(value)) return "UNKNOWN";
  if (value <= bands.critical) return "CRITICAL";
  if (value <= bands.warning) return "WARNING";
  if (value <= bands.attention) return "ATTENTION";
  return "NORMAL";
}

/* ------------------------------------------------------------------ */
/* Interpretation — status + the sentence that goes with it            */
/* ------------------------------------------------------------------ */

export interface Interpretation {
  level: StatusLevel;
  /** Operator-facing sentence. §6. */
  message: string;
  /** Exact value, shown below the status for technical review. */
  exact: string;
}

export function interpretTemperature(celsius: number | null): Interpretation {
  if (celsius === null) {
    return { level: "UNKNOWN", message: "Temperature unavailable", exact: "—" };
  }
  const level = bandAscending(celsius, THRESHOLDS.temperatureC);
  const words: Record<StatusLevel, string> = {
    NORMAL: "Normal",
    ATTENTION: "Warm",
    WARNING: "Hot — caution",
    CRITICAL: "Dangerously hot",
    UNKNOWN: "Unknown",
  };
  return {
    level,
    message: `Temperature ${celsius.toFixed(1)}°C — ${words[level]}`,
    exact: `${celsius.toFixed(2)} °C`,
  };
}

export function interpretHumidity(percent: number | null): Interpretation {
  if (percent === null) {
    return { level: "UNKNOWN", message: "Humidity unavailable", exact: "—" };
  }
  const level = bandAscending(percent, THRESHOLDS.humidityPct);
  const words: Record<StatusLevel, string> = {
    NORMAL: "Normal",
    ATTENTION: "Humid",
    WARNING: "Very humid",
    CRITICAL: "Saturated air",
    UNKNOWN: "Unknown",
  };
  return {
    level,
    message: `Humidity ${percent.toFixed(0)}% — ${words[level]}`,
    exact: `${percent.toFixed(1)} %`,
  };
}

export function interpretPressure(hPa: number | null): Interpretation {
  if (hPa === null) {
    return { level: "UNKNOWN", message: "Pressure unavailable", exact: "—" };
  }
  return {
    level: "NORMAL",
    message: `Pressure ${hPa.toFixed(0)} hPa — Normal`,
    exact: `${hPa.toFixed(1)} hPa`,
  };
}

/**
 * Gas sensors are combined into one air-condition statement. The operator is
 * never shown a raw MQ-series reading as the primary value. §4.4, §6.
 */
export function interpretGas(readings: GasReading[] | null): Interpretation {
  if (!readings || readings.length === 0) {
    return {
      level: "UNKNOWN",
      message: "Air condition unknown — sensor data unavailable",
      exact: "—",
    };
  }
  const level = worst(
    ...readings.map((reading) => bandAscending(reading.raw, THRESHOLDS.gasLevel)),
  );
  const words: Record<StatusLevel, string> = {
    NORMAL: "Air condition normal",
    ATTENTION: "Air condition: Caution — check environment",
    WARNING: "Air condition requires attention",
    CRITICAL: "Hazardous air — evacuate consideration",
    UNKNOWN: "Air condition unknown",
  };
  const exact = readings
    .map((reading) => `${reading.label} ${(reading.raw * 100).toFixed(0)}% of scale`)
    .join(" · ");
  return { level, message: words[level], exact };
}

export function interpretObstacle(lidar: LidarReading | null): Interpretation {
  if (!lidar) {
    return { level: "UNKNOWN", message: "Obstacle distance unavailable", exact: "—" };
  }

  const exact =
    `${lidar.distanceCm.toFixed(0)} cm` +
    (lidar.strength === undefined ? "" : ` · signal ${lidar.strength.toFixed(0)}`);

  // The TF-Luna publishes a distance even when almost no light came back. A
  // weak return is not a clear path, so it reads as unknown rather than safe.
  if (lidar.strength !== undefined && lidar.strength < THRESHOLDS.lidarStrength.minimum) {
    return {
      level: "UNKNOWN",
      message: "Obstacle distance unreliable — weak LiDAR return",
      exact,
    };
  }

  const level = bandDescending(lidar.distanceCm, THRESHOLDS.obstacleCm);
  if (level === "NORMAL") {
    return { level, message: "Path clear ahead", exact };
  }
  return {
    level,
    message: `Obstacle nearby — ${lidar.distanceCm.toFixed(0)} cm ahead`,
    exact,
  };
}

/**
 * Battery phrasing.
 *
 * No runtime estimate: the pack is measured by a voltage divider and the rover
 * carries no coulomb counter, so minutes-remaining has no source. When the
 * percent itself was derived from voltage, that is stated.
 */
export function interpretBattery(battery: BatteryReading | null): Interpretation {
  if (!battery) {
    return { level: "UNKNOWN", message: "Battery status unavailable", exact: "—" };
  }
  const level = bandDescending(battery.percent, THRESHOLDS.batteryPct);
  const words: Record<StatusLevel, string> = {
    NORMAL: "Healthy",
    ATTENTION: "Monitor",
    WARNING: "Low — plan return",
    CRITICAL: "Critical — return now",
    UNKNOWN: "Unknown",
  };
  return {
    level,
    message: `Battery ${battery.percent.toFixed(0)}% — ${words[level]}`,
    exact:
      `${battery.percent.toFixed(0)} %` +
      (battery.volts > 0 ? ` · ${battery.volts.toFixed(2)} V` : "") +
      (battery.percentEstimated ? " (from pack voltage)" : ""),
  };
}

/** Raspberry Pi 5 die temperature. It throttles at 80 °C. */
export function interpretCpuTemp(celsius: number | null): Interpretation {
  if (celsius === null) {
    return { level: "UNKNOWN", message: "Processor temperature unavailable", exact: "—" };
  }
  const level = bandAscending(celsius, THRESHOLDS.cpuTempC);
  const words: Record<StatusLevel, string> = {
    NORMAL: "Normal",
    ATTENTION: "Warm",
    WARNING: "Throttling likely",
    CRITICAL: "Overheating",
    UNKNOWN: "Unknown",
  };
  return {
    level,
    message: `Processor ${celsius.toFixed(0)}°C — ${words[level]}`,
    exact: `${celsius.toFixed(1)} °C`,
  };
}

/**
 * GPS NEO-6M. Underground this module has no sky, so "no fix" is the expected
 * state rather than a fault — it is reported as information, not as a warning.
 */
export function interpretGps(gps: GpsReading | null): Interpretation {
  if (!gps) {
    return { level: "UNKNOWN", message: "No satellite position reported", exact: "—" };
  }

  const position =
    gps.latitude === undefined || gps.longitude === undefined
      ? "no position"
      : `${gps.latitude.toFixed(5)}, ${gps.longitude.toFixed(5)}`;
  const exact =
    position +
    (gps.satellites === undefined ? "" : ` · ${gps.satellites} satellites`) +
    (gps.hdop === undefined ? "" : ` · HDOP ${gps.hdop.toFixed(1)}`);

  // No fix is the expected state underground, not a fault, so it reads as
  // unknown rather than as a warning the operator should act on.
  if (!gps.fix) {
    return {
      level: "UNKNOWN",
      message:
        gps.satellites === 0 || gps.satellites === undefined
          ? "No satellite fix — expected below ground"
          : `No satellite fix — ${gps.satellites} satellites in view`,
      exact,
    };
  }
  return { level: "NORMAL", message: "Satellite fix acquired", exact };
}

/** Heat-signature phrasing. §4.2: a sentence plus the exact temperature. */
export function interpretHeatSignature(celsius: number | null): Interpretation {
  if (celsius === null) {
    return { level: "UNKNOWN", message: "Thermal data unavailable", exact: "—" };
  }
  const humanLike =
    celsius >= THRESHOLDS.humanHeatC.min && celsius <= THRESHOLDS.humanHeatC.max;
  if (humanLike) {
    return {
      level: "CRITICAL",
      message: `Human-like heat signature detected — ${celsius.toFixed(1)}°C`,
      exact: `${celsius.toFixed(2)} °C`,
    };
  }
  const level = bandAscending(celsius, {
    attention: THRESHOLDS.hotspotC.elevated,
    warning: THRESHOLDS.hotspotC.high,
    critical: THRESHOLDS.hotspotC.high + 20,
  });
  const words: Record<StatusLevel, string> = {
    NORMAL: "Normal heat",
    ATTENTION: "Elevated heat",
    WARNING: "High heat",
    CRITICAL: "Extreme heat",
    UNKNOWN: "Unknown",
  };
  return {
    level,
    message: `${words[level]} — ${celsius.toFixed(1)}°C`,
    exact: `${celsius.toFixed(2)} °C`,
  };
}

/** Derive a hotspot band from a temperature. Used when a node sends only °C. */
export function hotspotBand(celsius: number): Hotspot["band"] {
  if (celsius >= THRESHOLDS.hotspotC.high) return "HIGH_HEAT";
  if (celsius >= THRESHOLDS.hotspotC.elevated) return "ELEVATED_HEAT";
  return "NORMAL_HEAT";
}

/**
 * FS-i6 link state. The transmitter is the drive authority, so losing this
 * link means the pilot has lost the rover — reported as CRITICAL, not as a
 * minor anomaly. §4.7
 */
export function interpretRfLink(link: RfLinkReading | null): Interpretation {
  if (link === null) {
    return {
      level: "UNKNOWN",
      message: "Transmitter link state not reported",
      exact: "—",
    };
  }

  const exact =
    link.lastPacketAgeMs === null
      ? "last frame age not reported"
      : `last frame ${link.lastPacketAgeMs} ms ago`;

  if (link.failsafe) {
    return {
      level: "CRITICAL",
      message: "Transmitter signal lost — rover in failsafe",
      exact,
    };
  }
  if (!link.connected) {
    return { level: "CRITICAL", message: "Transmitter not connected", exact };
  }
  if (link.lastPacketAgeMs !== null && link.lastPacketAgeMs > 500) {
    return {
      level: "WARNING",
      message: `Transmitter link weak — last frame ${link.lastPacketAgeMs} ms ago`,
      exact,
    };
  }
  return { level: "NORMAL", message: "Transmitter link healthy", exact };
}

/** Confidence phrasing. The operator sees words; the number stays available. §6. */
export function interpretConfidence(confidence: number): Interpretation {
  const words =
    confidence >= 0.85
      ? "high-confidence detection"
      : confidence >= 0.6
        ? "probable detection"
        : "low-confidence detection";
  return {
    level: confidence >= 0.6 ? "CRITICAL" : "ATTENTION",
    message: `Person detected — ${words}`,
    exact: `${(confidence * 100).toFixed(0)} %`,
  };
}

/* ------------------------------------------------------------------ */
/* Presentation labels                                                 */
/* ------------------------------------------------------------------ */

export const STATUS_LABEL: Record<StatusLevel, string> = {
  NORMAL: "Normal",
  ATTENTION: "Attention",
  WARNING: "Warning",
  CRITICAL: "Critical",
  UNKNOWN: "Unknown",
};

/** §5 meanings, used in tooltips and the legend. */
export const STATUS_MEANING: Record<StatusLevel, string> = {
  NORMAL: "Everything is operating within the configured safe range.",
  ATTENTION: "Something unusual has appeared but does not yet require urgent action.",
  WARNING: "A condition may affect safety or mission progress.",
  CRITICAL: "Immediate operator attention is required.",
  UNKNOWN: "This cannot be assessed — the reporting source is unavailable.",
};
