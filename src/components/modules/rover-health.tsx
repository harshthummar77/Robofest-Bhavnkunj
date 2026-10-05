import { allOffsets, formatAge } from "../../lib/mission-clock";
import {
  overallCommsState,
  useFieldValue,
  useSourceHealthList,
  useTelemetry,
} from "../../lib/telemetry-store";
import { interpretBattery, interpretCpuTemp, worst } from "../../lib/thresholds";
import type { BatteryReading, DriveReading, HealthLevel, StatusLevel } from "../../lib/types";
import { IconAi, IconBattery, IconSource, IconThermal } from "../icons";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { SourceErrorLine, SourceHealthRow } from "../layout/source-health-row";
import { SOURCE_STATE_LEVEL, StatusBadge } from "../layout/status-badge";

/**
 * Rover Health. §4.6
 *
 * This module never degrades — it exists precisely to show which source is
 * down (§12.1 consequences table), so it is the one place where per-source
 * technical detail belongs.
 */

const HEALTH_LABEL: Record<HealthLevel, string> = {
  HEALTHY: "Healthy",
  ATTENTION_REQUIRED: "Attention Required",
  WARNING: "Warning",
  CRITICAL: "Critical",
  UNKNOWN: "Unknown",
};

const TO_HEALTH: Record<StatusLevel, HealthLevel> = {
  NORMAL: "HEALTHY",
  ATTENTION: "ATTENTION_REQUIRED",
  WARNING: "WARNING",
  CRITICAL: "CRITICAL",
  UNKNOWN: "UNKNOWN",
};

