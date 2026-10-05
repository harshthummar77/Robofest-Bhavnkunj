/**
 * FIELD CATALOGUE — every value the dashboard can show, and the component on
 * the rover that produces it.
 *
 * This is the contract behind "display only what the hardware reports"
 * (PROJECT_CONTEXT.md §11 + §13). If a field is not in this table, no view
 * renders it; if a node sends a key that maps to nothing here, Settings lists
 * it as unrecognised rather than the dashboard quietly inventing a meaning.
 */

import type { FieldMeta, TelemetryField } from "./types";

export const FIELD_CATALOG: FieldMeta[] = [
  /* Pi Camera 3 + AI HAT+ 26 TOPS */
  { field: "detections", label: "Person / object detections", component: "Pi Camera 3 + AI HAT+", module: "vision" },
  { field: "aiStatus", label: "AI inference state", component: "Raspberry Pi AI HAT+", module: "vision" },
  { field: "cameraFps", label: "Camera frame rate", component: "Pi Camera 3", module: "vision" },

  /* MLX90640 */
  { field: "thermalFrame", label: "Thermal frame (32x24)", component: "MLX90640", module: "thermal" },
  { field: "hotspots", label: "Hotspots", component: "MLX90640", module: "thermal" },
  { field: "heatSignatures", label: "Human-like heat signatures", component: "MLX90640", module: "thermal" },
  { field: "thermalPeakC", label: "Peak temperature", component: "MLX90640", module: "thermal" },
  { field: "thermalMinC", label: "Coldest temperature", component: "MLX90640", module: "thermal" },
  { field: "thermalAmbientC", label: "Sensor ambient temperature", component: "MLX90640", module: "thermal" },

  /* BME280 */
  { field: "temperature", label: "Air temperature", component: "BME280", module: "environment" },
  { field: "humidity", label: "Relative humidity", component: "BME280", module: "environment" },
  { field: "pressure", label: "Barometric pressure", component: "BME280", module: "environment" },

  /* MQ-2 / MQ-135 */
  { field: "gas", label: "Gas sensors", component: "MQ-2 / MQ-135", module: "environment" },
  { field: "safetyState", label: "Node-interpreted safety state", component: "Node firmware", module: "environment" },

  /* TF-Luna */
  { field: "lidar", label: "Obstacle distance", component: "TF-Luna LiDAR", module: "map" },

  /* Pose / IMU / GPS */
  { field: "pose", label: "Position estimate", component: "MPU6050 + node fusion", module: "map" },
  { field: "heading", label: "Heading", component: "MPU6050 + node fusion", module: "map" },
  { field: "imu", label: "Orientation (pitch / roll)", component: "MPU6050", module: "map" },
  { field: "gps", label: "Satellite position", component: "GPS NEO-6M", module: "map" },

  /* Drive chain */
  { field: "drive", label: "Drive state", component: "BTS7960 + DC gear motors", module: "control" },
  { field: "rfLink", label: "Transmitter link", component: "FlySky FS-i6 via iBUS", module: "control" },
  { field: "rfChannels", label: "iBUS channel values", component: "FlySky FS-i6 via iBUS", module: "control" },

  /* Power and board */
  { field: "battery", label: "Battery pack", component: "12 V 5200 mAh pack (ADC)", module: "health" },
  { field: "cpuTemp", label: "Processor temperature", component: "Raspberry Pi 5 + cooler", module: "health" },
];

export const FIELD_META: Record<TelemetryField, FieldMeta> = Object.fromEntries(
  FIELD_CATALOG.map((entry) => [entry.field, entry]),
) as Record<TelemetryField, FieldMeta>;

export function fieldLabel(field: TelemetryField): string {
  return FIELD_META[field]?.label ?? field;
}
