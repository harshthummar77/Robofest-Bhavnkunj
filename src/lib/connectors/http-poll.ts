import { BACKOFF_MS, nodeTelemetryUrl } from "../../config/nodes";
import type { Connector, ConnectorSink } from "./types";
import type { NodeConfig } from "../types";

/**
 * Why a fetch failed, in terms the operator can act on.
 *
 * A browser deliberately refuses to tell a page whether a cross-origin request
 * was refused or simply never answered — both surface as the same bare
 * TypeError. The two causes need different fixes, and "Failed to fetch" points
 * at neither, so both are named. A node that does not send
 * `Access-Control-Allow-Origin` is the usual culprit, because a microcontroller
 * sketch has no reason to send it until something asks.
 */
function describeFetchFailure(error: unknown): string {
  if (error instanceof DOMException && error.name === "AbortError") {
    return "request timed out";
  }
  if (error instanceof TypeError) {
    return "no response — the node is unreachable, or it did not allow this origin (CORS)";
  }
  return error instanceof Error ? error.message : "request failed";
}

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
      fail(describeFetchFailure(error));
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
