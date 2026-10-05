import { useState } from "react";
import toast from "react-hot-toast";
import { MODULE_BY_ID } from "../../config/modules";
import { sendCommand, type CommandAck } from "../../lib/control";
import {
  fieldValue,
  moduleAvailability,
  useFieldResolution,
  useFieldValue,
  useModuleAvailability,
  useSummary,
  useTelemetry,
} from "../../lib/telemetry-store";
import { interpretRfLink, worst } from "../../lib/thresholds";
import type { DriveReading, RfChannels, RfLinkReading, StatusLevel } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconControl, IconSpeed, IconConnected, IconRadio } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { ReadingDisplay } from "../layout/reading-display";
import { StatusBadge } from "../layout/status-badge";
import { SourceUnavailable } from "../layout/unavailable";

/**
 * Drive Status (was Rover Control). §4.7
 *
 * The rover is driven by the FlySky FS-i6 transmitter, held by the same person
 * watching this dashboard. The dashboard is therefore **read-only with respect
 * to the motors**: it mirrors what the rover is doing and reports whether the
 * transmitter link is alive, but it commands no movement and offers no
 * emergency stop.
 *
 * Stopping is a hardware function — an FS-i6 switch bound to a stop channel,
 * and an ESP32 failsafe on iBUS loss. A stop button on a screen, for a pilot
 * with both hands on the sticks, would read as safety without being it.
 *
 * Mission commands remain here: they record the mission, they do not move it.
 */
