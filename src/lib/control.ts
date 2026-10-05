/**
 * MISSION COMMAND PATH — recording only, acknowledged.
 *
 * The rover is driven by the FlySky FS-i6 transmitter, which is the sole drive
 * authority (PROJECT_CONTEXT.md §4.7). The dashboard therefore sends **no
 * motor commands at all**: no movement, no speed, no stop. Two independent
 * authorities commanding the same motors with no arbitration is a hazard, and
 * the pilot's hands are on the sticks anyway.
 *
 * Stopping the rover is a hardware function: an FS-i6 switch bound to a stop
 * channel, plus an ESP32 failsafe on iBUS loss. Neither goes through here.
 *
 * What remains are mission-recording commands, which touch no actuator.
 */

import { commandEndpoint } from "../config/nodes";
import { dataMode } from "./data-mode";

export type Command = { kind: "mission"; action: "start" | "complete" };

export interface CommandAck {
  accepted: boolean;
  /** Rover-side message, surfaced to the operator verbatim when it refuses. */
  message: string;
  /** Round-trip time in ms, shown so a sluggish link is visible. */
  latencyMs: number;
}

const COMMAND_TIMEOUT_MS = 2500;

export async function sendCommand(command: Command): Promise<CommandAck> {
  // In mock mode there is no rover to tell. The mission is still recorded in
  // the dashboard — the acknowledgement just says where it went.
  if (dataMode() === "mock") {
    return { accepted: true, message: "Recorded locally (mock data mode)", latencyMs: 0 };
  }

  const endpoint = commandEndpoint();
  if (!endpoint) {
    return { accepted: false, message: "No node configured to record the mission", latencyMs: 0 };
  }

  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), COMMAND_TIMEOUT_MS);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(command),
      signal: controller.signal,
    });

    const latencyMs = Math.round(performance.now() - started);

    if (!response.ok) {
      return {
        accepted: false,
        message: `Rover refused command (HTTP ${response.status})`,
        latencyMs,
      };
    }

    const body = (await response.json().catch(() => null)) as
      | { accepted?: boolean; message?: string }
      | null;

    return {
      accepted: body?.accepted !== false,
      message: body?.message ?? "Command acknowledged",
      latencyMs,
    };
  } catch (error) {
    const latencyMs = Math.round(performance.now() - started);
    const aborted = error instanceof DOMException && error.name === "AbortError";
    return {
      accepted: false,
      message: aborted ? "No acknowledgement — command timed out" : "Control link unreachable",
      latencyMs,
    };
  } finally {
    clearTimeout(timer);
  }
}
