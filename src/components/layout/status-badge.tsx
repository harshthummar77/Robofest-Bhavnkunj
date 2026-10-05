import { cva, type VariantProps } from "class-variance-authority";
import { STATUS_LABEL, STATUS_MEANING } from "../../lib/thresholds";
import type { SourceState, StatusLevel } from "../../lib/types";
import { cn } from "../../lib/utils";

/**
 * The single status chip used across the whole interface. §2 rule 8.
 * Alert motion is graded here and nowhere else: subtle pulse at ATTENTION,
 * stronger only at CRITICAL. §5 / §9.1 motion rule 7.
 */
const badgeVariants = cva(
  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium whitespace-nowrap transition-state",
  {
    variants: {
      level: {
        NORMAL: "bg-normal-soft text-normal",
        ATTENTION: "bg-attention-soft text-attention",
        WARNING: "bg-warning-soft text-warning",
        CRITICAL: "bg-critical-soft text-critical",
        UNKNOWN: "bg-unknown-soft text-unknown",
      },
      size: {
        sm: "px-2 py-0.5 text-[11px]",
        md: "px-2.5 py-1 text-xs",
      },
    },
    defaultVariants: { level: "UNKNOWN", size: "md" },
  },
);

const dotVariants = cva("size-2 rounded-full shrink-0", {
  variants: {
    level: {
      NORMAL: "bg-normal",
      ATTENTION: "bg-attention pulse-attention",
      WARNING: "bg-warning pulse-attention",
      CRITICAL: "bg-critical pulse-critical",
      UNKNOWN: "bg-unknown",
    },
  },
  defaultVariants: { level: "UNKNOWN" },
});

export function StatusBadge({
  level,
  label,
  size,
  className,
}: {
  level: StatusLevel;
  /** Overrides the default status word when the context needs its own. */
  label?: string;
  className?: string;
} & VariantProps<typeof badgeVariants>) {
  return (
    <span
      className={cn(badgeVariants({ level, size }), className)}
      title={STATUS_MEANING[level]}
    >
      <span className={dotVariants({ level })} />
      {label ?? STATUS_LABEL[level]}
    </span>
  );
}

/** Per-source connection state mapped onto the same visual scale. §4.6 */
export const SOURCE_STATE_LEVEL: Record<SourceState, StatusLevel> = {
  ONLINE: "NORMAL",
  DEGRADED: "ATTENTION",
  STALE: "WARNING",
  OFFLINE: "CRITICAL",
};

export const SOURCE_STATE_LABEL: Record<SourceState, string> = {
  ONLINE: "Online",
  DEGRADED: "Degraded",
  STALE: "Stale",
  OFFLINE: "Offline",
};

export function SourceStateBadge({
  state,
  className,
}: {
  state: SourceState;
  className?: string;
}) {
  return (
    <StatusBadge
      level={SOURCE_STATE_LEVEL[state]}
      label={SOURCE_STATE_LABEL[state]}
      className={className}
    />
  );
}
