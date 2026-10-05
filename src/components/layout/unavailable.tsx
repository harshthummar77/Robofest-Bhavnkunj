import { IconDisconnected } from "../icons";
import { fieldLabel } from "../../lib/field-catalog";
import type { SourceHealth, TelemetryField } from "../../lib/types";
import { formatAge } from "../../lib/mission-clock";
import { cn } from "../../lib/utils";

/**
 * Shown in place of a module's live surface when nothing is reporting its data.
 *
 * PROJECT_CONTEXT.md §12.1 rule 6: partial availability is a normal operating
 * mode, not an error screen — and rule 10: silence is never shown as green.
 * The space is reserved so a reconnect causes no layout shift (motion rule 10).
 *
 * It names the missing values rather than a host, because on this rover the
 * same value may arrive from a different node tomorrow.
 */
export function SourceUnavailable({
  message,
  missing = [],
  sources = [],
  className,
  compact = false,
}: {
  /** The module's own degraded sentence, from config/modules.ts. */
  message: string;
  /** Fields with no live supplier. */
  missing?: TelemetryField[];
  /** Nodes that went offline while owning one of those fields, if any. */
  sources?: SourceHealth[];
  className?: string;
  compact?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center gap-3 rounded-card border border-dashed border-border-strong bg-surface-raised/40 text-center",
        compact ? "p-6" : "min-h-64 p-10",
        className,
      )}
    >
      <IconDisconnected size={compact ? 24 : 34} className="text-warning" weight="duotone" />
      <p className="max-w-sm text-sm text-foreground">{message}</p>

      {missing.length > 0 ? (
        <p className="max-w-md text-xs text-muted-foreground">
          Waiting on: {missing.map((field) => fieldLabel(field)).join(", ")}
        </p>
      ) : null}

      <ul className="space-y-1">
        {sources.map((source) => (
          <li key={source.id} className="text-xs text-muted-foreground">
            <span className="font-medium">{source.label}</span>
            <span className="text-faint-foreground"> · {source.baseUrl}</span>
            <span className="text-faint-foreground">
              {" · last data "}
              {formatAge(source.lastUpdateAt)}
            </span>
          </li>
        ))}
      </ul>

      <p className="text-[11px] text-faint-foreground">
        Reconnecting automatically — other modules are unaffected.
      </p>
    </div>
  );
}
