import { useTelemetry, useSourceHealthList } from "../../lib/telemetry-store";
import type { StatusLevel, TelemetryField } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconAi, IconConnected, IconEnvironment, IconSettings, IconThermal, IconVision } from "../icons";
import { Button } from "../ui/button";
import { DataModeBadge } from "../layout/data-mode-badge";
import { ThemeToggle } from "../layout/theme-provider";

/**
 * Landing page. §10
 *
 * The status indicators resolve from real per-source health, not decoration:
 * a node that is offline shows offline here too. §12.1
 */
export function LandingPage({
  onLaunch,
  onHistory,
  onPilot,
  onSettings,
}: {
  onLaunch(): void;
  onHistory(): void;
  /** Opens the driving HUD directly, for the FS-i6 pilot. §4.7 */
  onPilot(): void;
  /** Opens the settings page, for pointing the dashboard at a rover. */
  onSettings(): void;
}) {
  const health = useSourceHealthList();
  const owners = useTelemetry((state) => state.fieldOwners);

  /**
   * Readiness, resolved from live data rather than decoration (§10).
   *
   * Each indicator asks whether a capability is actually arriving — not
   * whether a particular host is up, because on this rover any node may carry
   * any sensor.
   */
  function capability(fields: TelemetryField[]): StatusLevel {
    const live = fields.filter((field) => {
      const owner = owners[field];
      return owner ? health.find((entry) => entry.id === owner)?.state === "ONLINE" : false;
    });
    if (live.length === fields.length) return "NORMAL";
    if (live.length > 0) return "ATTENTION";
    return "UNKNOWN";
  }

  const indicators = [
    {
      label: "Cameras Online",
      icon: <IconVision size={16} weight="duotone" />,
      level: capability(["detections"]),
    },
    {
      label: "AI Online",
      icon: <IconAi size={16} weight="duotone" />,
      level: capability(["aiStatus"]),
    },
    {
      label: "Thermal Online",
      icon: <IconThermal size={16} weight="duotone" />,
      level: capability(["thermalFrame"]),
    },
    {
      label: "Environment Sensors",
      icon: <IconEnvironment size={16} weight="duotone" />,
      level: capability(["temperature", "gas"]),
    },
    {
      label: "Communication Online",
      icon: <IconConnected size={16} weight="duotone" />,
      level: health.some((source) => source.state === "ONLINE") ? "NORMAL" : "UNKNOWN",
    },
  ] satisfies { label: string; icon: React.ReactNode; level: StatusLevel }[];

  return (
    <div className="relative min-h-dvh overflow-hidden bg-background">
      {/* Hero: underground environment with a subtle scanning sweep. §10 */}
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_50%_-10%,var(--color-primary)_0%,transparent_55%)] opacity-[0.16]" />
        <div className="absolute inset-0 bg-[linear-gradient(to_right,var(--color-border)_1px,transparent_1px),linear-gradient(to_bottom,var(--color-border)_1px,transparent_1px)] bg-[size:64px_64px] opacity-30 [mask-image:radial-gradient(ellipse_at_center,black,transparent_72%)]" />
        <div className="absolute inset-x-0 top-1/3 h-40 bg-gradient-to-b from-transparent via-accent/10 to-transparent" />
      </div>

      <header className="relative mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        <span className="text-sm font-semibold tracking-[0.3em] text-foreground">
          ORIONPAX
        </span>
        <div className="flex items-center gap-2">
          <DataModeBadge onOpenSettings={onSettings} />
          <button
            type="button"
            onClick={onSettings}
            title="Settings — data source and node addresses"
            aria-label="Settings"
            className="rounded-md p-1.5 text-muted-foreground transition-state hover:text-foreground focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
          >
            <IconSettings size={16} />
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="relative mx-auto flex max-w-4xl flex-col items-center px-6 pt-20 pb-24 text-center">
        <p className="mb-4 rounded-full border border-border bg-surface/70 px-3 py-1 text-[11px] tracking-[0.22em] text-muted-foreground uppercase backdrop-blur">
          Rescue Intelligence &amp; Exploration System
        </p>

        <h1 className="text-5xl leading-[1.05] font-semibold tracking-tight text-foreground sm:text-7xl">
          ORIONPAX
        </h1>

        <p className="mt-6 max-w-xl text-lg text-muted-foreground">
          See first. Understand the environment. Guide the rescue team.
        </p>

        <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
          <Button variant="primary" size="lg" onClick={onLaunch}>
            Launch Mission Control
          </Button>
          <Button variant="surface" size="lg" onClick={onPilot}>
            Pilot View
          </Button>
          <Button variant="ghost" size="lg" onClick={onHistory}>
            Mission History
          </Button>
        </div>

        {/* Real health, not decoration. */}
        <div className="mt-16 grid w-full gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {indicators.map((indicator) => {
            const online = indicator.level === "NORMAL";
            const degraded = indicator.level === "ATTENTION";
            return (
              <div
                key={indicator.label}
                className="flex items-center gap-2.5 rounded-xl border border-border bg-surface/70 px-4 py-3 text-left backdrop-blur"
              >
                <span
                  className={cn(
                    "text-muted-foreground",
                    online && "text-normal",
                    degraded && "text-warning",
                    !online && !degraded && "text-critical",
                  )}
                >
                  {indicator.icon}
                </span>
                <span className="text-sm text-foreground">{indicator.label}</span>
                <span
                  className={cn(
                    "ml-auto size-2 rounded-full",
                    online && "bg-normal",
                    degraded && "bg-warning pulse-attention",
                    !online && !degraded && "bg-critical",
                  )}
                />
              </div>
            );
          })}
        </div>

        <p className="mt-8 max-w-xl text-xs text-faint-foreground">
          Telemetry arrives from {health.length} independent{" "}
          {health.length === 1 ? "node" : "nodes"}. Each is monitored separately, and each value
          is routed by what it is rather than by which host sent it — so losing one node degrades
          only what that node was carrying.
        </p>
      </main>
    </div>
  );
}
