import type { ModuleEntry } from "../../config/modules";
import { fieldLabel } from "../../lib/field-catalog";
import { useModuleAvailability } from "../../lib/telemetry-store";
import type { StatusLevel } from "../../lib/types";
import { cn } from "../../lib/utils";
import { StatusBadge } from "./status-badge";

/**
 * One large module card on the home grid. §4.
 *
 * Motion rule 4: the card is the origin of the single hero transition. Hover
 * and press use the 150ms state token only — no bouncing, no spring.
 * §12.1 rule 6: a card whose source is down is visibly marked, and the grid
 * still renders all eight.
 */
export function ModuleCard({
  module,
  status,
  summary,
  onOpen,
}: {
  module: ModuleEntry;
  /** Module-level status rolled up from its own data. */
  status: StatusLevel;
  /** One operator-facing line. Never a raw number. §6 */
  summary: string;
  onOpen: () => void;
}) {
  // Availability is about the data, not the host: a card is marked unavailable
  // when nothing on the network is reporting the values it needs. §12.1 rule 6
  const { available, missing } = useModuleAvailability(module.fields);
  const Icon = module.Icon;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "group relative flex min-h-44 flex-col items-start gap-3 rounded-card border border-border bg-surface p-5 text-left",
        "transition-state hover:border-border-strong hover:bg-surface-raised",
        "focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none",
        "active:scale-[0.995]",
        !available && "border-dashed",
      )}
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span
          className={cn(
            "flex size-12 items-center justify-center rounded-2xl transition-state",
            available
              ? "bg-primary/10 text-primary group-hover:bg-primary/15"
              : "bg-unknown-soft text-unknown",
          )}
        >
          <Icon size={26} weight="duotone" />
        </span>
        <StatusBadge level={available ? status : "UNKNOWN"} size="sm" />
      </div>

      <div className="min-w-0 space-y-1">
        <h2 className="text-base font-semibold text-foreground">{module.label}</h2>
        <p className="text-xs text-faint-foreground">{module.meaning}</p>
      </div>

      {/* Reserve the summary row so a reconnect never shifts the grid. Rule 10. */}
      <p
        className={cn(
          "mt-auto line-clamp-2 min-h-8 text-sm",
          available ? "text-muted-foreground" : "text-warning",
        )}
      >
        {available ? summary : `Waiting on ${missing.map(fieldLabel).join(", ")}`}
      </p>
    </button>
  );
}
