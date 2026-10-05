import { Command } from "cmdk";
import { useEffect, useState } from "react";
import { MODULES } from "../../config/modules";
import { useDataModeStore } from "../../lib/data-mode";
import { usePersonList } from "../../lib/telemetry-store";
import type { ModuleId } from "../../lib/types";
import { IconLive, IconMock, IconSettings } from "../icons";

/**
 * Command palette. §9.1
 *
 * Fast jump between the eight modules and to a person ID without hunting the
 * grid — the one navigation affordance that is not the module grid itself.
 */
export function CommandPalette({
  onOpenModule,
  onOpenSettings,
}: {
  onOpenModule(id: ModuleId, personId?: string): void;
  onOpenSettings?(): void;
}) {
  const [open, setOpen] = useState(false);
  const persons = usePersonList();
  const mode = useDataModeStore((state) => state.mode);
  const toggleMode = useDataModeStore((state) => state.toggle);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        setOpen((current) => !current);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <Command.Dialog
      open={open}
      onOpenChange={setOpen}
      label="Jump to"
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-[18vh] backdrop-blur-sm"
    >
      <div className="w-full max-w-lg overflow-hidden rounded-card border border-border bg-surface shadow-2xl">
        <Command.Input
          placeholder="Jump to a module or a person ID…"
          className="w-full border-b border-border bg-transparent px-4 py-3.5 text-sm text-foreground outline-none placeholder:text-faint-foreground"
        />
        <Command.List className="max-h-80 overflow-y-auto p-2">
          <Command.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
            Nothing matches that.
          </Command.Empty>

          <Command.Group
            heading="Modules"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint-foreground [&_[cmdk-group-heading]]:uppercase"
          >
            {MODULES.map((module) => {
              const Icon = module.Icon;
              return (
                <Command.Item
                  key={module.id}
                  value={`${module.label} ${module.meaning}`}
                  onSelect={() => {
                    onOpenModule(module.id);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-state data-[selected=true]:bg-surface-raised"
                >
                  <Icon size={18} weight="duotone" className="text-muted-foreground" />
                  <span>{module.label}</span>
                  <span className="ml-auto text-xs text-faint-foreground">
                    {module.meaning}
                  </span>
                </Command.Item>
              );
            })}
          </Command.Group>

          <Command.Group
            heading="Dashboard"
            className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint-foreground [&_[cmdk-group-heading]]:uppercase"
          >
            {onOpenSettings ? (
              <Command.Item
                value="settings data source node addresses ip"
                onSelect={() => {
                  onOpenSettings();
                  setOpen(false);
                }}
                className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-state data-[selected=true]:bg-surface-raised"
              >
                <IconSettings size={18} weight="duotone" className="text-muted-foreground" />
                <span>Settings</span>
                <span className="ml-auto text-xs text-faint-foreground">
                  Data source and node addresses
                </span>
              </Command.Item>
            ) : null}

            <Command.Item
              value="toggle mock real data mode simulated"
              onSelect={() => {
                toggleMode();
                setOpen(false);
              }}
              className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-foreground transition-state data-[selected=true]:bg-surface-raised"
            >
              {mode === "mock" ? (
                <IconLive size={18} weight="duotone" className="text-muted-foreground" />
              ) : (
                <IconMock size={18} weight="duotone" className="text-muted-foreground" />
              )}
              <span>{mode === "mock" ? "Switch to real data" : "Switch to mock data"}</span>
              <span className="ml-auto text-xs text-faint-foreground">
                Currently {mode === "mock" ? "mock" : "real"}
              </span>
            </Command.Item>
          </Command.Group>

          {persons.length > 0 ? (
            <Command.Group
              heading="People"
              className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[11px] [&_[cmdk-group-heading]]:tracking-wide [&_[cmdk-group-heading]]:text-faint-foreground [&_[cmdk-group-heading]]:uppercase"
            >
              {persons.map((person) => (
                <Command.Item
                  key={person.personId}
                  value={`${person.personId} ${person.status}`}
                  onSelect={() => {
                    onOpenModule("personnel", person.personId);
                    setOpen(false);
                  }}
                  className="flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-state data-[selected=true]:bg-surface-raised"
                >
                  <span className="font-mono text-foreground">{person.personId}</span>
                  <span className="ml-auto text-xs text-faint-foreground">
                    {person.status.replace("_", " ").toLowerCase()}
                  </span>
                </Command.Item>
              ))}
            </Command.Group>
          ) : null}
        </Command.List>
      </div>
    </Command.Dialog>
  );
}
