import { MODULES } from "../../config/modules";
import type { ModuleId, StatusLevel } from "../../lib/types";
import { ModuleCard } from "./module-card";
import { AlertIndicator } from "./alert-indicator";
import { useVisionSummary } from "../modules/vision-detection";
import { useThermalSummary } from "../modules/thermal-intelligence";
import { useMapSummary } from "../modules/mission-map";
import { useEnvironmentStatus } from "../modules/environment-safety";
import { usePersonnelSummary } from "../modules/personnel-tracking";
import { useRoverHealthSummary } from "../modules/rover-health";
import { useDriveStatusSummary } from "../modules/drive-status";
import { useReportsSummary } from "../modules/mission-reports";

/**
 * Home screen. §4
 *
 * Deliberately simple and visual: eight large modules in a clean grid, a small
 * global alert indicator that appears only when attention is required, no
 * permanent technical sidebar, and no wall of raw sensor numbers.
 */
export function HomeScreen({ onOpenModule }: { onOpenModule(id: ModuleId): void }) {
  // Each module computes its own one-line summary from the fields it owns.
  const summaries: Record<ModuleId, { status: StatusLevel; summary: string }> = {
    vision: useVisionSummary(),
    thermal: useThermalSummary(),
    map: useMapSummary(),
    environment: useEnvironmentStatus(),
    personnel: usePersonnelSummary(),
    health: useRoverHealthSummary(),
    control: useDriveStatusSummary(),
    reports: useReportsSummary(),
  };

  return (
    <div className="mx-auto max-w-[1800px] px-4 py-6 sm:px-6">
      <div className="mb-5 flex items-center justify-between gap-4">
        <div>
          <h1 className="text-lg font-semibold text-foreground">Mission Control</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Select a module to open it. Press ⌘K / Ctrl+K to jump.
          </p>
        </div>
        <AlertIndicator onOpenModule={onOpenModule} />
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {MODULES.map((module) => (
          <ModuleCard
            key={module.id}
            module={module}
            status={summaries[module.id].status}
            summary={summaries[module.id].summary}
            onOpen={() => onOpenModule(module.id)}
          />
        ))}
      </div>
    </div>
  );
}
