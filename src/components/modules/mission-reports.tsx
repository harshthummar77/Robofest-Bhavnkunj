import { useMemo } from "react";
import toast from "react-hot-toast";
import { activeNodes } from "../../config/nodes";
import {
  formatDateTime,
  formatDuration,
  formatTime,
  missionNow,
} from "../../lib/mission-clock";
import {
  personList,
  usePersonList,
  useSourceHealthList,
  useSummary,
  useTelemetry,
} from "../../lib/telemetry-store";
import type { MissionEvent, StatusLevel } from "../../lib/types";
import { IconDocument } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { StatusBadge } from "../layout/status-badge";

/**
 * Mission Reports. §4.8
 *
 * Preserves the complete story of a mission. Unaffected by a source going
 * offline, and the report notes any gap in coverage with its time window.
 * §12.1 consequences table + rule 12 (every event records its origin source).
 */
export function MissionReportsModule() {
  const mission = useTelemetry((state) => state.mission);
  const events = useTelemetry((state) => state.events);
  const persons = usePersonList();
  const health = useSourceHealthList();

  const duration =
    mission.startedAt === null
      ? null
      : (mission.endedAt ?? missionNow()) - mission.startedAt;

  const findings = useMemo(
    () => ({
      people: persons.length,
      thermalConfirmed: persons.filter((person) => person.thermalConfirmed).length,
      hazards: events.filter(
        (event) => event.kind === "ENVIRONMENT_WARNING" || event.level === "CRITICAL",
      ).length,
      coverageGaps: events.filter((event) => event.kind === "SOURCE_LOST"),
    }),
    [events, persons],
  );

  function generateReport() {
    const report = buildReportText({ mission, events, persons, duration, findings });
    const blob = new Blob([report], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${mission.name.replace(/\s+/g, "_")}_report.txt`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success("Mission report generated");
  }

  return (
    <div className="space-y-5">
      <Panel className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs tracking-wide text-faint-foreground uppercase">
            Current mission
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">{mission.name}</p>
          <p className="mt-1 font-mono text-xs text-faint-foreground">{mission.id}</p>
        </div>
        <div className="text-right">
          <Button variant="primary" onClick={generateReport}>
            <IconDocument size={16} />
            Generate report
          </Button>
          <p className="mt-2 text-[11px] text-faint-foreground">
            Combines route, detections, environment and rover health.
          </p>
        </div>
      </Panel>

      <div className="grid gap-5 lg:grid-cols-4">
        <SummaryTile
          label="Duration"
          value={duration === null ? "Not started" : formatDuration(duration)}
          hint={mission.startedAt ? formatDateTime(mission.startedAt) : undefined}
        />
        <SummaryTile
          label="People detected"
          value={String(findings.people)}
          hint={`${findings.thermalConfirmed} thermally confirmed`}
        />
        <SummaryTile
          label="Events recorded"
          value={String(events.length)}
          hint={`${findings.hazards} critical`}
        />
        <SummaryTile
          label="Coverage gaps"
          value={String(findings.coverageGaps.length)}
          hint={
            findings.coverageGaps.length === 0
              ? "No source loss recorded"
              : "Source loss during mission"
          }
        />
      </div>

      <div className="grid gap-5 lg:grid-cols-[1fr_22rem]">
        <Panel>
          <PanelHeader
            title="Mission timeline"
            hint="Ordered by the mission clock, with the reporting source on each entry."
          />

          <ol className="max-h-[32rem] space-y-2 overflow-y-auto">
            {events
              .slice()
              .reverse()
              .map((event) => (
                <li
                  key={event.id}
                  className="flex items-start gap-3 rounded-xl border border-border bg-surface-raised p-3"
                >
                  <span className="tabular shrink-0 pt-0.5 font-mono text-[11px] text-faint-foreground">
                    {formatTime(event.at)}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-foreground">{event.message}</p>
                    <p className="mt-0.5 text-[11px] text-faint-foreground">
                      {event.kind.replace(/_/g, " ").toLowerCase()}
                      {event.sourceId ? ` · ${event.sourceId}` : " · dashboard"}
                      {event.pose
                        ? ` · x ${event.pose.x.toFixed(1)} m, y ${event.pose.y.toFixed(1)} m`
                        : ""}
                    </p>
                  </div>
                  <StatusBadge level={event.level} size="sm" />
                </li>
              ))}

            {events.length === 0 ? (
              <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center text-sm text-muted-foreground">
                No events recorded yet. Start a mission to begin the timeline.
              </li>
            ) : null}
          </ol>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader title="Mission assessment" hint="Plain-language summary." />
            <p className="text-sm leading-relaxed text-foreground">
              {buildAssessment(findings, mission.phase)}
            </p>
          </Panel>

          <Panel>
            <PanelHeader title="Data coverage" hint="Which sources contributed." />
            {health.map((source) => (
              <TechnicalDetail
                key={source.id}
                label={source.label}
                value={source.lastUpdateAt === null ? "no data" : source.state.toLowerCase()}
              />
            ))}
          </Panel>

          {findings.coverageGaps.length > 0 ? (
            <Panel className="border-warning/30">
              <PanelHeader
                title="Coverage gaps"
                hint="Periods where a source stopped reporting."
              />
              <ul className="space-y-1.5">
                {findings.coverageGaps.map((event) => (
                  <li key={event.id} className="text-xs text-muted-foreground">
                    {formatTime(event.at)} — {event.message}
                  </li>
                ))}
              </ul>
            </Panel>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryTile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Panel>
      <p className="text-[11px] tracking-wide text-faint-foreground uppercase">{label}</p>
      <p className="tabular mt-1 text-2xl font-semibold text-foreground">{value}</p>
      {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
    </Panel>
  );
}

interface Findings {
  people: number;
  thermalConfirmed: number;
  hazards: number;
  coverageGaps: MissionEvent[];
}

function buildAssessment(findings: Findings, phase: string): string {
  const parts: string[] = [];

  parts.push(
    findings.people === 0
      ? "No people were detected during this mission."
      : `${findings.people} person record${findings.people === 1 ? "" : "s"} were created, of which ${findings.thermalConfirmed} were confirmed by thermal imaging.`,
  );

  if (findings.hazards > 0) {
    parts.push(`${findings.hazards} condition(s) required immediate operator attention.`);
  } else {
    parts.push("No conditions required immediate operator attention.");
  }

  if (findings.coverageGaps.length > 0) {
    parts.push(
      `Data coverage was incomplete: ${findings.coverageGaps.length} source interruption(s) occurred, so findings during those windows may be partial.`,
    );
  }

  parts.push(
    phase === "COMPLETE"
      ? "The mission is complete and the route has been finalized."
      : "The mission is still in progress; this assessment is provisional.",
  );

  return parts.join(" ");
}

function buildReportText({
  mission,
  events,
  persons,
  duration,
  findings,
}: {
  mission: { id: string; name: string; phase: string; startedAt: number | null; endedAt: number | null };
  events: MissionEvent[];
  persons: ReturnType<typeof personList>;
  duration: number | null;
  findings: Findings;
}): string {
  const lines: string[] = [
    "ORIONPAX — MISSION REPORT",
    "Rescue Intelligence & Exploration System",
    "",
    `Mission name: ${mission.name}`,
    `Mission ID:   ${mission.id}`,
    `Phase:        ${mission.phase}`,
    `Started:      ${mission.startedAt ? formatDateTime(mission.startedAt) : "—"}`,
    `Ended:        ${mission.endedAt ? formatDateTime(mission.endedAt) : "—"}`,
    `Duration:     ${duration === null ? "—" : formatDuration(duration)}`,
    "",
    "ASSESSMENT",
    buildAssessment(findings, mission.phase),
    "",
    "PERSONNEL",
  ];

  if (persons.length === 0) {
    lines.push("  No people detected.");
  } else {
    for (const person of persons) {
      lines.push(
        `  ${person.personId} — ${person.status}`,
        `    first detected: ${formatDateTime(person.firstDetectedAt)}`,
        `    last seen:      ${formatDateTime(person.lastSeenAt)}`,
        `    location:       ${
          person.lastKnownPose
            ? `x ${person.lastKnownPose.x.toFixed(2)} m, y ${person.lastKnownPose.y.toFixed(2)} m`
            : "not resolved"
        }`,
        `    confirmation:   RGB ${person.rgbConfirmed ? "yes" : "no"} / thermal ${person.thermalConfirmed ? "yes" : "no"}`,
      );
    }
  }

  lines.push("", "TIMELINE");
  for (const event of events) {
    lines.push(
      `  ${formatDateTime(event.at)}  [${event.level}]  ${event.message}  (source: ${event.sourceId ?? "dashboard"})`,
    );
  }

  lines.push("", "DATA SOURCES");
  for (const node of activeNodes()) {
    lines.push(`  ${node.label} — ${node.baseUrl} (${node.transport})`);
  }

  return lines.join("\n");
}

export function useReportsSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const count = state.events.length;
    if (count === 0) return { status: "NORMAL", summary: "No events recorded yet" };
    return {
      status: "NORMAL",
      summary: `${count} event${count === 1 ? "" : "s"} recorded · ${Object.keys(state.persons).length} person record(s)`,
    };
  });
}
