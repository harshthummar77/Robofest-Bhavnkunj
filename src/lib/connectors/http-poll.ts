import { BACKOFF_MS, nodeTelemetryUrl } from "../../config/nodes";
import type { Connector, ConnectorSink } from "./types";
import type { NodeConfig } from "../types";

/**
 * HTTP polling connector for one node. This is the transport the rover uses
 * today (PROJECT_CONTEXT.md §12).
 *
 * The node has its own failure domain: a dead address backs off on its own
 * schedule and never stalls another node or triggers a global reconnect.
 * §12.1 rule 2.
 *
 * There is no silent fall back to simulated data. If the address does not
 * answer, this node reads as offline — mock data is an explicit mode the
 * operator switches into, never something the dashboard substitutes while
 * claiming to be live.
 */
export function createHttpPollConnector(node: NodeConfig, sink: ConnectorSink): Connector {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight: AbortController | null = null;
  let attempt = 0;
  let stopped = false;
  let wasUp = false;

  const url = nodeTelemetryUrl(node);

  function nextDelay(failed: boolean): number {
    if (!failed) return node.expectedIntervalMs;
    return BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
  }

  function schedule(failed: boolean): void {
    if (stopped || timer !== null) return;
    timer = setTimeout(() => {
      timer = null;
      void poll();
    }, nextDelay(failed));
  }

  function fail(error: string): void {
    attempt += 1;
    if (wasUp) {
      wasUp = false;
      sink.onDown(node.id, error);
    } else {
      sink.onError(node.id, error);
    }
    schedule(true);
  }

  async function poll(): Promise<void> {
    if (stopped || !url) return;

    const controller = new AbortController();
    inFlight = controller;
    const timeout = setTimeout(
      () => controller.abort(),
      Math.max(node.expectedIntervalMs * 2, 4000),
    );

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: { Accept: "application/json" },
        cache: "no-store",
      });

      if (!response.ok) {
        fail(`HTTP ${response.status}`);
        return;
      }

      const raw: unknown = await response.json();
      attempt = 0;
      if (!wasUp) {
        wasUp = true;
        sink.onUp(node.id);
      }
      sink.onPayload(node.id, raw);
      schedule(false);
    } catch (error) {
      if (controller.signal.aborted && stopped) return;
      const message =
        error instanceof DOMException && error.name === "AbortError"
          ? "request timed out"
          : error instanceof Error
            ? error.message
            : "request failed";
      fail(message);
    } finally {
      clearTimeout(timeout);
      if (inFlight === controller) inFlight = null;
    }
  }

  return {
    node,
    start() {
      stopped = false;
      if (!url) {
        sink.onError(node.id, "no telemetry path configured");
        return;
      }
      void poll();
    },
    stop() {
      stopped = true;
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      inFlight?.abort();
      inFlight = null;
    },
  };
}
