import * as Popover from "@radix-ui/react-popover";
import { formatTime } from "../../lib/mission-clock";
import { globalAlertLevel, useOpenAlerts, useTelemetry } from "../../lib/telemetry-store";
import type { ModuleId } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconAttention, IconCritical, IconNormal, IconWarning } from "../icons";
import { Button } from "../ui/button";
import { StatusBadge } from "./status-badge";

/**
 * Small global alert indicator — visible only when attention is required. §4.
 *
 * Safety alerts live here, persistently. They are deliberately NOT toasts: a
 * toast disappears, and a safety condition must not. §9.1 (react-hot-toast is
 * reserved for transient confirmations only).
 */
export function AlertIndicator({ onOpenModule }: { onOpenModule(id: ModuleId): void }) {
  const level = useTelemetry(globalAlertLevel);
  const alerts = useOpenAlerts();
  const acknowledgeAll = useTelemetry((state) => state.acknowledgeAll);
  const acknowledgeAlert = useTelemetry((state) => state.acknowledgeAlert);

  // Nothing requires attention: the indicator is absent, not greyed out.
  if (level === null || alerts.length === 0) return null;

  const Icon =
    level === "CRITICAL"
      ? IconCritical
      : level === "WARNING"
        ? IconWarning
        : level === "ATTENTION"
          ? IconAttention
          : IconNormal;

  return (
    <Popover.Root>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={cn(
            "flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-medium transition-state",
            level === "CRITICAL" && "border-critical/40 bg-critical-soft text-critical",
            level === "WARNING" && "border-warning/40 bg-warning-soft text-warning",
            level === "ATTENTION" && "border-attention/40 bg-attention-soft text-attention",
            level === "UNKNOWN" && "border-unknown/40 bg-unknown-soft text-unknown",
          )}
        >
          <Icon
            size={16}
            weight="fill"
            className={level === "CRITICAL" ? "pulse-critical" : "pulse-attention"}
          />
          {alerts.length} {alerts.length === 1 ? "alert" : "alerts"}
        </button>
      </Popover.Trigger>

      <Popover.Portal>
        {/* Radix data-state drives the animation, so the UI cannot animate
            into a state the data is not in. Motion rule 3. */}
        <Popover.Content
          align="end"
          sideOffset={10}
          className={cn(
            "z-50 w-[min(26rem,calc(100vw-2rem))] rounded-card border border-border bg-surface p-3 shadow-xl",
            "data-[state=open]:animate-in data-[state=closed]:animate-out",
            "data-[state=open]:fade-in-0 data-[state=closed]:fade-out-0",
            "data-[state=open]:zoom-in-98 data-[state=closed]:zoom-out-98",
            "duration-150",
          )}
        >
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-xs font-semibold tracking-wide uppercase">Active alerts</h3>
            <Button variant="ghost" size="sm" onClick={acknowledgeAll}>
              Acknowledge all
            </Button>
          </div>

          <ul className="max-h-80 space-y-1.5 overflow-y-auto">
            {alerts.map((alert) => (
              <li
                key={alert.id}
                className="rounded-xl border border-border bg-surface-raised p-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-sm text-foreground">{alert.message}</p>
                    <p className="mt-0.5 text-[11px] text-faint-foreground">
                      {alert.subject} · {formatTime(alert.at)}
                      {alert.sourceId ? ` · ${alert.sourceId}` : ""}
                    </p>
                  </div>
                  <StatusBadge level={alert.level} size="sm" />
                </div>
                <div className="mt-2 flex gap-2">
                  {alert.moduleId ? (
                    <Button
                      size="sm"
                      variant="surface"
                      onClick={() => onOpenModule(alert.moduleId as ModuleId)}
                    >
                      Open
                    </Button>
                  ) : null}
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => acknowledgeAlert(alert.id)}
                  >
                    Acknowledge
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
