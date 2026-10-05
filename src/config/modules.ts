/**
 * The eight modules. PROJECT_CONTEXT.md §4.
 *
 * Technical sensors are features inside these modules, never separate
 * navigation items. A module declares the **fields** it needs rather than the
 * host it needs: whichever node delivers thermal data, Thermal Intelligence
 * shows it. `degradedMessage` is what the module says when nothing on the
 * network is reporting any of its fields (§12.1 consequences table).
 */

import type { ModuleDefinition } from "../lib/types";
import {
  IconControl,
  IconEnvironment,
  IconHealth,
  IconMap,
  IconPersonnel,
  IconReports,
  IconThermal,
  IconVision,
  type IconComponent,
} from "../components/icons";

export interface ModuleEntry extends ModuleDefinition {
  Icon: IconComponent;
}

export const MODULES: ModuleEntry[] = [
  {
    id: "vision",
    label: "Vision & Detection",
    meaning: "What is OrionPax seeing?",
    fields: ["detections", "aiStatus"],
    degradedMessage:
      "No node is reporting camera detections — the AI node is unreachable or not publishing.",
    Icon: IconVision,
  },
  {
    id: "thermal",
    label: "Thermal Intelligence",
    meaning: "What does heat reveal?",
    fields: ["thermalFrame", "hotspots", "thermalPeakC"],
    degradedMessage:
      "No node is reporting thermal data — camera detections continue without thermal confirmation.",
    Icon: IconThermal,
  },
  {
    id: "map",
    label: "Mission Map",
    meaning: "Where has OrionPax been?",
    fields: ["pose", "lidar"],
    degradedMessage:
      "No node is reporting position or obstacle distance — the path is frozen at the last known point.",
    Icon: IconMap,
  },
  {
    id: "environment",
    label: "Environment Safety",
    meaning: "Is the surrounding area safe?",
    fields: ["temperature", "humidity", "pressure", "gas"],
    degradedMessage:
      "No node is reporting environment sensors — the safety state cannot be assessed.",
    Icon: IconEnvironment,
  },
  {
    id: "personnel",
    label: "Personnel Tracking",
    meaning: "Who has been detected and where?",
    // The mission record outlives its sources: existing records stay readable
    // even with every node down, so this view never degrades.
    fields: [],
    degradedMessage: "",
    Icon: IconPersonnel,
  },
  {
    id: "health",
    label: "Rover Health",
    meaning: "Is OrionPax operating normally?",
    // This view exists to show which node is down, so it never degrades.
    fields: [],
    degradedMessage: "",
    Icon: IconHealth,
  },
  {
    // Driving moved to the FlySky FS-i6 transmitter, so this module reports
    // what the rover is doing rather than commanding it. §4.7
    id: "control",
    label: "Drive Status",
    meaning: "What is the rover doing, and is the transmitter linked?",
    fields: ["drive", "rfLink"],
    degradedMessage:
      "No node is reporting drive telemetry or transmitter link state.",
    Icon: IconControl,
  },
  {
    id: "reports",
    label: "Mission Reports",
    meaning: "What happened during the mission?",
    fields: [],
    degradedMessage: "",
    Icon: IconReports,
  },
];

export const MODULE_BY_ID = new Map(MODULES.map((module) => [module.id, module]));
