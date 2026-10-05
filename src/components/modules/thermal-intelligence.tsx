import { useState } from "react";
import { MODULE_BY_ID } from "../../config/modules";
import {
  fieldValue,
  moduleAvailability,
  useFieldResolution,
  useFieldValue,
  useModuleAvailability,
  useSummary,
} from "../../lib/telemetry-store";
import { interpretHeatSignature, worst } from "../../lib/thresholds";
import type { Hotspot, StatusLevel, ThermalFrame } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconHeat } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { StatusBadge } from "../layout/status-badge";
import { SourceUnavailable } from "../layout/unavailable";
import {
  PALETTES,
  PaletteLegend,
  ThermalCanvas,
  type Palette,
} from "../thermal/thermal-canvas";

/**
 * Thermal Intelligence. §4.2
 *
 * The MLX90640 publishes 32x24 absolute temperatures. That matrix is rendered
 * as an image, and the operator reads a sentence plus one exact number — never
 * the matrix itself.
 *
 * Every value here comes from the sensor: peak, coldest and the sensor's own
 * ambient figure. Where a node sends pixels but no hotspot list, the hotspots
 * are derived from the frame in the ingest layer using the shared thresholds,
 * and that is stated below.
 */

const BAND_LABEL: Record<Hotspot["band"], string> = {
  NORMAL_HEAT: "Normal Heat",
  ELEVATED_HEAT: "Elevated Heat",
  HIGH_HEAT: "High Heat",
};

const BAND_LEVEL: Record<Hotspot["band"], StatusLevel> = {
  NORMAL_HEAT: "NORMAL",
  ELEVATED_HEAT: "ATTENTION",
  HIGH_HEAT: "WARNING",
};

