import { useCallback, useState } from "react";
import { Toaster } from "react-hot-toast";
import { MODULE_BY_ID } from "./config/modules";
import { useTelemetryRuntime } from "./lib/use-telemetry-runtime";
import type { ModuleId } from "./lib/types";
import { CommandPalette } from "./components/command/command-palette";
import { AlertIndicator } from "./components/layout/alert-indicator";
import { HomeScreen } from "./components/layout/home-screen";
import { MissionHeader } from "./components/layout/mission-header";
import { useTheme } from "./components/layout/theme-provider";
import { LandingPage } from "./components/marketing/landing-page";
import { PilotView } from "./components/pilot/pilot-view";
import { SettingsView } from "./components/settings/settings-view";
import { EnvironmentSafetyModule } from "./components/modules/environment-safety";
import { MissionMapModule } from "./components/modules/mission-map";
import { MissionReportsModule } from "./components/modules/mission-reports";
import { PersonnelTrackingModule } from "./components/modules/personnel-tracking";
import { DriveStatusModule } from "./components/modules/drive-status";
import { RoverHealthModule } from "./components/modules/rover-health";
import { ThermalIntelligenceModule } from "./components/modules/thermal-intelligence";
import { VisionDetectionModule } from "./components/modules/vision-detection";

/**
 * Single-page, app-like shell. §3
 *
 * The home screen holds the module grid; selecting a card opens that module in
 * the same page, and Back returns home. No router, no permanent sidebar.
 * Settings is a page in that same stack rather than a dialog — it is set-up
 * work, not a confirmation.
 *
 * Motion rule 4: the module open/close is the one hero transition in the app.
 */

type View =
  | { kind: "landing" }
  | { kind: "home" }
  | { kind: "module"; id: ModuleId }
  | { kind: "settings" }
  /** Driving HUD: one screen, nothing to click. */
  | { kind: "pilot" };

export default function App() {
  // One runtime for the whole app: the data layer plus the staleness tick.
  useTelemetryRuntime();
  useTheme();

  const [view, setView] = useState<View>({ kind: "landing" });

  const openModule = useCallback((id: ModuleId) => {
    setView({ kind: "module", id });
  }, []);

  const goHome = useCallback(() => setView({ kind: "home" }), []);
  const goLanding = useCallback(() => setView({ kind: "landing" }), []);
  const goPilot = useCallback(() => setView({ kind: "pilot" }), []);
  const goSettings = useCallback(() => setView({ kind: "settings" }), []);

  if (view.kind === "landing") {
    return (
      <>
        <LandingPage
          onLaunch={goHome}
          onHistory={() => openModule("reports")}
          onPilot={goPilot}
          onSettings={goSettings}
        />
        <Toaster position="bottom-right" />
      </>
    );
  }

  if (view.kind === "pilot") {
    return (
      <>
        <PilotView onExit={goHome} />
        <Toaster position="bottom-right" />
      </>
    );
  }

  const module = view.kind === "module" ? MODULE_BY_ID.get(view.id) : undefined;
  const title = view.kind === "settings" ? "Settings" : module?.label;
  const meaning =
    view.kind === "settings"
      ? "Where the data comes from, and where each value lands."
      : module?.meaning;
  const inPage = view.kind === "module" || view.kind === "settings";

  return (
    <div className="min-h-dvh bg-background">
      <MissionHeader
        // In a page, Back returns to the grid; on the grid, it leaves mission
        // control. There is always one step back. §3
        onBack={inPage ? goHome : goLanding}
        backLabel={inPage ? "Back" : "Exit"}
        moduleLabel={title}
        onExit={goLanding}
        onPilot={goPilot}
        onSettings={goSettings}
      />

      <main className="mx-auto max-w-[1800px] px-4 pb-10 sm:px-6">
        {view.kind === "home" ? (
          <HomeScreen onOpenModule={openModule} />
        ) : (
          <div
            // The hero transition: the page fades and scales in from the card.
            // 280ms layout token, one easing curve, no overshoot.
            key={view.kind === "module" ? view.id : "settings"}
            className="animate-in fade-in-0 zoom-in-[0.985] py-6 duration-[280ms] ease-[cubic-bezier(0.32,0.72,0,1)]"
          >
            <div className="mb-5 flex items-start justify-between gap-4">
              <div>
                <h1 className="text-lg font-semibold text-foreground">{title}</h1>
                <p className="mt-0.5 text-xs text-muted-foreground">{meaning}</p>
              </div>
              <AlertIndicator onOpenModule={openModule} />
            </div>

            {view.kind === "settings" ? (
              <SettingsView />
            ) : (
              <ModuleView id={view.id} onOpenModule={openModule} />
            )}
          </div>
        )}
      </main>

      <CommandPalette onOpenModule={openModule} onOpenSettings={goSettings} />
      <Toaster
        position="bottom-right"
        toastOptions={{
          // Transient confirmations only. Safety alerts live in the persistent
          // alert surface, never in a toast. §9.1
          duration: 2600,
          style: {
            background: "var(--surface)",
            color: "var(--foreground)",
            border: "1px solid var(--border)",
            fontSize: "0.875rem",
          },
        }}
      />
    </div>
  );
}

function ModuleView({
  id,
  onOpenModule,
}: {
  id: ModuleId;
  onOpenModule(id: ModuleId): void;
}) {
  switch (id) {
    case "vision":
      return <VisionDetectionModule onOpenModule={onOpenModule} />;
    case "thermal":
      return <ThermalIntelligenceModule />;
    case "map":
      return <MissionMapModule />;
    case "environment":
      return <EnvironmentSafetyModule />;
    case "personnel":
      return <PersonnelTrackingModule onOpenModule={onOpenModule} />;
    case "health":
      return <RoverHealthModule />;
    case "control":
      return <DriveStatusModule />;
    case "reports":
      return <MissionReportsModule />;
    default: {
      const unreachable: never = id;
      throw new Error(`Unhandled module "${String(unreachable)}".`);
    }
  }
}
