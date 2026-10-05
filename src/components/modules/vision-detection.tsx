import toast from "react-hot-toast";
import { MODULE_BY_ID } from "../../config/modules";
import { formatTime, missionNow } from "../../lib/mission-clock";
import {
  fieldValue,
  moduleAvailability,
  useFieldResolution,
  useFieldValue,
  useModuleAvailability,
  usePersonList,
  useSummary,
  useTelemetry,
} from "../../lib/telemetry-store";
import { interpretConfidence } from "../../lib/thresholds";
import type { Detection, ModuleId, StatusLevel } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconBookmark, IconLocate } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { StatusBadge } from "../layout/status-badge";
import { SourceUnavailable } from "../layout/unavailable";
import { CameraFeed } from "../vision/camera-feed";

/**
 * Vision & Detection. §4.1
 *
 * Live RGB feed with AI overlays. Every detected person carries a mission ID,
 * and the wording is operator-facing: "Person detected ahead", not a bare
 * confidence percentage.
 *
 * What this view does NOT offer: recording and snapshot controls. Neither the
 * Pi node nor the dashboard has a recorder behind them, so those buttons would
 * have reported success while saving nothing. The mission bookmark stays —
 * that writes a real entry into the mission timeline this dashboard owns.
 */
export function VisionDetectionModule({
  onOpenModule,
}: {
  onOpenModule(id: ModuleId): void;
}) {
  const definition = MODULE_BY_ID.get("vision")!;
  const { available, missing, downSources } = useModuleAvailability(definition.fields);
  const detectionsResolution = useFieldResolution<Detection[]>("detections");
  const fps = useFieldValue<number>("cameraFps");
  const aiStatus = useFieldValue<string>("aiStatus");
  const persons = usePersonList();
  const addEvent = useTelemetry((state) => state.addEvent);

  const detections =
    detectionsResolution.status === "unavailable" ? [] : detectionsResolution.reading.value;
  const stale = detectionsResolution.status === "stale";

  function bookmark() {
    addEvent({
      kind: "BOOKMARK",
      level: "ATTENTION",
      message: "Operator bookmarked this moment",
      sourceId: null,
      pose: null,
    });
    // Transient confirmation — a toast is correct here. Safety alerts are not
    // toasts. §9.1
    toast.success("Mission bookmark added");
  }

  if (!available) {
    return (
      <SourceUnavailable
        message={definition.degradedMessage}
        missing={missing}
        sources={downSources}
      />
    );
  }

  const people = detections.filter(
    (detection) => !detection.label || detection.label === "person",
  );

  return (
    <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
      <div className="space-y-5">
        <Panel className="p-3">
          {/* Fixed aspect box: a reconnect must not resize the layout. Rule 10. */}
          <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black">
            <CameraFeed detections={detections} stale={stale} />

            {/* AI overlays. Boxes appear, then the ID locks in. §9 */}
            {detections.map((detection, index) => (
              <DetectionBox
                key={`${detection.personId}-${index}`}
                detection={detection}
                stale={stale}
              />
            ))}

            {/* Feed chrome: timestamp and feed state. §4.1 */}
            <div className="absolute inset-x-0 top-0 flex items-center justify-between gap-2 bg-gradient-to-b from-black/70 to-transparent p-3">
              <span className="tabular font-mono text-[11px] text-white/90">
                {formatTime(missionNow())}
              </span>
              <div className="flex items-center gap-2">
                {fps !== null ? (
                  <span className="tabular rounded-full bg-black/55 px-2 py-0.5 font-mono text-[11px] text-white/80">
                    {fps.toFixed(0)} fps
                  </span>
                ) : null}
                <StatusBadge
                  level={stale ? "WARNING" : "NORMAL"}
                  label={stale ? "Feed stale" : "Live"}
                  size="sm"
                />
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="surface" onClick={bookmark}>
              <IconBookmark size={16} />
              Add mission bookmark
            </Button>
            <Button variant="ghost" onClick={() => onOpenModule("map")}>
              <IconLocate size={16} />
              View on map
            </Button>
          </div>
        </Panel>
      </div>

      <div className="space-y-5">
        <Panel>
          <PanelHeader
            title="Detections"
            hint={
              people.length === 0
                ? "No people currently in frame."
                : `${people.length} in frame now`
            }
          />

          <div className="space-y-2">
            {people.length === 0 ? (
              <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                Nothing detected in the current frame.
              </p>
            ) : (
              people.map((detection) => {
                const person = persons.find((entry) => entry.personId === detection.personId);
                const interpretation = interpretConfidence(detection.confidence);
                return (
                  <div
                    key={detection.personId}
                    className="rounded-xl border border-border bg-surface-raised p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="font-mono text-sm font-semibold text-foreground">
                          {detection.personId}
                        </p>
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {interpretation.message}
                        </p>
                      </div>
                      <StatusBadge level={interpretation.level} size="sm" />
                    </div>

                    <div className="mt-3 border-t border-border pt-2">
                      <TechnicalDetail label="Confidence" value={interpretation.exact} />
                      <TechnicalDetail
                        label="Detected at"
                        value={formatTime(detection.detectedAt)}
                      />
                      <TechnicalDetail
                        label="Reported by"
                        value={
                          detectionsResolution.status === "unavailable"
                            ? "—"
                            : detectionsResolution.reading.sourceId
                        }
                      />
                      <TechnicalDetail
                        label="Thermal confirmation"
                        value={person?.thermalConfirmed ? "confirmed" : "not confirmed"}
                      />
                      <TechnicalDetail
                        label="Location"
                        value={
                          person?.lastKnownPose
                            ? `x ${person.lastKnownPose.x.toFixed(1)} m · y ${person.lastKnownPose.y.toFixed(1)} m`
                            : "no position reported"
                        }
                      />
                    </div>

                    <div className="mt-2 flex gap-2">
                      <Button size="sm" variant="surface" onClick={() => onOpenModule("map")}>
                        View on map
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => onOpenModule("personnel")}
                      >
                        History
                      </Button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader title="Feed detail" hint="Pi Camera 3 + AI HAT+" />
          <TechnicalDetail
            label="AI inference"
            value={aiStatus === null ? "not reported" : aiStatus.toLowerCase()}
          />
          <TechnicalDetail
            label="Frame rate"
            value={fps === null ? "not reported" : `${fps.toFixed(0)} fps`}
          />
          <TechnicalDetail
            label="Objects in frame"
            value={String(detections.length)}
          />
          <p className="mt-3 text-[11px] text-faint-foreground">
            Person IDs come from the node when it tracks, and are assigned here by frame-to-frame
            proximity when it does not. A person who leaves and returns may be given a new ID —
            re-identification is not in scope.
          </p>
        </Panel>
      </div>
    </div>
  );
}

function DetectionBox({ detection, stale }: { detection: Detection; stale: boolean }) {
  const person = !detection.label || detection.label === "person";
  return (
    <div
      className={cn(
        "absolute rounded-md border-2 transition-layout",
        stale ? "border-warning/70" : person ? "border-critical" : "border-attention",
      )}
      style={{
        left: `${detection.box.x * 100}%`,
        top: `${detection.box.y * 100}%`,
        width: `${detection.box.w * 100}%`,
        height: `${detection.box.h * 100}%`,
      }}
    >
      <span
        className={cn(
          "absolute -top-6 left-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white",
          stale ? "bg-warning/90" : person ? "bg-critical" : "bg-attention",
        )}
      >
        {detection.personId}
      </span>
    </div>
  );
}

/** Home-card summary. */
export function useVisionSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const { available } = moduleAvailability(state, ["detections", "aiStatus"]);
    if (!available) return { status: "UNKNOWN", summary: "No camera detections reported" };

    const detections = (fieldValue<Detection[]>(state, "detections") ?? []).filter(
      (detection) => !detection.label || detection.label === "person",
    );
    if (detections.length === 0) {
      return { status: "NORMAL", summary: "No people in frame" };
    }
    return {
      status: "CRITICAL",
      summary:
        detections.length === 1
          ? `Person detected ahead — ${detections[0].personId}`
          : `${detections.length} people detected in frame`,
    };
  });
}
