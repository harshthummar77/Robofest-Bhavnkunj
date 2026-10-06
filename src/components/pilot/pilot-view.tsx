import { useMemo } from "react";
import { formatAge, formatTime, missionNow } from "../../lib/mission-clock";
import {
  useFieldResolution,
  useFieldValue,
  useMissionPath,
  useModuleAvailability,
  useOpenAlerts,
  useTelemetry,
} from "../../lib/telemetry-store";
import {
  interpretBattery,
  interpretGas,
  interpretObstacle,
  interpretRfLink,
  interpretTemperature,
  worst,
} from "../../lib/thresholds";
import { useEnvironmentStatus } from "../modules/environment-safety";
import type {
  BatteryReading,
  Detection,
  GasReading,
  Hotspot,
  LidarReading,
  Pose,
  RfLinkReading,
  StatusLevel,
} from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconBack, IconLocate } from "../icons";
import { Button } from "../ui/button";
import { DataModeBadge } from "../layout/data-mode-badge";
import { StatusBadge } from "../layout/status-badge";
import { useTheme } from "../layout/theme-provider";
import { MissionMapCanvas, type MapTheme } from "../map/mission-map-canvas";
import { CameraFeed } from "../vision/camera-feed";

/**
 * PILOT VIEW — the driving HUD.
 *
 * The FS-i6 pilot and the dashboard operator are the same person, so while
 * driving they have both hands on the sticks and no free hand to navigate.
 * This view is therefore a single screen with nothing to click: everything
 * needed to drive is visible at once and readable at arm's length.
 *
 * It is a layout, not a second application. It reads the same registry, the
 * same store and the same thresholds as mission control (PROJECT_CONTEXT.md
 * §12.1), so there is no second copy of the connector logic to drift.
 */
