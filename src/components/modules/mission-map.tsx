import { useEffect, useMemo, useState } from "react";
import { MODULE_BY_ID } from "../../config/modules";
import { formatTime } from "../../lib/mission-clock";
import {
  fieldValue,
  moduleAvailability,
  pathLengthM,
  useFieldResolution,
  useFieldValue,
  useMissionPath,
  useModuleAvailability,
  useSummary,
  useTelemetry,
} from "../../lib/telemetry-store";
import { interpretGps, interpretObstacle } from "../../lib/thresholds";
import type {
  GpsReading,
  ImuReading,
  LidarReading,
  MissionEvent,
  Pose,
  StatusLevel,
} from "../../lib/types";
import { IconGps, IconLocate, IconReplay, IconStop } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { ReadingDisplay } from "../layout/reading-display";
import { StatusBadge } from "../layout/status-badge";
import { SourceUnavailable } from "../layout/unavailable";
import { MissionMapCanvas, type MapTheme } from "../map/mission-map-canvas";
import { useTheme } from "../layout/theme-provider";

/**
 * Mission Map. §4.3
 *
 * Live visual representation of where OrionPax has travelled, with markers for
 * people, obstacles and environment events. Replay animates the rover along
 * the recorded path after mission completion.
 */
export function MissionMapModule() {
  const definition = MODULE_BY_ID.get("map")!;
  const { theme } = useTheme();
  const { available, missing, downSources } = useModuleAvailability(definition.fields);

  const path = useMissionPath();
  const poseResolution = useFieldResolution<Pose>("pose");
  const lidar = useFieldResolution<LidarReading | null>("lidar");
  const gps = useFieldResolution<GpsReading>("gps");
  const imu = useFieldValue<ImuReading>("imu");
  const travelled = useTelemetry(pathLengthM);
  const events = useTelemetry((state) => state.events);
  const phase = useTelemetry((state) => state.mission.phase);

  const [selected, setSelected] = useState<MissionEvent | null>(null);
  const [replayIndex, setReplayIndex] = useState<number | null>(null);

  const locatedEvents = useMemo(
    () => events.filter((event) => event.pose !== null),
    [events],
  );

  // Replay: step the rover along the recorded path. §4.3
  useEffect(() => {
    if (replayIndex === null) return;
    if (replayIndex >= path.length) {
      setReplayIndex(null);
      return;
    }
    const timer = setTimeout(() => setReplayIndex((index) => (index ?? 0) + 1), 60);
    return () => clearTimeout(timer);
  }, [replayIndex, path.length]);

  const mapTheme: MapTheme = useMemo(
    () =>
      theme === "dark"
        ? {
            background: "#0f1620",
            grid: "#1f2b3a",
            route: "#60a5fa",
            rover: "#e2e8f0",
            start: "#22c55e",
            text: "#94a3b8",
          }
        : {
            background: "#f6f8fb",
            grid: "#e2e8f0",
            route: "#2563eb",
            rover: "#0f172a",
            start: "#16a34a",
            text: "#64748b",
          },
    [theme],
  );

  if (!available) {
    return (
      <SourceUnavailable
        message={definition.degradedMessage}
        missing={missing}
        sources={downSources}
      />
    );
  }

  const pose = poseResolution.status === "unavailable" ? null : poseResolution.reading.value;
  const stale = poseResolution.status === "stale";

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <Panel className="flex flex-col p-3">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 px-2">
          <div className="flex items-center gap-2">
            <StatusBadge
              level={stale ? "WARNING" : "NORMAL"}
              label={stale ? "Position stale — path frozen" : "Tracking live"}
              size="sm"
            />
            <span className="text-xs text-faint-foreground">
              {path.length} recorded position{path.length === 1 ? "" : "s"}
            </span>
          </div>

          <div className="flex gap-2">
            {replayIndex === null ? (
              <Button
                size="sm"
                variant="surface"
                onClick={() => setReplayIndex(1)}
                disabled={path.length < 2}
                title={
                  phase === "COMPLETE"
                    ? "Replay the recorded mission path"
                    : "Replay works best after mission completion"
                }
              >
                <IconReplay size={16} />
                Replay
              </Button>
            ) : (
              <Button size="sm" variant="surface" onClick={() => setReplayIndex(null)}>
                <IconStop size={16} />
                Stop replay
              </Button>
            )}
          </div>
        </div>

        <div className="flex-1">
          <MissionMapCanvas
            path={path}
            pose={pose}
            events={locatedEvents}
            theme={mapTheme}
            stale={stale}
            replayIndex={replayIndex}
            onPickEvent={setSelected}
          />
        </div>

        <p className="mt-2 px-2 text-[11px] text-faint-foreground">
          Mission frame, metres from the start point. Underground position comes from
          odometry and IMU — GPS alone is not sufficient below ground.
        </p>
      </Panel>

      <div className="space-y-5">
        <Panel className="space-y-4">
          <PanelHeader title="Current location" />
          <div className="flex items-start gap-3">
            <IconLocate size={20} weight="duotone" className="mt-0.5 text-muted-foreground" />
            <div>
              <p className="text-sm text-foreground">
                {pose
                  ? `x ${pose.x.toFixed(1)} m · y ${pose.y.toFixed(1)} m`
                  : "Position unavailable"}
              </p>
              <p className="mt-0.5 text-xs text-faint-foreground">
                {pose ? `Heading ${pose.heading.toFixed(0)}°` : "Motion node not reporting"}
              </p>
            </div>
          </div>

          <div className="border-t border-border pt-2">
            {/*
              Route length, summed from the reported poses. There are no wheel
              encoders on this rover, so there is no odometer to read.
            */}
            <TechnicalDetail label="Route length" value={`${travelled.toFixed(1)} m`} />
            <TechnicalDetail label="Recorded positions" value={String(path.length)} />
            <TechnicalDetail label="Map markers" value={String(locatedEvents.length)} />
            <TechnicalDetail
              label="Tilt (pitch / roll)"
              value={
                imu === null
                  ? "not reported"
                  : `${imu.pitch.toFixed(1)}° / ${imu.roll.toFixed(1)}°`
              }
            />
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Obstacle" hint="TF-Luna LiDAR" />
          <ReadingDisplay<LidarReading | null>
            label="Ahead"
            resolution={lidar}
            interpret={interpretObstacle}
          />
        </Panel>

        {/*
          GPS is the only absolute-position source and it is unusable below
          ground (§4.3). It is shown so the operator can see that plainly,
          rather than wondering whether it was simply left out.
        */}
        <Panel>
          <PanelHeader title="Satellite position" hint="GPS NEO-6M — surface only" />
          <div className="flex items-start gap-3">
            <IconGps size={18} weight="duotone" className="mt-0.5 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <ReadingDisplay<GpsReading> label="Fix" resolution={gps} interpret={interpretGps} />
            </div>
          </div>
          <p className="mt-3 text-[11px] text-faint-foreground">
            Underground the position above comes from the node's own estimate, not from
            satellites.
          </p>
        </Panel>

        <Panel>
          <PanelHeader
            title={selected ? "Selected event" : "Map events"}
            hint={selected ? undefined : "Click a marker to open its details."}
            action={
              selected ? (
                <Button size="sm" variant="ghost" onClick={() => setSelected(null)}>
                  Clear
                </Button>
              ) : undefined
            }
          />

          {selected ? (
            <div className="rounded-xl border border-border bg-surface-raised p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-sm text-foreground">{selected.message}</p>
                <StatusBadge level={selected.level} size="sm" />
              </div>
              <div className="mt-3 border-t border-border pt-2">
                <TechnicalDetail label="Time" value={formatTime(selected.at)} />
                <TechnicalDetail label="Source" value={selected.sourceId ?? "dashboard"} />
                <TechnicalDetail
                  label="Location"
                  value={
                    selected.pose
                      ? `x ${selected.pose.x.toFixed(1)} · y ${selected.pose.y.toFixed(1)}`
                      : "—"
                  }
                />
              </div>
            </div>
          ) : (
            <ul className="max-h-64 space-y-1.5 overflow-y-auto">
              {locatedEvents
                .slice()
                .reverse()
                .slice(0, 20)
                .map((event) => (
                  <li key={event.id}>
                    <button
                      type="button"
                      onClick={() => setSelected(event)}
                      className="flex w-full items-start justify-between gap-2 rounded-lg px-2 py-1.5 text-left transition-state hover:bg-surface-raised"
                    >
                      <span className="min-w-0 text-xs text-muted-foreground">
                        <span className="tabular font-mono text-faint-foreground">
                          {formatTime(event.at)}
                        </span>{" "}
                        {event.message}
                      </span>
                      <StatusBadge level={event.level} size="sm" />
                    </button>
                  </li>
                ))}
              {locatedEvents.length === 0 ? (
                <li className="px-2 py-4 text-center text-xs text-faint-foreground">
                  No located events yet.
                </li>
              ) : null}
            </ul>
          )}
        </Panel>
      </div>
    </div>
  );
}

export function useMapSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const { available } = moduleAvailability(state, ["pose", "lidar"]);
    if (!available) return { status: "UNKNOWN", summary: "No position or obstacle data" };

    const pose = fieldValue<Pose>(state, "pose");
    const lidar = fieldValue<LidarReading | null>(state, "lidar");
    const obstacle = interpretObstacle(lidar ?? null);

    if (obstacle.level !== "NORMAL" && obstacle.level !== "UNKNOWN") {
      return { status: obstacle.level, summary: obstacle.message };
    }
    return {
      status: "NORMAL",
      summary: pose
        ? `Tracking — x ${pose.x.toFixed(1)} m, y ${pose.y.toFixed(1)} m`
        : "No position reported",
    };
  });
}
