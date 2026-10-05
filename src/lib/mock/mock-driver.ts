/**
 * MOCK DRIVER — runs the simulated rover inside the browser.
 *
 * In mock data mode no address is contacted and no mock server is needed. The
 * simulator's payloads are handed to the same `ConnectorSink` the real
 * connectors use, so they travel the same recognition, provenance, staleness
 * and alert path as live traffic. The only difference is where the bytes came
 * from — and the header says so, continuously, while this is running.
 */

import { activeNodes } from "../../config/nodes";
import type { ConnectorSink } from "../connectors";
import { assignMockProfiles, createSimulator } from "./simulator";

/** The world advances on its own clock, independent of publish cadence. */
const WORLD_TICK_MS = 100;

/** Floor on publish cadence, so a 50 ms node setting cannot flood the store. */
const MIN_PUBLISH_MS = 150;

export function startMockDriver(sink: ConnectorSink): () => void {
  const nodes = activeNodes();
  const simulator = createSimulator();
  const assignment = assignMockProfiles(nodes);

  let last = Date.now();
  const world = setInterval(() => {
    const now = Date.now();
    simulator.step(now - last);
    last = now;
  }, WORLD_TICK_MS);

  const timers: ReturnType<typeof setInterval>[] = [];

  for (const node of nodes) {
    const profiles = assignment.get(node.id);
    if (!profiles || profiles.length === 0) continue;

    // A mock node is reachable by definition, so report transport up once and
    // let the staleness tick govern the rest exactly as it would for real.
    sink.onUp(node.id);
    timers.push(
      setInterval(
        () => sink.onPayload(node.id, simulator.combined(profiles)),
        Math.max(MIN_PUBLISH_MS, node.expectedIntervalMs),
      ),
    );
  }

  return () => {
    clearInterval(world);
    for (const timer of timers) clearInterval(timer);
  };
}
