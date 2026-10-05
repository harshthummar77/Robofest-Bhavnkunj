import { useFieldValue, useTelemetry, overallCommsState } from "../../lib/telemetry-store";
import { useDataMode } from "../../lib/data-mode";
import { formatDuration, missionNow } from "../../lib/mission-clock";
import { interpretBattery } from "../../lib/thresholds";
import type { BatteryReading, MissionPhase } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconBack, IconBattery, IconConnected, IconDisconnected, IconSettings } from "../icons";
import { Button } from "../ui/button";
import { StatusBadge, SOURCE_STATE_LABEL, SOURCE_STATE_LEVEL } from "./status-badge";
import { ThemeToggle } from "./theme-provider";
import { DataFlowDot } from "./data-flow-dot";
import { DataModeBadge } from "./data-mode-badge";

/**
 * Header: ORIONPAX + mission name + mission state + connection + battery. §4.
 * Present on the home screen and inside every page, so the operator never
 * loses the global state while looking at a detail view.
 */

const PHASE_LABEL: Record<MissionPhase, string> = {
  READY: "Mission Ready",
  SURVEYING: "Mission Active",
  EVENT_DETECTED: "Event Detected",
  INVESTIGATING: "Investigating",
  COMPLETE: "Mission Complete",
};

const PHASE_LEVEL = {
  READY: "UNKNOWN",
  SURVEYING: "NORMAL",
  EVENT_DETECTED: "CRITICAL",
  INVESTIGATING: "ATTENTION",
  COMPLETE: "NORMAL",
} as const;

export function MissionHeader({
  onBack,
  backLabel = "Back",
  moduleLabel,
  onExit,
  onPilot,
  onSettings,
}: {
  /** Present only inside a page view. §3 */
  onBack?: () => void;
  /** Word on the back control: "Back" inside a page, "Exit" on the grid. */
  backLabel?: string;
  moduleLabel?: string;
  /** Leaves mission control and returns to the landing page. */
  onExit?: () => void;
  /** Opens the driving HUD. §4.7 */
  onPilot?: () => void;
  /** Opens the settings page. */
  onSettings?: () => void;
}) {
  const mission = useTelemetry((state) => state.mission);
  const comms = useTelemetry(overallCommsState);
  const battery = useFieldValue<BatteryReading>("battery");
  const mode = useDataMode();

  const batteryInterpretation = interpretBattery(battery);
  const elapsed =
    mission.startedAt === null
      ? null
      : formatDuration((mission.endedAt ?? missionNow()) - mission.startedAt);

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-background/85 backdrop-blur-xl">
      <div className="mx-auto flex h-16 max-w-[1800px] items-center gap-4 px-4 sm:px-6">
        {onBack ? (
          <Button variant="ghost" size="sm" onClick={onBack} className="-ml-2 shrink-0">
            <IconBack size={16} />
            <span className="hidden sm:inline">{backLabel}</span>
          </Button>
        ) : null}

        <div className="flex min-w-0 items-center gap-3">
          {/* The wordmark is the way out of mission control. */}
          <button
            type="button"
            onClick={onExit}
            disabled={!onExit}
            title={onExit ? "Leave mission control" : undefined}
            className="rounded-lg px-1 text-base font-semibold tracking-[0.2em] text-foreground transition-state enabled:hover:text-primary focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none disabled:cursor-default"
          >
            ORIONPAX
          </button>
          {moduleLabel ? (
            <>
              <span className="text-border-strong">/</span>
              <span className="truncate text-sm text-muted-foreground">{moduleLabel}</span>
            </>
          ) : null}
        </div>

        <div className="ml-auto flex items-center gap-2 sm:gap-3">
          {/* Simulated data is never allowed to look like rover data. */}
          <DataModeBadge onOpenSettings={onSettings} />

          <span className="hidden truncate text-xs text-muted-foreground md:inline">
            {mission.name}
            {elapsed ? ` · ${elapsed}` : ""}
          </span>

          <StatusBadge level={PHASE_LEVEL[mission.phase]} label={PHASE_LABEL[mission.phase]} />

          {/* Battery: percent plus a word, never a bare voltage. §6 */}
          <span
            className="hidden items-center gap-1.5 text-xs text-muted-foreground sm:flex"
            title={batteryInterpretation.message}
          >
            <IconBattery size={16} />
            <span className="tabular">{battery ? `${battery.percent.toFixed(0)}%` : "—"}</span>
          </span>

          {/* Connection reflects the worst enabled node. §4.6 */}
          <span
            className={cn(
              "flex items-center gap-1.5 text-xs",
              comms === "ONLINE" ? "text-muted-foreground" : "text-warning",
            )}
            title={`Communications: ${SOURCE_STATE_LABEL[comms]}`}
          >
            {comms === "OFFLINE" ? (
              <IconDisconnected size={16} />
            ) : (
              <IconConnected size={16} />
            )}
            <span className="hidden lg:inline">{SOURCE_STATE_LABEL[comms]}</span>
          </span>

          {onPilot ? (
            <Button variant="surface" size="sm" onClick={onPilot} title="Open the driving HUD">
              Pilot View
            </Button>
          ) : null}

          {/* Heartbeat: is anything arriving at all? */}
          <span
            className="flex items-center gap-1.5 px-1 text-xs text-muted-foreground"
            title="Live data heartbeat"
          >
            <DataFlowDot />
            <span className="hidden sm:inline">Data</span>
          </span>

          {onSettings ? (
            <button
              type="button"
              onClick={onSettings}
              title="Settings — data source and node addresses"
              className="rounded-md p-1.5 text-muted-foreground transition-state hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
              aria-label="Settings"
            >
              <IconSettings size={16} />
            </button>
          ) : null}

          <ThemeToggle />
        </div>
      </div>

      {/* A thin state line keeps the worst comms state visible without a sidebar. */}
      {comms !== "ONLINE" && mode === "real" ? (
        <div
          className={cn(
            "h-0.5 w-full",
            SOURCE_STATE_LEVEL[comms] === "CRITICAL" ? "bg-critical" : "bg-warning",
          )}
        />
      ) : null}
    </header>
  );
}
