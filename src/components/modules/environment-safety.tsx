import {
  moduleAvailability,
  resolveField,
  useFieldResolution,
  useModuleAvailability,
  useSummary,
} from "../../lib/telemetry-store";
import {
  interpretGas,
  interpretHumidity,
  interpretPressure,
  interpretTemperature,
  worst,
} from "../../lib/thresholds";
import type { GasReading, StatusLevel } from "../../lib/types";
import { MODULE_BY_ID } from "../../config/modules";
import { IconEnvironment, IconHumidity, IconPressure, IconThermal } from "../icons";
import { Panel, PanelHeader, TechnicalDetail } from "../ui/panel";
import { ReadingDisplay } from "../layout/reading-display";
import { StatusBadge } from "../layout/status-badge";
import { SourceUnavailable } from "../layout/unavailable";

/**
 * Environment Safety. §4.4
 *
 * Answers one question: is the surrounding environment safe? Multiple gas
 * sensors are presented as one overall state; exact values stay below it.
 *
 * §12.1 rule 10: when the environment node is offline the safety state becomes
 * UNKNOWN — never NORMAL — because the operator can no longer be told the area
 * is safe.
 */

export function EnvironmentSafetyModule() {
  const definition = MODULE_BY_ID.get("environment")!;
  const { available, missing, downSources } = useModuleAvailability(definition.fields);

  const temperature = useFieldResolution<number | null>("temperature");
  const humidity = useFieldResolution<number | null>("humidity");
  const pressure = useFieldResolution<number | null>("pressure");
  const gas = useFieldResolution<GasReading[]>("gas");
  const nodeSafetyState = useFieldResolution<StatusLevel | undefined>("safetyState");

  const overall = useEnvironmentStatus();

  if (!available) {
    return (
      <div className="space-y-5">
        {/* The safety headline still renders — showing UNKNOWN, not silence. */}
        <SafetyHeadline level="UNKNOWN" message="Air and climate cannot be assessed" />
        <SourceUnavailable
          message={definition.degradedMessage}
          missing={missing}
          sources={downSources}
        />
      </div>
    );
  }

  const gasReadings = gas.status === "unavailable" ? null : gas.reading.value;
  const gasInterpretation = interpretGas(gasReadings);

  return (
    <div className="space-y-5">
      <SafetyHeadline level={overall.status} message={overall.summary} />

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel className="lg:col-span-2">
          <PanelHeader
            title="Air condition"
            hint="Gas sensors combined into one state. Raw readings below."
          />

          <div className="flex items-start gap-4 rounded-xl border border-border bg-surface-raised p-4">
            <IconEnvironment size={28} weight="duotone" className="text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <p className="text-base font-medium text-foreground">
                {gasInterpretation.message}
              </p>
              <p className="mt-1 text-xs text-faint-foreground">
                {gasReadings
                  ? `${gasReadings.length} gas sensor(s) reporting`
                  : "No gas sensor data"}
              </p>
              {/*
                MQ sensors run their heater hot and read high until it settles,
                which is minutes from power-on and longer on a sensor that has
                not been used in a while. Saying so is the difference between
                an operator trusting the first reading and knowing to wait.
              */}
              {gasReadings?.some((reading) => reading.raw >= 1) ? (
                <p className="mt-1 text-xs text-warning">
                  A sensor is at full scale. That may be a real hazard — treat it as one — but an
                  MQ sensor also reads at the top while its heater warms up after power-on.
                </p>
              ) : null}
            </div>
            <StatusBadge level={gasInterpretation.level} />
          </div>

          <div className="mt-4 border-t border-border pt-3">
            <p className="mb-1 text-[11px] tracking-wide text-faint-foreground uppercase">
              Exact sensor values
            </p>
            {/*
              MQ-2 and MQ-135 are uncalibrated analog sensors: they report a
              voltage that rises with total reducing-gas concentration. A ppm
              figure would need a per-sensor calibration curve this rover does
              not carry, so the proportion of full scale is what is shown.
            */}
            {gasReadings && gasReadings.length > 0 ? (
              gasReadings.map((reading) => (
                <div key={reading.sensorId}>
                  <TechnicalDetail
                    label={reading.label}
                    value={
                      `${(reading.raw * 100).toFixed(1)} % of scale` +
                      (reading.rawAdc === undefined
                        ? ""
                        : ` · ${reading.rawAdc.toFixed(0)} / ${reading.adcMax ?? 4095} counts`)
                    }
                  />
                  {reading.responds ? (
                    <p className="pb-1.5 text-[11px] text-faint-foreground">
                      Responds to {reading.responds}
                    </p>
                  ) : null}
                </div>
              ))
            ) : (
              <TechnicalDetail label="Gas sensors" value="not reported" />
            )}
            {/* Provenance: the node's own interpreted state wins when present. §13 */}
            <TechnicalDetail
              label="Interpreted by"
              value={
                nodeSafetyState.status !== "unavailable" && nodeSafetyState.reading.value
                  ? "environment node"
                  : "dashboard thresholds"
              }
            />
          </div>
        </Panel>

        <Panel className="space-y-5">
          <PanelHeader title="Climate" hint="BME280" />
          <ReadingDisplay<number | null>
            label="Temperature"
            resolution={temperature}
            interpret={interpretTemperature}
          />
          <div className="border-t border-border" />
          <ReadingDisplay<number | null>
            label="Humidity"
            resolution={humidity}
            interpret={interpretHumidity}
          />
          <div className="border-t border-border" />
          <ReadingDisplay<number | null>
            label="Pressure"
            resolution={pressure}
            interpret={interpretPressure}
          />
        </Panel>
      </div>

      <Panel>
        <PanelHeader
          title="What the operator sees"
          hint="Every alert names the affected condition, not a raw value. §4.4"
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <MeaningTile
            icon={<IconThermal size={18} weight="duotone" />}
            title="Temperature"
            line={interpretTemperature(
              temperature.status === "unavailable" ? null : temperature.reading.value,
            ).message}
          />
          <MeaningTile
            icon={<IconHumidity size={18} weight="duotone" />}
            title="Humidity"
            line={interpretHumidity(
              humidity.status === "unavailable" ? null : humidity.reading.value,
            ).message}
          />
          <MeaningTile
            icon={<IconPressure size={18} weight="duotone" />}
            title="Pressure"
            line={interpretPressure(
              pressure.status === "unavailable" ? null : pressure.reading.value,
            ).message}
          />
        </div>
      </Panel>
    </div>
  );
}