export function DriveStatusModule() {
  const definition = MODULE_BY_ID.get("control")!;
  const { available, missing, downSources } = useModuleAvailability(definition.fields);

  const drive = useFieldValue<DriveReading>("drive");
  const rfLink = useFieldResolution<RfLinkReading>("rfLink");
  const channels = useFieldValue<RfChannels>("rfChannels");
  const heading = useFieldValue<number>("heading");

  const mission = useTelemetry((state) => state.mission);
  const startMission = useTelemetry((state) => state.startMission);
  const completeMission = useTelemetry((state) => state.completeMission);

  const [lastAck, setLastAck] = useState<CommandAck | null>(null);

  async function issue(command: Parameters<typeof sendCommand>[0], label: string) {
    const ack = await sendCommand(command);
    setLastAck(ack);
    if (ack.accepted) toast.success(`${label} — acknowledged`);
    else toast.error(`${label}: ${ack.message}`);
  }

  // motorsOk is optional: only firmware that actually checks the drivers
  // reports it, and an unchecked driver is not the same as a healthy one.
  const driveLevel: StatusLevel =
    drive === null ? "UNKNOWN" : drive.motorsOk === false ? "WARNING" : "NORMAL";

  return (
    <div className="space-y-5">
      {/*
        Control authority is stated plainly at the top. The operator should
        never be unsure which device is driving the rover.
      */}
      <Panel className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <IconControl size={26} weight="duotone" className="mt-0.5 text-primary" />
          <div>
            <p className="text-sm font-semibold text-foreground">
              Driven by FlySky FS-i6 transmitter
            </p>
            <p className="mt-0.5 max-w-xl text-xs text-muted-foreground">
              The transmitter is the only drive authority. This view mirrors what the
              rover is doing — it sends no movement commands. Stop the rover with the
              transmitter switch; the rover also fails safe if the signal is lost.
            </p>
          </div>
        </div>
        <StatusBadge level={driveLevel} />
      </Panel>

      {!available ? (
        <SourceUnavailable
          message={definition.degradedMessage}
          missing={missing}
          sources={downSources}
          compact
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
          <Panel>
            <PanelHeader
              title="What the rover is doing"
              hint="Mirrored from the motion node, not commanded from here."
            />

            <div className="grid gap-3 sm:grid-cols-2">
              <StatusTile
                label="Motion"
                value={
                  drive === null
                    ? "Drive status unavailable"
                    : drive.moving
                      ? `Moving${drive.direction && drive.direction !== "stopped" ? ` ${drive.direction}` : ""}`
                      : "Stationary"
                }
                level={drive === null ? "UNKNOWN" : "NORMAL"}
              />
              <StatusTile
                label="Motors"
                value={
                  drive === null
                    ? "Unknown"
                    : drive.motorsOk === false
                      ? "Fault reported"
                      : drive.motorsOk === true
                        ? "No fault reported"
                        : "Not monitored by the node"
                }
                level={driveLevel}
              />
            </div>

            {/* Speed as a read-out, not a control. */}
            <div className="mt-5 rounded-xl border border-border bg-surface-raised p-4">
              <div className="mb-2 flex items-center justify-between">
                <span className="flex items-center gap-2 text-xs tracking-wide text-faint-foreground uppercase">
                  <IconSpeed size={16} />
                  Applied speed
                </span>
                <span className="tabular font-mono text-sm text-foreground">
                  {drive === null ? "—" : `${(drive.speed * 100).toFixed(0)}%`}
                </span>
              </div>
              <div className="h-1.5 w-full overflow-hidden rounded-full bg-border">
                <div
                  className="h-full rounded-full bg-primary transition-state"
                  style={{ width: `${(drive?.speed ?? 0) * 100}%` }}
                />
              </div>
              <p className="mt-2 text-[11px] text-faint-foreground">
                Set by the transmitter's throttle channel.
              </p>
            </div>

            <div className="mt-4 border-t border-border pt-3">
              <TechnicalDetail
                label="Heading"
                value={heading === null ? "not reported" : `${heading.toFixed(1)}°`}
              />
              <TechnicalDetail
                label="Applied duty"
                value={drive === null ? "not reported" : `${(drive.speed * 100).toFixed(1)} %`}
              />
              <TechnicalDetail label="Direction" value={drive?.direction ?? "not reported"} />
            </div>
          </Panel>

          <div className="space-y-5">
            {/*
              Transmitter link. Without this the pilot's first symptom of signal
              loss is the rover not responding.
            */}
            <Panel>
              <PanelHeader title="Transmitter link" hint="FlySky FS-i6 via iBUS" />
              <ReadingDisplay<RfLinkReading>
                label="Signal"
                resolution={rfLink}
                interpret={interpretRfLink}
              />
              {rfLink.status === "unavailable" ? (
                <p className="mt-3 rounded-lg border border-dashed border-border px-3 py-2 text-[11px] text-faint-foreground">
                  No node is reporting FS-i6 link state yet. Publish an
                  <span className="font-mono"> ibus </span>
                  object carrying
                  <span className="font-mono"> connected </span>,
                  <span className="font-mono"> failsafe </span>
                  and
                  <span className="font-mono"> lastPacketAgeMs </span>
                  from the ESP32 that reads iBUS, and this fills in — no dashboard change needed.
                </p>
              ) : null}
              <p className="mt-3 text-[11px] text-faint-foreground">
                No signal-strength reading: the FS-iA6B receiver does not publish RSSI in its iBUS
                servo frames, so frame age is the only measure of link health there is.
              </p>
            </Panel>

            {/*
              Raw stick positions, arriving back from the rover. This is the one
              way to tell "the rover is not moving" apart from "the rover is not
              being told to move".
            */}
            <Panel>
              <PanelHeader title="Transmitter channels" hint="iBUS, 1000-2000 us" />
              {channels === null ? (
                <p className="text-xs text-muted-foreground">
                  Channel values not reported by any node.
                </p>
              ) : (
                <div className="space-y-2">
                  {channels.map((value, index) => (
                    <div key={index} className="flex items-center gap-2">
                      <IconRadio size={13} className="shrink-0 text-faint-foreground" />
                      <span className="w-8 shrink-0 font-mono text-[11px] text-faint-foreground">
                        CH{index + 1}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full bg-primary/70 transition-state"
                          style={{
                            width: `${Math.min(100, Math.max(0, ((value - 1000) / 1000) * 100))}%`,
                          }}
                        />
                      </div>
                      <span className="tabular w-12 shrink-0 text-right font-mono text-[11px] text-muted-foreground">
                        {value.toFixed(0)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </Panel>

            <Panel>
              <PanelHeader title="Mission commands" hint="Recording only — no motor effect." />
              <div className="space-y-2">
                <Button
                  variant="primary"
                  className="w-full"
                  disabled={mission.phase !== "READY" && mission.phase !== "COMPLETE"}
                  onClick={() => {
                    startMission();
                    void issue({ kind: "mission", action: "start" }, "Mission start");
                  }}
                >
                  Start mission
                </Button>
                <Button
                  variant="surface"
                  className="w-full"
                  disabled={mission.phase === "READY" || mission.phase === "COMPLETE"}
                  onClick={() => {
                    completeMission();
                    void issue({ kind: "mission", action: "complete" }, "Mission complete");
                  }}
                >
                  Complete mission
                </Button>
              </div>

              {lastAck ? (
                <div className="mt-4 border-t border-border pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-xs text-muted-foreground">{lastAck.message}</p>
                    <StatusBadge
                      level={lastAck.accepted ? "NORMAL" : "CRITICAL"}
                      label={lastAck.accepted ? "Accepted" : "Refused"}
                      size="sm"
                    />
                  </div>
                  <TechnicalDetail label="Round trip" value={`${lastAck.latencyMs} ms`} />
                </div>
              ) : null}
            </Panel>

            <Panel className="border-border/60">
              <PanelHeader title="How to stop the rover" />
              <ol className="space-y-2 text-xs text-muted-foreground">
                <li className="flex gap-2">
                  <span className="font-mono text-faint-foreground">1.</span>
                  Release the sticks, or use the FS-i6 switch bound to the stop channel.
                </li>
                <li className="flex gap-2">
                  <span className="font-mono text-faint-foreground">2.</span>
                  If the transmitter link is lost, the rover fails safe on its own.
                </li>
              </ol>
              <p className="mt-3 flex items-center gap-1.5 text-[11px] text-faint-foreground">
                <IconConnected size={14} />
                The dashboard deliberately sends no motor commands.
              </p>
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

function StatusTile({
  label,
  value,
  level,
}: {
  label: string;
  value: string;
  level: StatusLevel;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] tracking-wide text-faint-foreground uppercase">
          {label}
        </span>
        <StatusBadge level={level} size="sm" />
      </div>
      <p className={cn("mt-1.5 text-sm text-foreground")}>{value}</p>
    </div>
  );
}

export function useDriveStatusSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const { available } = moduleAvailability(state, ["drive", "rfLink"]);
    if (!available) return { status: "UNKNOWN", summary: "No drive telemetry reported" };

    const rfLink = fieldValue<RfLinkReading>(state, "rfLink");
    const drive = fieldValue<DriveReading>(state, "drive");
    const link = interpretRfLink(rfLink);

    // A lost transmitter link outranks anything the drive itself reports.
    if (link.level === "CRITICAL" || link.level === "WARNING") {
      return { status: link.level, summary: link.message };
    }
    if (!drive) return { status: "UNKNOWN", summary: "Drive status unavailable" };
    if (drive.motorsOk === false) {
      return { status: "WARNING", summary: "Motor fault reported" };
    }

    const level = worst(link.level === "UNKNOWN" ? "NORMAL" : link.level, "NORMAL");
    return {
      level,
      status: level,
      summary: drive.moving
        ? `Moving at ${(drive.speed * 100).toFixed(0)}% — driven by transmitter`
        : "Stationary — driven by transmitter",
    } as { status: StatusLevel; summary: string };
  });
}
