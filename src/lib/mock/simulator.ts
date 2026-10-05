/**
 * MOCK ROVER — a simulated OrionPax, in the shapes the real nodes publish.
 *
 * Mock data mode exists so the whole dashboard is exercisable with no rover on
 * the bench: every module, every alert path, every "source lost" branch. It is
 * only useful if it is honest, so this simulator emits **only values a
 * component in PROJECT_CONTEXT.md §11 can actually produce**, in the units that
 * component reports them in:
 *
 *  - Pi Camera 3 + AI HAT+ -> bounding boxes with a confidence and a track id
 *  - MLX90640              -> 32x24 = 768 cell temperatures, plus ambient
 *  - BME280                -> temperature °C, humidity %RH, pressure hPa
 *  - MQ-2 / MQ-135         -> 12-bit ADC counts, not ppm (uncalibrated sensors)
 *  - TF-Luna               -> distance in cm with a return amplitude
 *  - MPU6050               -> accel in g and gyro in °/s (no magnetometer, so
 *                             no absolute heading)
 *  - GPS NEO-6M            -> no fix, because the simulated mission is
 *                             underground, which is the real behaviour
 *  - FS-i6 via iBUS        -> link state and 1000-2000 us channel values
 *  - BTS7960 + motors       -> applied duty and direction
 *  - 12 V pack              -> pack voltage only (there is no fuel gauge)
 *
 * The payloads go through the same `lib/ingest` recognition path as real
 * traffic, so mock mode is a test of the routing too, not a bypass of it.
 *
 * Shared with `mock-server/` so the browser-side mock and the standalone HTTP
 * mock nodes cannot drift apart.
 */

export type MockProfile = "vision" | "thermal" | "environment" | "motion";

/** MLX90640 geometry. */
const THERMAL_WIDTH = 32;
const THERMAL_HEIGHT = 24;

/** ESP32 ADC full scale. */
const ADC_MAX = 4095;

interface Person {
  id: number;
  /** Distance along the route at which this person becomes visible, metres. */
  atDistance: number;
}

export interface Simulator {
  /** Advance the simulated world. */
  step(elapsedMs: number): void;
  /** A payload in the shape the node carrying this component would publish. */
  payload(profile: MockProfile): Record<string, unknown>;
  /** One payload covering several profiles, as a combined node would send. */
  combined(profiles: MockProfile[]): Record<string, unknown>;
}

