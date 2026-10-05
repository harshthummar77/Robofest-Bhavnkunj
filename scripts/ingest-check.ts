/**
 * Ingest check: does a payload in each node's real wire shape get recognised,
 * and does every value land on the field the catalogue says it should?
 *
 * This is the guard on the routing promise. The dashboard claims that a value
 * is routed by what it is rather than by which host sent it, so the same
 * payload is replayed from three differently-named nodes and from one combined
 * node, and the recognised field set must come out the same.
 *
 * Run: npm run check:ingest
 */

import { ingestPayload } from "../src/lib/ingest";
import { FIELD_META } from "../src/lib/field-catalog";
import { createSimulator, type MockProfile } from "../src/lib/mock/simulator";
import type { TelemetryField } from "../src/lib/types";

const failures: string[] = [];

function check(name: string, condition: boolean, detail = ""): void {
  if (condition) {
    console.log(`  ok    ${name}`);
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ""}`);
    failures.push(name);
  }
}

const simulator = createSimulator();
// Advance far enough along the route that people are in frame.
for (let i = 0; i < 400; i += 1) simulator.step(100);

/* ---- 1. each profile, as its own node ----------------------------- */

const expected: Record<MockProfile, TelemetryField[]> = {
  vision: ["detections", "aiStatus", "cameraFps", "cpuTemp"],
  thermal: ["thermalFrame", "hotspots", "heatSignatures", "thermalPeakC", "thermalMinC", "thermalAmbientC"],
  environment: ["temperature", "humidity", "pressure", "gas"],
  motion: [
    "pose",
    "heading",
    "imu",
    "lidar",
    "battery",
    "drive",
    "rfLink",
    "rfChannels",
    "gps",
  ],
};

console.log("\nper-profile recognition");
for (const [profile, fields] of Object.entries(expected) as [MockProfile, TelemetryField[]][]) {
  const result = ingestPayload(`node-${profile}`, simulator.payload(profile));
  if (!result.ok) {
    check(profile, false, result.error);
    continue;
  }
  const missing = fields.filter((field) => !result.result.fields.includes(field));
  check(`${profile} fields`, missing.length === 0, `missing ${missing.join(", ")}`);
  check(
    `${profile} has no unrecognised keys`,
    result.result.unknownKeys.length === 0,
    result.result.unknownKeys.join(", "),
  );
}

/* ---- 2. host does not decide routing ------------------------------ */

console.log("\nrouting is content-based");
const thermalFromA = ingestPayload("esp32a", simulator.payload("thermal"));
const thermalFromB = ingestPayload("pi", simulator.payload("thermal"));
check(
  "same payload from two different nodes yields the same fields",
  thermalFromA.ok &&
    thermalFromB.ok &&
    thermalFromA.result.fields.sort().join(",") === thermalFromB.result.fields.sort().join(","),
);

const combined = ingestPayload(
  "single-node",
  simulator.combined(["vision", "thermal", "environment", "motion"]),
);
check("one node sending everything is recognised", combined.ok);
if (combined.ok) {
  const all = Object.values(expected).flat();
  const missing = all.filter((field) => !combined.result.fields.includes(field));
  check("combined payload covers every field", missing.length === 0, missing.join(", "));
  for (const field of combined.result.fields) {
    check(`${field} is in the catalogue`, Boolean(FIELD_META[field as TelemetryField]));
  }
}

/* ---- 3. alternative firmware shapes ------------------------------- */

console.log("\nalternative payload shapes");

const flat = ingestPayload("flat", {
  timestamp: Date.now(),
  temperatureC: 24.5,
  humidityPct: 48,
  pressurePa: 100820,
  mq2: 512,
  distance_cm: 95,
  battery_voltage: 12.1,
});
check("flat snake/camel keys are recognised", flat.ok);
if (flat.ok) {
  const patch = flat.result.patch as Record<string, unknown>;
  check("Pa converted to hPa", patch.pressure === 1008.2, String(patch.pressure));
  check(
    "12-bit ADC becomes a proportion",
    Math.abs((patch.gas as { raw: number }[])[0].raw - 512 / 4095) < 1e-6,
  );
  check(
    "pack voltage becomes a charge estimate",
    (patch.battery as { percent: number; percentEstimated?: boolean }).percentEstimated === true,
  );
}

const uptimeOnly = ingestPayload("esp32", { millis: 48213, bme280: { temperature: 22.2 } });
check("millis() uptime is not taken as a wall clock", uptimeOnly.ok);
if (uptimeOnly.ok) {
  check(
    "timestamp falls back to receipt time",
    Math.abs(uptimeOnly.result.timestamp - Date.now()) < 5000,
  );
}

const noise = ingestPayload("noisy", { somethingElse: 7, nested: { unknownKey: 3 } });
check("a payload with nothing recognisable is rejected", !noise.ok);

const imuTemp = ingestPayload("imu-only", { mpu6050: { temperature: 41.5 } });
check("IMU die temperature is not shown as air temperature", !imuTemp.ok);

/* ---- 3b. a real ESP32 sensor node --------------------------------- */

console.log("");
console.log("real ESP32 payload (nested blocks, availability flags)");

const esp32 = ingestPayload("esp32a", {
  system: { online: true, uptime_ms: 123241, ip: "10.24.65.111", rssi: -71 },
  gps: {
    available: true,
    fix: false,
    latitude: 0,
    longitude: 0,
    altitude_m: 0,
    satellites: 0,
    hdop: 99.99,
    characters_received: 19206,
  },
  mpu6050: {
    available: true,
    accel_x: -0.613, accel_y: 0.19, accel_z: -0.68,
    gyro_x: 1.07, gyro_y: -1.66, gyro_z: -0.64,
    temperature: 46.39,
  },
  bme280: { available: true, temperature: 26.43, humidity: 32.27, pressure_hpa: 1003.19 },
  gas: { mq2_adc: 4095, mq135_adc: 1278 },
  outputs: { buzzer_gpio: 27, audio_dac_gpio: 25 },
});
check("real ESP32 payload is recognised", esp32.ok);
if (esp32.ok) {
  const patch = esp32.result.patch as Record<string, unknown>;
  check("BME280 air temperature is read", patch.temperature === 26.43);
  check("pressure_hpa is read", patch.pressure === 1003.19);
  check(
    "IMU die temperature is not shown as air temperature",
    (patch.imu as { dieTempC?: number }).dieTempC === 46.39 && patch.temperature === 26.43,
  );
  check(
    "no fix means no coordinates, not 0,0",
    (patch.gps as { latitude?: number }).latitude === undefined,
    JSON.stringify(patch.gps),
  );
  check(
    "a railed gas ADC reads as full scale",
    (patch.gas as { raw: number }[])[0].raw === 1,
  );
  check(
    "housekeeping and pin numbers are not flagged as unrecognised",
    esp32.result.unknownKeys.length === 0,
    esp32.result.unknownKeys.join(", "),
  );
}

const unavailable = ingestPayload("esp32a", {
  bme280: { available: false, temperature: 0, humidity: 0, pressure_hpa: 0 },
  gas: { mq2_adc: 512 },
});
check("a sensor marked unavailable contributes nothing", unavailable.ok);
if (unavailable.ok) {
  check(
    "its zeros are not stored as readings",
    !("temperature" in unavailable.result.patch) &&
      !("humidity" in unavailable.result.patch),
    JSON.stringify(unavailable.result.patch),
  );
  check("the working sensor still reports", "gas" in unavailable.result.patch);
}

/* ---- 4. no fabricated values -------------------------------------- */

console.log("\nabsent stays absent");
const partial = ingestPayload("partial", { bme280: { temperature: 20 } });
check("a single sensor yields a single field", partial.ok && partial.result.fields.length === 1);
if (partial.ok) {
  check("humidity is absent, not zero", !("humidity" in partial.result.patch));
  check("gas is absent, not zero", !("gas" in partial.result.patch));
}

console.log(
  failures.length === 0
    ? "\nPASS — every payload shape routed as the catalogue says.\n"
    : `\nFAIL — ${failures.length} check(s) failed.\n`,
);
if (failures.length > 0) process.exit(1);
