import { useEffect, useRef, useState } from "react";
import { useTelemetry } from "../../lib/telemetry-store";
import { cn } from "../../lib/utils";

/** How long without a frame before the heartbeat reads as stopped. */
const QUIET_MS = 3500;

/**
 * Header heartbeat: is anything arriving at all?
 *
 * The one indicator that is about the pipe rather than the rover. It answers
 * "did my address work" at a glance, which is otherwise a trip into a module
 * to find out.
 */
export function DataFlowDot() {
  const revision = useTelemetry((state) => state.revision);
  const lastFrameAt = useRef(0);
  const [flowing, setFlowing] = useState(false);

  // Record arrivals without re-rendering for each one: at 200 ms cadence that
  // would be five renders a second for a two-pixel dot.
  useEffect(() => {
    lastFrameAt.current = Date.now();
  }, [revision]);

  // The dot has to go red on its own, so it is driven by a timer rather than
  // by the next frame — which may never come.
  useEffect(() => {
    const timer = setInterval(() => {
      const fresh = Date.now() - lastFrameAt.current < QUIET_MS;
      setFlowing((previous) => (previous === fresh ? previous : fresh));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <span
      className={cn(
        "inline-block size-2 rounded-full transition-colors duration-700",
        flowing ? "bg-normal animate-pulse" : "bg-critical",
      )}
      title={flowing ? "Data flowing" : "No data in the last few seconds"}
    />
  );
}
