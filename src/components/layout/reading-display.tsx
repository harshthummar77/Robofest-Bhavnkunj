import { formatAge } from "../../lib/mission-clock";
import type { Interpretation } from "../../lib/thresholds";
import type { FieldResolution } from "../../lib/types";
import { cn } from "../../lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * The sanctioned way to render a telemetry value.
 *
 * PROJECT_CONTEXT.md §12.1 rule 7: a stale value is shown as stale with its
 * age, never styled as live, and a missing value is never rendered as zero.
 * §4.4: the sentence is primary, the exact value sits below it.
 */
export function ReadingDisplay<T>({
  label,
  resolution,
  interpret,
  className,
}: {
  label: string;
  resolution: FieldResolution<T>;
  /** Turns the value into a status + sentence. Always from lib/thresholds. */
  interpret: (value: T | null) => Interpretation;
  className?: string;
}) {
  if (resolution.status === "unavailable") {
    const interpretation = interpret(null);
    return (
      <div className={cn("space-y-1.5", className)}>
        <div className="flex items-center justify-between gap-3">
          <span className="text-xs tracking-wide text-faint-foreground uppercase">
            {label}
          </span>
          <StatusBadge level="UNKNOWN" label="Unavailable" size="sm" />
        </div>
        <p className="text-sm text-muted-foreground">{interpretation.message}</p>
        <p className="text-[11px] text-faint-foreground">
          {resolution.reason === "offline"
            ? `Reporting source offline${resolution.sourceId ? ` — ${resolution.sourceId}` : ""}`
            : "No reading received yet"}
        </p>
      </div>
    );
  }

  const interpretation = interpret(resolution.reading.value);
  const stale = resolution.status === "stale";

  return (
    <div className={cn("space-y-1.5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs tracking-wide text-faint-foreground uppercase">
          {label}
        </span>
        <StatusBadge level={interpretation.level} size="sm" />
      </div>
      <p
        className={cn(
          "text-base font-medium transition-state",
          // Stale data is visibly held back. It must never read as live.
          stale ? "text-muted-foreground italic" : "text-foreground",
        )}
      >
        {interpretation.message}
      </p>
      <div className="flex items-center justify-between gap-3 text-[11px]">
        <span className="tabular font-mono text-faint-foreground">
          {interpretation.exact}
        </span>
        <span className={cn(stale ? "text-warning" : "text-faint-foreground")}>
          {stale ? `Stale · ${formatAge(resolution.reading.receivedAt)}` : "live"}
        </span>
      </div>
    </div>
  );
}