export function RoverHealthModule() {
  const health = useSourceHealthList();
  const comms = useTelemetry(overallCommsState);
  const battery = useFieldValue<BatteryReading>("battery");
  const drive = useFieldValue<DriveReading>("drive");
  const aiStatus = useFieldValue<string>("aiStatus");
  const cpuTemp = useFieldValue<number>("cpuTemp");

  const batteryInterpretation = interpretBattery(battery);
  const cpuInterpretation = interpretCpuTemp(cpuTemp);
  const commsLevel = SOURCE_STATE_LEVEL[comms];
  const driveLevel: StatusLevel =
    drive === null ? "UNKNOWN" : drive.motorsOk === false ? "WARNING" : "NORMAL";
  const aiLevel: StatusLevel =
    aiStatus === null ? "UNKNOWN" : aiStatus === "ONLINE" ? "NORMAL" : "WARNING";

  // An unknown subsystem must not be absorbed by a healthy one, so UNKNOWN
  // outranks ATTENTION in `worst`. §12.1 rule 10.
  const rollUp = worst(
    batteryInterpretation.level,
    commsLevel,
    driveLevel,
    aiLevel,
    cpuTemp === null ? "NORMAL" : cpuInterpretation.level,
  );
  const overall = TO_HEALTH[rollUp];
  const offsets = allOffsets();

  return (
    <div className="space-y-5">
      {/* Overall state first, human-readable. Technical detail is below. */}
      <Panel className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs tracking-wide text-faint-foreground uppercase">
            Overall rover state
          </p>
          <p className="mt-1 text-2xl font-semibold text-foreground">
            {HEALTH_LABEL[overall]}
          </p>
        </div>
        <StatusBadge level={rollUp} label={HEALTH_LABEL[overall]} />
      </Panel>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel>
          <PanelHeader title="Subsystems" hint="Plain state first; exact values below." />

          <div className="space-y-3">
            <SubsystemRow
              icon={<IconBattery size={18} weight="duotone" />}
              label="Battery"
              message={batteryInterpretation.message}
              level={batteryInterpretation.level}
            />
            <SubsystemRow
              icon={<IconSource size={18} weight="duotone" />}
              label="Drive system"
              message={
                drive === null
                  ? "Drive status unavailable"
                  : drive.motorsOk === false
                    ? "Motor fault reported"
                    : drive.moving
                      ? `Driving at ${(drive.speed * 100).toFixed(0)}% duty`
                      : "Stationary"
              }
              level={driveLevel}
            />
            <SubsystemRow
              icon={<IconAi size={18} weight="duotone" />}
              label="AI processing"
              message={
                aiStatus === null
                  ? "AI status unavailable"
                  : aiStatus === "ONLINE"
                    ? "Detection running on the AI accelerator"
                    : "AI processing offline — no detections"
              }
              level={aiLevel}
            />
            <SubsystemRow
              icon={<IconThermal size={18} weight="duotone" />}
              label="Processor"
              message={cpuInterpretation.message}
              level={cpuTemp === null ? "UNKNOWN" : cpuInterpretation.level}
            />
            <SubsystemRow
              icon={<IconSource size={18} weight="duotone" />}
              label="Communications"
              message={
                comms === "ONLINE"
                  ? "All required nodes reporting"
                  : `${health.filter((entry) => entry.state === "OFFLINE").length} node(s) not reporting`
              }
              level={commsLevel}
            />
          </div>

          <div className="mt-5 border-t border-border pt-3">
            <TechnicalDetail label="Battery pack" value={batteryInterpretation.exact} />
            <TechnicalDetail
              label="Applied duty"
              value={drive ? `${(drive.speed * 100).toFixed(0)} %` : "not reported"}
            />
            <TechnicalDetail label="Processor temperature" value={cpuInterpretation.exact} />
            <TechnicalDetail
              label="Nodes reporting"
              value={`${health.filter((entry) => entry.state !== "OFFLINE").length} of ${health.length}`}
            />
            <p className="mt-2 text-[11px] text-faint-foreground">
              Charge is read from pack voltage; this rover carries no fuel gauge, so there is no
              runtime estimate.
            </p>
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="Data sources"
            hint="One row per node: host, state, last update, and what it supplies."
          />

          <div className="space-y-2">
            {health.map((source) => (
              <SourceHealthRow key={source.id} source={source} />
            ))}
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1 px-4 text-[11px] tracking-wide text-faint-foreground uppercase">
              Transport detail
            </p>
            {health.map((source) => (
              <SourceErrorLine key={source.id} source={source} />
            ))}
            {/* Clock offset per source: how far each node drifts from the
                mission clock. §12.1 rule 9. */}
            {Object.entries(offsets).map(([id, offset]) => (
              <TechnicalDetail
                key={id}
                label={`${id} clock offset`}
                value={`${offset >= 0 ? "+" : ""}${offset.toFixed(0)} ms`}
              />
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}

function SubsystemRow({
  icon,
  label,
  message,
  level,
}: {
  icon: React.ReactNode;
  label: string;
  message: string;
  level: StatusLevel;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-surface-raised px-4 py-3">
      <span className="text-muted-foreground">{icon}</span>
      <div className="min-w-0 flex-1">
        <p className="text-[11px] tracking-wide text-faint-foreground uppercase">{label}</p>
        <p className="truncate text-sm text-foreground">{message}</p>
      </div>
      <StatusBadge level={level} size="sm" />
    </div>
  );
}

/** One-line summary for the home card. */
export function useRoverHealthSummary(): { status: StatusLevel; summary: string } {
  const comms = useTelemetry(overallCommsState);
  const battery = useFieldValue<BatteryReading>("battery");
  const health = useSourceHealthList();

  const batteryInterpretation = interpretBattery(battery);
  const status = worst(batteryInterpretation.level, SOURCE_STATE_LEVEL[comms]);
  const down = health.filter((entry) => entry.state === "OFFLINE");

  if (down.length > 0) {
    return {
      status,
      summary: `${down.length} node${down.length === 1 ? "" : "s"} unreachable — ${down[0].label} last data ${formatAge(down[0].lastUpdateAt)}`,
    };
  }
  return { status, summary: batteryInterpretation.message };
}