export function PilotView({ onExit }: { onExit(): void }) {
  const { theme } = useTheme();

  const pose = useFieldValue<Pose>("pose");
  const lidarResolution = useFieldResolution<LidarReading | null>("lidar");
  const battery = useFieldValue<BatteryReading>("battery");
  const rfLink = useFieldValue<RfLinkReading>("rfLink");
  const detections = useFieldValue<Detection[]>("detections") ?? [];
  const hotspots = useFieldValue<Hotspot[]>("hotspots") ?? [];
  const gas = useFieldValue<GasReading[]>("gas");
  const temperature = useFieldValue<number | null>("temperature");

  const path = useMissionPath();
  const events = useTelemetry((state) => state.events);
  const alerts = useOpenAlerts();
  const environment = useEnvironmentStatus();

  const visionDown = useModuleAvailability(["detections"]).available === false;
  const motionDown = useModuleAvailability(["pose"]).available === false;

  const obstacle = interpretObstacle(
    lidarResolution.status === "unavailable" ? null : lidarResolution.reading.value,
  );
  const link = interpretRfLink(rfLink ?? null);
  const batteryState = interpretBattery(battery);
  const gasState = interpretGas(gas);
  const temperatureState = interpretTemperature(temperature);

  const overall = worst(
    obstacle.level,
    link.level === "UNKNOWN" ? "NORMAL" : link.level,
    batteryState.level,
    environment.status,
  );

  const locatedEvents = useMemo(
    () => events.filter((event) => event.pose !== null).slice(-40),
    [events],
  );

  const mapTheme: MapTheme = useMemo(
    () =>
      theme === "dark"
        ? {
            background: "#0b1119",
            grid: "#1b2635",
            route: "#60a5fa",
            rover: "#e2e8f0",
            start: "#22c55e",
            text: "#8aa0b8",
          }
        : {
            background: "#eef2f7",
            grid: "#dbe3ec",
            route: "#2563eb",
            rover: "#0f172a",
            start: "#16a34a",
            text: "#64748b",
          },
    [theme],
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* Top strip: the four things that must never be hunted for. */}
      <header className="flex shrink-0 items-center gap-3 border-b border-border px-4 py-2">
        <Button variant="ghost" size="sm" onClick={onExit} className="-ml-2 shrink-0">
          <IconBack size={16} />
          <span className="hidden sm:inline">Exit</span>
        </Button>

        <span className="text-sm font-semibold tracking-[0.18em] text-foreground">
          PILOT
        </span>

        {/* The pilot must never confuse a simulated scene for the tunnel ahead. */}
        <DataModeBadge />

        <div className="ml-auto flex items-center gap-2 sm:gap-4">
          <Vital label="Link" level={link.level} value={linkWord(rfLink ?? null)} />
          <Vital
            label="Battery"
            level={batteryState.level}
            value={battery ? `${battery.percent.toFixed(0)}%` : "—"}
          />
          <Vital label="Area" level={environment.status} value={areaWord(environment.status)} />
          <StatusBadge level={overall} />
        </div>
      </header>

      <div className="grid min-h-0 flex-1 gap-3 p-3 lg:grid-cols-[1.6fr_1fr]">
        {/* Camera: the primary surface while driving. */}
        <div className="relative min-h-0 overflow-hidden rounded-card border border-border bg-black">
          {/* The feed draws its own detection overlay. */}
          <CameraFeed detections={detections} stale={false} />

          {/*
            Obstacle distance is the single largest number on screen. It is the
            one value that changes what the pilot does in the next second.
          */}
          <div className="absolute bottom-3 left-3 rounded-2xl bg-black/65 px-5 py-3 backdrop-blur">
            <p className="text-[10px] tracking-[0.18em] text-white/60 uppercase">Ahead</p>
            <p
              className={cn(
                "tabular font-mono text-5xl leading-none font-semibold",
                obstacle.level === "CRITICAL" && "text-critical",
                obstacle.level === "WARNING" && "text-warning",
                obstacle.level === "ATTENTION" && "text-attention",
                (obstacle.level === "NORMAL" || obstacle.level === "UNKNOWN") && "text-white",
              )}
            >
              {lidarResolution.status === "unavailable" ||
              lidarResolution.reading.value === null
                ? "—"
                : `${lidarResolution.reading.value.distanceCm.toFixed(0)}`}
              <span className="ml-1 text-lg font-normal text-white/60">cm</span>
            </p>
          </div>

          {/* Person detection is the mission's whole point: unmissable. */}
          {detections.length > 0 ? (
            <div className="absolute top-3 left-3 rounded-xl bg-critical px-4 py-2 text-sm font-semibold text-white pulse-critical">
              PERSON DETECTED — {detections.map((entry) => entry.personId).join(", ")}
            </div>
          ) : null}

          {visionDown ? (
            <div className="absolute top-3 right-3 rounded-xl bg-warning px-3 py-1.5 text-xs font-semibold text-white">
              NO CAMERA DETECTIONS
            </div>
          ) : null}

          {hotspots.some((hotspot) => hotspot.humanLike) ? (
            <div className="absolute top-3 right-3 rounded-xl bg-warning px-3 py-1.5 text-xs font-semibold text-white">
              HEAT SIGNATURE
            </div>
          ) : null}
        </div>

        {/* Right column: position, then the environment strip. */}
        <div className="grid min-h-0 grid-rows-[1.3fr_auto] gap-3">
          <div className="relative min-h-0 overflow-hidden rounded-card border border-border">
            {motionDown ? (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                Motion node unreachable — position frozen
              </div>
            ) : (
              <MissionMapCanvas
                path={path}
                pose={pose}
                events={locatedEvents}
                theme={mapTheme}
                stale={false}
              />
            )}

            <div className="absolute bottom-2 left-2 flex items-center gap-2 rounded-lg bg-background/80 px-2.5 py-1.5 backdrop-blur">
              <IconLocate size={14} className="text-muted-foreground" />
              <span className="tabular font-mono text-[11px] text-foreground">
                {pose
                  ? `x ${pose.x.toFixed(1)}  y ${pose.y.toFixed(1)}  ${pose.heading.toFixed(0)}°`
                  : "no position"}
              </span>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <HudTile
              label="Air"
              value={gasState.message.replace("Air condition: ", "").replace("Air condition ", "")}
              level={gasState.level}
            />
            <HudTile
              label="Temperature"
              value={
                temperature === null ? "Unavailable" : `${temperature.toFixed(1)}°C`
              }
              level={temperatureState.level}
            />
            <HudTile
              label="Transmitter"
              value={link.message}
              level={link.level}
              wide
            />
          </div>
        </div>
      </div>

      {/* Alert rail: newest first, read without looking away for long. */}
      {alerts.length > 0 ? (
        <footer className="shrink-0 border-t border-border bg-surface px-3 py-2">
          <div className="flex items-center gap-3 overflow-x-auto">
            {alerts.slice(0, 4).map((alert) => (
              <span
                key={alert.id}
                className={cn(
                  "flex shrink-0 items-center gap-2 rounded-full px-3 py-1 text-xs",
                  alert.level === "CRITICAL" && "bg-critical-soft text-critical",
                  alert.level === "WARNING" && "bg-warning-soft text-warning",
                  alert.level === "ATTENTION" && "bg-attention-soft text-attention",
                  (alert.level === "NORMAL" || alert.level === "UNKNOWN") &&
                    "bg-unknown-soft text-unknown",
                )}
              >
                <span className="tabular font-mono text-[10px] opacity-70">
                  {formatTime(alert.at)}
                </span>
                {alert.message}
              </span>
            ))}
            {alerts.length > 4 ? (
              <span className="shrink-0 text-xs text-faint-foreground">
                +{alerts.length - 4} more
              </span>
            ) : null}
          </div>
        </footer>
      ) : null}
    </div>
  );
}

function linkWord(link: RfLinkReading | null): string {
  if (link === null) return "n/r";
  if (link.failsafe) return "FAILSAFE";
  if (!link.connected) return "LOST";
  return "OK";
}

function areaWord(level: StatusLevel): string {
  switch (level) {
    case "NORMAL":
      return "Safe";
    case "ATTENTION":
      return "Caution";
    case "WARNING":
      return "Warning";
    case "CRITICAL":
      return "Hazard";
    default:
      return "Unknown";
  }
}

function Vital({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level: StatusLevel;
}) {
  return (
    <div className="text-right">
      <p className="text-[10px] tracking-wide text-faint-foreground uppercase">{label}</p>
      <p
        className={cn(
          "tabular font-mono text-sm font-semibold",
          level === "CRITICAL" && "text-critical",
          level === "WARNING" && "text-warning",
          level === "ATTENTION" && "text-attention",
          level === "NORMAL" && "text-foreground",
          level === "UNKNOWN" && "text-faint-foreground",
        )}
      >
        {value}
      </p>
    </div>
  );
}

function HudTile({
  label,
  value,
  level,
  wide = false,
}: {
  label: string;
  value: string;
  level: StatusLevel;
  wide?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface px-4 py-3",
        wide && "col-span-2",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-[10px] tracking-wide text-faint-foreground uppercase">
          {label}
        </span>
        <StatusBadge level={level} size="sm" />
      </div>
      <p className="mt-1 truncate text-sm text-foreground">{value}</p>
    </div>
  );
}

/** Age helper kept here so the pilot strip can show data freshness if needed. */
export function hudAge(at: number | null): string {
  return formatAge(at, missionNow());
}