export function createSimulator(): Simulator {
  const state = {
    x: 0,
    y: 0,
    heading: 0,
    /** Route length travelled, metres. */
    travelled: 0,
    packVolts: 12.45,
    gasBase: 0.07,
    airTemperature: 28.4,
    cpuTemperature: 48,
    elapsed: 0,
  };

  const people: Person[] = [
    { id: 1, atDistance: 5 },
    { id: 2, atDistance: 17 },
    { id: 3, atDistance: 30 },
  ];

  /** People within the camera's useful window, in route order. */
  function inFrame(): Person[] {
    return people.filter((person) => {
      const delta = state.travelled - person.atDistance;
      return delta >= 0 && delta < 7;
    });
  }

  function step(elapsedMs: number): void {
    const seconds = elapsedMs / 1000;
    state.elapsed += elapsedMs;

    // Wander forward with a slow turn, so the map path is worth looking at.
    state.heading += Math.sin(state.elapsed / 9000) * 14 * seconds;
    const radians = (state.heading * Math.PI) / 180;
    const step_ = 0.9 * seconds;
    state.x += Math.sin(radians) * step_;
    state.y += Math.cos(radians) * step_;
    state.travelled += step_;

    // 3S pack sagging under load, slowly.
    state.packVolts = Math.max(9.9, state.packVolts - 0.00025 * seconds);
    state.airTemperature = 28.4 + Math.sin(state.elapsed / 20000) * 6;
    state.cpuTemperature = 48 + Math.sin(state.elapsed / 30000) * 14;
    state.gasBase = 0.07 + Math.max(0, Math.sin(state.elapsed / 30000)) * 0.45;
  }

  /* --- Pi Camera 3 + AI HAT+ ------------------------------------- */
  function visionPayload(): Record<string, unknown> {
    const visible = inFrame();
    return {
      timestamp: Date.now(),
      camera: { fps: 24 },
      aiOnline: true,
      system: { cpuTemp: Number(state.cpuTemperature.toFixed(1)) },
      detections: visible.map((person, index) => ({
        trackId: person.id,
        label: "person",
        confidence: Number(
          Math.min(0.97, 0.7 + (state.travelled - person.atDistance) * 0.05).toFixed(3),
        ),
        box: {
          x: Number((0.2 + index * 0.26 + Math.sin(state.elapsed / 1700 + index) * 0.03).toFixed(4)),
          y: Number((0.3 + Math.cos(state.elapsed / 2300 + index) * 0.03).toFixed(4)),
          w: 0.16,
          h: 0.36,
        },
      })),
    };
  }

  /* --- MLX90640 --------------------------------------------------- */
  function thermalPayload(): Record<string, unknown> {
    const visible = inFrame();
    const cells: number[] = [];
    const ambient = 21 + Math.sin(state.elapsed / 26000) * 1.5;

    for (let row = 0; row < THERMAL_HEIGHT; row += 1) {
      for (let column = 0; column < THERMAL_WIDTH; column += 1) {
        // Ambient field with a gentle vertical gradient and sensor noise.
        let celsius =
          ambient +
          (THERMAL_HEIGHT - row) * 0.11 +
          Math.sin((column + state.elapsed / 900) / 4) * 0.4;

        // A person reads as a warm blob peaking near skin temperature.
        visible.forEach((_, index) => {
          const centreX = THERMAL_WIDTH * (0.28 + index * 0.26);
          const centreY = THERMAL_HEIGHT * 0.45;
          const distance = Math.hypot(column - centreX, row - centreY);
          if (distance < 5.5) celsius += (5.5 - distance) * 2.9;
        });

        cells.push(Number(celsius.toFixed(2)));
      }
    }

    return {
      timestamp: Date.now(),
      mlx90640: {
        ambient: Number(ambient.toFixed(2)),
        max: Number(Math.max(...cells).toFixed(2)),
        min: Number(Math.min(...cells).toFixed(2)),
        pixels: cells,
      },
      // The thermal node confirms what the camera already named.
      thermalConfirms: visible.map((person) => `P-${String(person.id).padStart(3, "0")}`),
    };
  }

  /* --- BME280 + MQ-2 / MQ-135 ------------------------------------- */
  function environmentPayload(): Record<string, unknown> {
    return {
      timestamp: Date.now(),
      bme280: {
        temperature: Number(state.airTemperature.toFixed(2)),
        humidity: Number((61 + Math.sin(state.elapsed / 25000) * 14).toFixed(1)),
        pressure: Number((1008 + Math.sin(state.elapsed / 40000) * 4).toFixed(1)),
      },
      // Raw 12-bit ADC counts, exactly as an ESP32 analogRead returns them.
      gas: {
        mq2: Math.round(state.gasBase * ADC_MAX),
        mq135: Math.round((state.gasBase * 0.8 + 0.04) * ADC_MAX),
      },
      adcMax: ADC_MAX,
      // No safetyState: the node leaves interpretation to the one shared
      // threshold module, which is the path worth exercising. §13
    };
  }

  /* --- MPU6050, TF-Luna, GPS, iBUS, drive, battery ---------------- */
  function motionPayload(): Record<string, unknown> {
    const failsafe = Math.sin(state.elapsed / 60000) > 0.97;
    const throttle = failsafe ? 0 : 0.42;

    return {
      timestamp: Date.now(),
      pose: {
        x: Number(state.x.toFixed(3)),
        y: Number(state.y.toFixed(3)),
        heading: Number((((state.heading % 360) + 360) % 360).toFixed(1)),
      },
      mpu6050: {
        // Accelerometer in g, gyro in degrees/second.
        accel_x: Number((Math.sin(state.elapsed / 3000) * 0.04).toFixed(3)),
        accel_y: Number((Math.cos(state.elapsed / 3700) * 0.03).toFixed(3)),
        accel_z: Number((1 + Math.sin(state.elapsed / 5000) * 0.01).toFixed(3)),
        gyro_x: Number((Math.sin(state.elapsed / 1500) * 1.2).toFixed(2)),
        gyro_y: Number((Math.cos(state.elapsed / 1900) * 0.9).toFixed(2)),
        gyro_z: Number((Math.sin(state.elapsed / 9000) * 14).toFixed(2)),
      },
      lidar: {
        distance: Number((40 + Math.abs(Math.sin(state.elapsed / 7000)) * 260).toFixed(0)),
        strength: Math.round(900 + Math.abs(Math.cos(state.elapsed / 5000)) * 4000),
      },
      // Pack voltage only. No fuel gauge on this rover, so no percentage and
      // no runtime estimate — the dashboard derives charge from the curve.
      battery: { voltage: Number(state.packVolts.toFixed(2)) },
      drive: {
        moving: throttle > 0,
        speed: Math.round(throttle * 100),
        direction: throttle > 0 ? "forward" : "stopped",
        motorsOk: true,
      },
      ibus: {
        connected: true,
        failsafe,
        lastPacketAgeMs: failsafe
          ? Math.round(1200 + Math.abs(Math.sin(state.elapsed / 900)) * 800)
          : Math.round(14 + Math.abs(Math.sin(state.elapsed / 5000)) * 10),
        // Six channels, 1000-2000 us, as iBUS reports them.
        channels: [
          1500,
          Math.round(1500 + throttle * 400),
          Math.round(1500 + Math.sin(state.elapsed / 4000) * 300),
          1500,
          1000,
          2000,
        ],
      },
      // The mission is underground: the NEO-6M sees no satellites, which is
      // the honest reading rather than a fabricated position.
      gps: { fix: false, satellites: 0 },
    };
  }

  const builders: Record<MockProfile, () => Record<string, unknown>> = {
    vision: visionPayload,
    thermal: thermalPayload,
    environment: environmentPayload,
    motion: motionPayload,
  };

  return {
    step,
    payload: (profile) => builders[profile](),
    combined(profiles) {
      return profiles.reduce<Record<string, unknown>>(
        (merged, profile) => Object.assign(merged, builders[profile]()),
        {},
      );
    },
  };
}

