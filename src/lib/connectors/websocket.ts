import { BACKOFF_MS, nodeSocketUrl } from "../../config/nodes";
import type { Connector, ConnectorSink } from "./types";
import type { NodeConfig } from "../types";

/**
 * WebSocket connector for one node — the target transport for live telemetry
 * (PROJECT_CONTEXT.md §12): polling cannot sustain the animated map, the live
 * detection overlays, or alert latency.
 *
 * Independent lifecycle per node, exponential backoff, no global reconnect.
 * §12.1 rule 2.
 */
export function createWebSocketConnector(node: NodeConfig, sink: ConnectorSink): Connector {
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let attempt = 0;
  let stopped = false;

  const url = nodeSocketUrl(node);

  function scheduleReconnect(reason: string | null): void {
    if (stopped || retryTimer !== null) return;
    const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
    attempt += 1;
    sink.onDown(node.id, reason);
    retryTimer = setTimeout(() => {
      retryTimer = null;
      connect();
    }, delay);
  }

  function teardown(): void {
    if (!socket) return;
    socket.onopen = null;
    socket.onmessage = null;
    socket.onerror = null;
    socket.onclose = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      socket.close();
    }
    socket = null;
  }

  function connect(): void {
    if (stopped) return;
    teardown();

    let next: WebSocket;
    try {
      next = new WebSocket(url);
    } catch (error) {
      scheduleReconnect(error instanceof Error ? error.message : "socket construction failed");
      return;
    }
    socket = next;

    next.onopen = () => {
      attempt = 0;
      sink.onUp(node.id);
    };

    next.onmessage = (event: MessageEvent) => {
      if (typeof event.data !== "string") {
        sink.onError(node.id, "unexpected binary frame");
        return;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(event.data);
      } catch {
        sink.onError(node.id, "payload is not valid JSON");
        return;
      }

      sink.onPayload(node.id, raw);
    };

    next.onerror = () => {
      sink.onError(node.id, "socket error");
    };

    next.onclose = (event: CloseEvent) => {
      socket = null;
      scheduleReconnect(event.reason || `socket closed (${event.code})`);
    };
  }

  return {
    node,
    start() {
      stopped = false;
      connect();
    },
    stop() {
      stopped = true;
      if (retryTimer !== null) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
      teardown();
    },
  };
}
