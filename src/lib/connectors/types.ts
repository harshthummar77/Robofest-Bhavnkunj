import type { NodeConfig, SourceId } from "../types";

/**
 * What a connector reports upward. The store is the only consumer.
 *
 * PROJECT_CONTEXT.md §12.1 rule 3: transport is per node and mixed by design,
 * but the store sees one shape either way — so swapping a node from HTTP
 * polling to WebSocket later touches only its connector.
 *
 * A connector does no interpretation. It hands the raw JSON object up and
 * `lib/ingest` decides what the dashboard recognises, so one recognition path
 * serves every transport and the mock driver alike.
 */
export interface ConnectorSink {
  /** A JSON payload arrived from this node. */
  onPayload(sourceId: SourceId, raw: unknown): void;
  /** Transport is up (socket open, or a poll succeeded). */
  onUp(sourceId: SourceId): void;
  /** Transport failed or a payload was rejected. Degrades this node only. */
  onError(sourceId: SourceId, error: string): void;
  /** Transport closed and a reconnect is pending. */
  onDown(sourceId: SourceId, error: string | null): void;
}

export interface Connector {
  readonly node: NodeConfig;
  /** Begin connecting. Idempotent. */
  start(): void;
  /** Stop and release the transport. No further sink calls after this. */
  stop(): void;
}