/**
 * Spread the four mock profiles over however many nodes are configured.
 *
 * A node may declare what it stands in for. Anything undeclared is handed out
 * round-robin, and any profile nobody covers is added to the first node — so
 * mock mode fills the dashboard whether the registry holds one address or six.
 */
export function assignMockProfiles<T extends { id: string; mockProfiles?: MockProfile[] }>(
  nodes: T[],
): Map<string, MockProfile[]> {
  const cycle: MockProfile[][] = [["vision", "thermal"], ["environment"], ["motion"]];
  const assignment = new Map<string, MockProfile[]>();

  if (nodes.length === 0) return assignment;
  if (nodes.length === 1) {
    assignment.set(nodes[0].id, ["vision", "thermal", "environment", "motion"]);
    return assignment;
  }

  nodes.forEach((node, index) => {
    assignment.set(
      node.id,
      node.mockProfiles && node.mockProfiles.length > 0
        ? [...node.mockProfiles]
        : [...cycle[index % cycle.length]],
    );
  });

  const covered = new Set([...assignment.values()].flat());
  const uncovered = (["vision", "thermal", "environment", "motion"] as MockProfile[]).filter(
    (profile) => !covered.has(profile),
  );
  if (uncovered.length > 0) {
    assignment.set(nodes[0].id, [
      ...(assignment.get(nodes[0].id) ?? []),
      ...uncovered,
    ]);
  }

  return assignment;
}
