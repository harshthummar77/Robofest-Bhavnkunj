import { activeNodes } from "../../config/nodes";
import type { Connector, ConnectorSink } from "./types";
import { createHttpPollConnector } from "./http-poll";
import { createWebSocketConnector } from "./websocket";
import type { NodeConfig } from "../types";

export type { Connector, ConnectorSink } from "./types";

/**
 * Build the connector for a node based on its declared transport.
 *
 * A node with transport `none` serves only an MJPEG stream: that is consumed
 * directly by an <img> element from `rgbStreamUrl` / `thermalStreamUrl`, so it
 * has no telemetry connector.
 */
export function createConnector(node: NodeConfig, sink: ConnectorSink): Connector | null {
  switch (node.transport) {
    case "websocket":
      return createWebSocketConnector(node, sink);
    case "http-poll":
      return createHttpPollConnector(node, sink);
    case "none":
      return null;
    default: {
      // Exhaustiveness guard: a new transport must be handled explicitly.
      const unreachable: never = node.transport;
      throw new Error(`Unhandled transport "${String(unreachable)}".`);
    }
  }
}

/**
 * Start every enabled node. Each gets its own connector instance and its own
 * failure domain. §12.1 rule 2.
 *
 * Returns a stop function that tears all of them down.
 */
export function startAllConnectors(sink: ConnectorSink): () => void {
  const connectors: Connector[] = [];

  for (const node of activeNodes()) {
    const connector = createConnector(node, sink);
    if (!connector) continue;
    connectors.push(connector);
    // Independent start — one throwing constructor must not prevent the rest.
    try {
      connector.start();
    } catch (error) {
      sink.onError(node.id, error instanceof Error ? error.message : "failed to start");
    }
  }

  return () => {
    for (const connector of connectors) {
      try {
        connector.stop();
      } catch {
        // Teardown is best-effort.
      }
    }
  };
}
