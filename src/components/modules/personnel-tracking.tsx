import { useState } from "react";
import { formatDateTime, formatTime } from "../../lib/mission-clock";
import { usePersonList, useSummary } from "../../lib/telemetry-store";
import { useFocusedPersonId, useViewFocus } from "../../lib/view-focus";
import type { ModuleId, PersonRecord, PersonStatus, StatusLevel } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconLocate, IconPersonnel } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { StatusBadge } from "../layout/status-badge";

/**
 * Personnel Tracking. §4.5
 *
 * The mission record of people detected. Records survive their source going
 * offline — existing records remain, new detections stop, and statuses age
 * into LAST SEEN. §12.1 consequences table.
 */

const STATUS_LABEL: Record<PersonStatus, string> = {
  DETECTED: "Detected",
  TRACKING: "Tracking",
  RECONFIRMED: "Reconfirmed",
  LAST_SEEN: "Last seen",
};

const STATUS_LEVEL: Record<PersonStatus, StatusLevel> = {
  DETECTED: "CRITICAL",
  TRACKING: "CRITICAL",
  RECONFIRMED: "CRITICAL",
  LAST_SEEN: "WARNING",
};

export function PersonnelTrackingModule({
  onOpenModule,
}: {
  onOpenModule(id: ModuleId, personId?: string): void;
}) {
  const persons = usePersonList();
  const focusedId = useFocusedPersonId();
  const focusPerson = useViewFocus((state) => state.focusPerson);
  const [ownSelection, setOwnSelection] = useState<string | null>(null);

  // Arriving here about a particular person — from the palette, or from a
  // detection in Vision — opens on them. §4.5
  const selectedId = ownSelection ?? focusedId;
  const selected = persons.find((person) => person.personId === selectedId) ?? null;

  function select(personId: string): void {
    setOwnSelection(personId);
    // Selecting here also sets what the Map highlights, so the two views agree.
    focusPerson(personId);
  }

  return (
    <div className="grid gap-5 xl:grid-cols-[24rem_1fr]">
      <Panel>
        <PanelHeader
          title="Detected people"
          hint={
            persons.length === 0
              ? "No people detected in this mission yet."
              : `${persons.length} person record${persons.length === 1 ? "" : "s"}`
          }
        />

        <ul className="space-y-2">
          {persons.map((person) => (
            <li key={person.personId}>
              <button
                type="button"
                onClick={() => select(person.personId)}
                className={cn(
                  "w-full rounded-xl border p-3 text-left transition-state",
                  person.personId === selectedId
                    ? "border-primary/50 bg-primary/5"
                    : "border-border bg-surface-raised hover:border-border-strong",
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-mono text-sm font-semibold text-foreground">
                    {person.personId}
                  </span>
                  <StatusBadge
                    level={STATUS_LEVEL[person.status]}
                    label={STATUS_LABEL[person.status]}
                    size="sm"
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {person.lastKnownPose
                    ? `x ${person.lastKnownPose.x.toFixed(1)} m · y ${person.lastKnownPose.y.toFixed(1)} m`
                    : "Location not yet resolved"}
                </p>
                <p className="mt-0.5 text-[11px] text-faint-foreground">
                  Last seen {formatTime(person.lastSeenAt)}
                  {person.thermalConfirmed ? " · thermal confirmed" : ""}
                </p>
              </button>
            </li>
          ))}

          {persons.length === 0 ? (
            <li className="rounded-xl border border-dashed border-border px-4 py-10 text-center">
              <IconPersonnel
                size={28}
                weight="duotone"
                className="mx-auto mb-2 text-faint-foreground"
              />
              <p className="text-sm text-muted-foreground">No detections recorded.</p>
              <p className="mt-1 text-xs text-faint-foreground">
                People appear here as soon as vision or thermal detects them.
              </p>
            </li>
          ) : null}
        </ul>
      </Panel>

      <div className="space-y-5">
        {selected ? (
          <PersonDetail person={selected} onOpenModule={onOpenModule} />
        ) : (
          <Panel className="flex min-h-64 flex-col items-center justify-center text-center">
            <IconPersonnel size={30} weight="duotone" className="mb-3 text-faint-foreground" />
            <p className="text-sm text-muted-foreground">
              Select a person to see their detection history.
            </p>
            <p className="mt-1 text-xs text-faint-foreground">
              Each record carries time, location and which source reported it.
            </p>
          </Panel>
        )}
      </div>
    </div>
  );
}

function PersonDetail({
  person,
  onOpenModule,
}: {
  person: PersonRecord;
  onOpenModule(id: ModuleId, personId?: string): void;
}) {
  return (
    <>
      <Panel>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="font-mono text-xl font-semibold text-foreground">
              {person.personId}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {person.thermalConfirmed
                ? "Confirmed by both RGB and thermal"
                : "RGB detection only — no thermal confirmation"}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge
              level={STATUS_LEVEL[person.status]}
              label={STATUS_LABEL[person.status]}
            />
            <Button
              size="sm"
              variant="surface"
              disabled={person.lastKnownPose === null}
              title={
                person.lastKnownPose === null
                  ? "No position was recorded for this detection — no node was reporting pose at the time"
                  : "Highlight this person on the mission map"
              }
              onClick={() => onOpenModule("map", person.personId)}
            >
              <IconLocate size={16} />
              Show on map
            </Button>
          </div>
        </div>

        <div className="mt-4 grid gap-4 border-t border-border pt-3 sm:grid-cols-2">
          <div>
            <TechnicalDetail
              label="First detected"
              value={formatDateTime(person.firstDetectedAt)}
            />
            <TechnicalDetail label="Last seen" value={formatDateTime(person.lastSeenAt)} />
            <TechnicalDetail
              label="Best confidence"
              value={`${(person.bestConfidence * 100).toFixed(0)} %`}
            />
          </div>
          <div>
            <TechnicalDetail
              label="RGB confirmation"
              value={person.rgbConfirmed ? "yes" : "no"}
            />
            <TechnicalDetail
              label="Thermal confirmation"
              value={person.thermalConfirmed ? "yes" : "no"}
            />
            <TechnicalDetail
              label="Last known location"
              value={
                person.lastKnownPose
                  ? `x ${person.lastKnownPose.x.toFixed(2)} m · y ${person.lastKnownPose.y.toFixed(2)} m`
                  : "—"
              }
            />
          </div>
        </div>
      </Panel>

      <Panel>
        <PanelHeader
          title="Detection history"
          hint="Every entry carries time, location and the host that reported it."
        />

        <ol className="relative space-y-3 border-l border-border pl-4">
          {person.history
            .slice()
            .reverse()
            .map((entry, index) => (
              <li key={`${entry.at}-${index}`} className="relative">
                <span
                  className={cn(
                    "absolute -left-[21px] top-1.5 size-2.5 rounded-full border-2 border-surface",
                    entry.sensor === "thermal" ? "bg-warning" : "bg-critical",
                  )}
                />
                <p className="text-sm text-foreground">
                  {entry.sensor === "thermal"
                    ? `Thermal confirmation${entry.celsius ? ` — ${entry.celsius.toFixed(1)}°C` : ""}`
                    : `RGB detection — ${(entry.confidence * 100).toFixed(0)}% confidence`}
                </p>
                <p className="mt-0.5 text-[11px] text-faint-foreground">
                  {formatTime(entry.at)} · {entry.sourceId}
                  {entry.pose
                    ? ` · x ${entry.pose.x.toFixed(1)} m, y ${entry.pose.y.toFixed(1)} m`
                    : " · location not resolved"}
                </p>
              </li>
            ))}
        </ol>
      </Panel>
    </>
  );
}

export function usePersonnelSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const persons = Object.values(state.persons);
    if (persons.length === 0) {
      return { status: "NORMAL", summary: "No people detected yet" };
    }
    const active = persons.filter((person) => person.status !== "LAST_SEEN");
    if (active.length > 0) {
      return {
        status: "CRITICAL",
        summary: `${active.length} person${active.length === 1 ? "" : "s"} currently tracked`,
      };
    }
    return {
      status: "WARNING",
      summary: `${persons.length} recorded · none currently tracked`,
    };
  });
}