export function ThermalIntelligenceModule() {
  const definition = MODULE_BY_ID.get("thermal")!;
  const { available, missing, downSources } = useModuleAvailability(definition.fields);
  const frameResolution = useFieldResolution<ThermalFrame | null>("thermalFrame");
  const hotspots = useFieldValue<Hotspot[]>("hotspots") ?? [];
  const peakC = useFieldValue<number>("thermalPeakC");
  const minC = useFieldValue<number>("thermalMinC");
  const ambientC = useFieldValue<number>("thermalAmbientC");

  const [palette, setPalette] = useState<Palette>("iron");

  if (!available) {
    return (
      <SourceUnavailable
        message={definition.degradedMessage}
        missing={missing}
        sources={downSources}
      />
    );
  }

  const frame = frameResolution.status === "unavailable" ? null : frameResolution.reading.value;
  const stale = frameResolution.status === "stale";

  const humanLike = hotspots.filter((hotspot) => hotspot.humanLike);
  const hottest = hotspots.reduce<Hotspot | null>(
    (accumulator, hotspot) =>
      accumulator === null || hotspot.celsius > accumulator.celsius ? hotspot : accumulator,
    null,
  );
  const headline = interpretHeatSignature(hottest?.celsius ?? peakC);

  return (
    <div className="space-y-5">
      <Panel className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-xs tracking-wide text-faint-foreground uppercase">
            What does heat reveal?
          </p>
          <p className="mt-1 text-xl font-semibold text-foreground">
            {humanLike.length > 0
              ? `Human-like heat signature detected — ${humanLike[0].celsius.toFixed(1)}°C`
              : headline.message}
          </p>
        </div>
        <StatusBadge level={humanLike.length > 0 ? "CRITICAL" : headline.level} />
      </Panel>

      <div className="grid gap-5 xl:grid-cols-[1fr_22rem]">
        <Panel className="p-3">
          <ThermalCanvas frame={frame} palette={palette} hotspots={hotspots} stale={stale} />

          <div className="mt-3 space-y-3">
            <div className="flex items-center justify-between gap-3">
              <span className="tabular font-mono text-[11px] text-faint-foreground">
                {minC === null ? "" : `${minC.toFixed(1)}°C`}
              </span>
              <span className="text-[11px] text-faint-foreground">
                Colour maps the coldest to the hottest cell in this frame
              </span>
              <span className="tabular font-mono text-[11px] text-faint-foreground">
                {peakC === null ? "" : `${peakC.toFixed(1)}°C`}
              </span>
            </div>
            <PaletteLegend palette={palette} />
            <div className="flex flex-wrap gap-2">
              {PALETTES.map((entry) => (
                <Button
                  key={entry.id}
                  size="sm"
                  variant={palette === entry.id ? "primary" : "surface"}
                  onClick={() => setPalette(entry.id)}
                >
                  {entry.label}
                </Button>
              ))}
            </div>
          </div>
        </Panel>

        <div className="space-y-5">
          <Panel>
            <PanelHeader
              title="Hotspots"
              hint={
                hotspots.length === 0
                  ? "No hotspots in the current frame."
                  : `${hotspots.length} detected`
              }
            />

            <div className="space-y-2">
              {hotspots.length === 0 ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">
                  Thermal field within normal range.
                </p>
              ) : (
                hotspots.map((hotspot, index) => (
                  <div
                    key={`${hotspot.x}-${index}`}
                    className={cn(
                      "rounded-xl border bg-surface-raised p-4",
                      hotspot.humanLike ? "border-critical/40" : "border-border",
                    )}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-start gap-2">
                        <IconHeat
                          size={18}
                          weight="duotone"
                          className={
                            hotspot.humanLike ? "text-critical" : "text-muted-foreground"
                          }
                        />
                        <div>
                          <p className="text-sm text-foreground">
                            {hotspot.humanLike
                              ? "Human-like heat signature"
                              : BAND_LABEL[hotspot.band]}
                          </p>
                          <p className="tabular mt-0.5 font-mono text-xs text-muted-foreground">
                            {hotspot.celsius.toFixed(1)}°C
                          </p>
                        </div>
                      </div>
                      <StatusBadge
                        level={hotspot.humanLike ? "CRITICAL" : BAND_LEVEL[hotspot.band]}
                        size="sm"
                      />
                    </div>
                  </div>
                ))
              )}
            </div>
          </Panel>

          <Panel>
            <PanelHeader title="Frame detail" hint="MLX90640" />
            <TechnicalDetail
              label="Resolution"
              value={frame ? `${frame.width} x ${frame.height} cells` : "not reported"}
            />
            <TechnicalDetail
              label="Peak temperature"
              value={peakC === null ? "not reported" : `${peakC.toFixed(2)} °C`}
            />
            <TechnicalDetail
              label="Coldest cell"
              value={minC === null ? "not reported" : `${minC.toFixed(2)} °C`}
            />
            <TechnicalDetail
              label="Sensor ambient"
              value={ambientC === null ? "not reported" : `${ambientC.toFixed(2)} °C`}
            />
            <TechnicalDetail label="Palette" value={palette} />
            <TechnicalDetail label="Feed" value={stale ? "stale" : "live"} />
            <p className="mt-3 text-[11px] text-faint-foreground">
              A heat signature is called human-like between 30 and 42 °C, which is the skin
              temperature range an MLX90640 can actually resolve. It is an indication, not an
              identification.
            </p>
          </Panel>
        </div>
      </div>
    </div>
  );
}

export function useThermalSummary(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const { available } = moduleAvailability(state, ["thermalFrame", "hotspots", "thermalPeakC"]);
    if (!available) return { status: "UNKNOWN", summary: "No thermal data reported" };

    const hotspots = fieldValue<Hotspot[]>(state, "hotspots") ?? [];
    const humanLike = hotspots.filter((hotspot) => hotspot.humanLike);
    if (humanLike.length > 0) {
      return {
        status: "CRITICAL",
        summary: `Human-like heat signature — ${humanLike[0].celsius.toFixed(1)}°C`,
      };
    }
    if (hotspots.length === 0) {
      const peak = fieldValue<number>(state, "thermalPeakC");
      return {
        status: "NORMAL",
        summary:
          peak === null ? "No hotspots detected" : `No hotspots — peak ${peak.toFixed(1)}°C`,
      };
    }

    const level = worst(...hotspots.map((hotspot) => BAND_LEVEL[hotspot.band]));
    const hottest = hotspots.reduce((accumulator, hotspot) =>
      hotspot.celsius > accumulator.celsius ? hotspot : accumulator,
    );
    return {
      status: level,
      summary: `${BAND_LABEL[hottest.band]} — ${hottest.celsius.toFixed(1)}°C`,
    };
  });
}
