import { useEffect } from "react";
import { useNodeRegistry } from "../config/nodes";
import { startAllConnectors, type ConnectorSink } from "./connectors";
import { useDataModeStore } from "./data-mode";
import { startMockDriver } from "./mock/mock-driver";
import { useTelemetry } from "./telemetry-store";

/** One staleness evaluation interval for the whole app, not one per component. */
const TICK_MS = 500;

/**
 * Starts the data layer once, and drives the single staleness tick.
 *
 * Mount this exactly once, at the app root. In real mode each node runs in its
 * own failure domain inside `startAllConnectors` (PROJECT_CONTEXT.md §12.1
 * rule 2); in mock mode the in-browser simulator feeds the identical sink.
 *
 * The effect re-runs when the mode changes or the registry is edited, so
 * applying a new address or flipping to mock takes effect immediately — the
 * dashboard never needs a page reload to point somewhere else.
 */
export function useTelemetryRuntime(): void {
  const mode = useDataModeStore((state) => state.mode);
  const registryRevision = useNodeRegistry((state) => state.revision);

  useEffect(() => {
    const store = useTelemetry.getState();

    // Start clean: a reading from the previous mode or the previous address
    // must not survive into the new one looking current.
    store.syncNodes(useNodeRegistry.getState().nodes.filter((node) => node.enabled));
    store.resetData();

    const sink: ConnectorSink = {
      onPayload: store.ingest,
      onUp: store.markUp,
      onError: store.markError,
      onDown: store.markDown,
    };

    const stop = mode === "mock" ? startMockDriver(sink) : startAllConnectors(sink);
    const ticker = setInterval(() => useTelemetry.getState().tick(), TICK_MS);

    return () => {
      clearInterval(ticker);
      stop();
    };
  }, [mode, registryRevision]);
}