function SafetyHeadline({ level, message }: { level: StatusLevel; message: string }) {
  return (
    <Panel className="flex flex-wrap items-center justify-between gap-4">
      <div>
        <p className="text-xs tracking-wide text-faint-foreground uppercase">
          Is the surrounding area safe?
        </p>
        <p className="mt-1 text-2xl font-semibold text-foreground">{message}</p>
      </div>
      <StatusBadge level={level} />
    </Panel>
  );
}

function MeaningTile({
  icon,
  title,
  line,
}: {
  icon: React.ReactNode;
  title: string;
  line: string;
}) {
  return (
    <div className="rounded-xl border border-border bg-surface-raised p-4">
      <div className="flex items-center gap-2 text-faint-foreground">
        {icon}
        <span className="text-[11px] tracking-wide uppercase">{title}</span>
      </div>
      <p className="mt-2 text-sm text-foreground">{line}</p>
    </div>
  );
}

/**
 * Overall environment status. Used by both this module and its home card.
 * A node-supplied safetyState wins over local derivation. §13
 */
export function useEnvironmentStatus(): { status: StatusLevel; summary: string } {
  return useSummary((state) => {
    const { available } = moduleAvailability(state, [
      "temperature",
      "humidity",
      "pressure",
      "gas",
    ]);
    if (!available) {
      return { status: "UNKNOWN", summary: "Safety state unknown — no environment data" };
    }

    const nodeState = resolveField<StatusLevel | undefined>(state, "safetyState");
    const gas = resolveField<GasReading[]>(state, "gas");
    const temperature = resolveField<number | null>(state, "temperature");

    const gasInterpretation = interpretGas(
      gas.status === "unavailable" ? null : gas.reading.value,
    );
    const temperatureInterpretation = interpretTemperature(
      temperature.status === "unavailable" ? null : temperature.reading.value,
    );

    const derived = worst(gasInterpretation.level, temperatureInterpretation.level);
    const status =
      nodeState.status !== "unavailable" && nodeState.reading.value
        ? nodeState.reading.value
        : derived;

    const summary =
      status === "NORMAL"
        ? "Environment safe"
        : status === "UNKNOWN"
          ? "Safety state unknown"
          : gasInterpretation.level === status
            ? gasInterpretation.message
            : temperatureInterpretation.message;

    return { status, summary };
  });
}
