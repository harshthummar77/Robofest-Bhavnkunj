import { fieldLabel } from "../../lib/field-catalog";
import { formatAge } from "../../lib/mission-clock";
import type { SourceHealth, TelemetryField } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconNode } from "../icons";
import { SourceStateBadge } from "./status-badge";

/**
 * One row per node: host, state, last-update age, and what it is supplying.
 * §4.6 / §12.1 rule 11. Rover Health is the source-of-truth view for
 * connectivity, so this is where technical detail is allowed to surface.
 */
export function SourceHealthRow({ source }: { source: SourceHealth }) {
  // A stream-only node has no telemetry channel, so it has no connection state
  // to report. Showing it as OFFLINE would be a fault that is not one — the
  // camera element reports its own health on the view that plays it.
  const streamOnly = source.transport === "none";
  const offline = !streamOnly && source.state === "OFFLINE";

  return (
    <div
      className={cn(
        "rounded-xl border bg-surface-raised px-4 py-3 transition-state",
        offline ? "border-critical/30" : "border-border",
      )}
    >
      <div className="flex items-center gap-3">
        <IconNode
          size={20}
          weight="duotone"
          className={offline ? "text-critical" : "text-muted-foreground"}
        />

        <div className="min-w-0 flex-1">
          <span className="truncate text-sm font-medium text-foreground">{source.label}</span>
          <p className="truncate font-mono text-[11px] text-faint-foreground">
            {source.baseUrl || "no address"} · {source.transport}
          </p>
        </div>

        <div className="shrink-0 text-right">
          {streamOnly ? (
            <span className="rounded-full bg-unknown-soft px-2.5 py-1 text-[11px] text-unknown">
              Stream only
            </span>
          ) : (
            <SourceStateBadge state={source.state} />
          )}
          <p className="mt-1 text-[11px] text-faint-foreground">
            {streamOnly ? "no telemetry channel" : formatAge(source.lastUpdateAt)}
          </p>
        </div>
      </div>

      {/* What this node actually supplies — discovered, not configured. */}
      {source.fields.length > 0 ? (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Supplying{" "}
          {source.fields
            .slice(0, 6)
            .map((field) => fieldLabel(field as TelemetryField))
            .join(", ")}
          {source.fields.length > 6 ? ` +${source.fields.length - 6} more` : ""}
        </p>
      ) : null}
    </div>
  );
}

/** Technical panel content: the last transport error, kept out of the main view. */
export function SourceErrorLine({ source }: { source: SourceHealth }) {
  if (!source.lastError) return null;
  return (
    <p className="px-4 pb-2 font-mono text-[11px] text-faint-foreground">
      {source.label}: {source.lastError}
      {source.failureCount > 1 ? ` (${source.failureCount} consecutive)` : ""}
    </p>
  );
}
