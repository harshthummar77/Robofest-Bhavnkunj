import { useState } from "react";
import toast from "react-hot-toast";
import { mixedContentBlocked, useNodeRegistry, useNodes } from "../../config/nodes";
import { useDataModeStore } from "../../lib/data-mode";
import { FIELD_CATALOG, fieldLabel } from "../../lib/field-catalog";
import { formatAge } from "../../lib/mission-clock";
import { useSourceHealthList, useTelemetry } from "../../lib/telemetry-store";
import type {
  CameraKind,
  MockProfile,
  NodeConfig,
  SourceState,
  TelemetryField,
} from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconNode, IconPlus, IconReset, IconTrash } from "../icons";
import { Button } from "../ui/button";
import { Panel, PanelHeader } from "../ui/panel";
import { SourceStateBadge } from "../layout/status-badge";

/**
 * SETTINGS — a full page, not a dialog.
 *
 * Pointing the dashboard at a rover is set-up work, not a quick confirmation:
 * three addresses, their paths, their cadence, and a readout of what each one
 * is actually sending. That does not belong in a modal the operator has to
 * hold open while comparing it against a terminal. It opens in place like any
 * module, with the same Back control (§3), and everything needed to answer
 * "is the data arriving, and is it landing on the right page?" is on it.
 */

const TRANSPORTS: { id: NodeConfig["transport"]; label: string }[] = [
  { id: "http-poll", label: "HTTP poll" },
  { id: "websocket", label: "WebSocket" },
  { id: "none", label: "Stream only" },
];

const CAMERA_KINDS: { id: CameraKind; label: string }[] = [
  { id: "mjpeg", label: "MJPEG image" },
  { id: "whep", label: "WebRTC (WHEP)" },
];

const PROFILES: { id: MockProfile; label: string }[] = [
  { id: "vision", label: "Camera + AI" },
  { id: "thermal", label: "Thermal" },
  { id: "environment", label: "Environment" },
  { id: "motion", label: "Motion + drive" },
];

export function SettingsView() {
  const nodes = useNodes();
  const replaceAll = useNodeRegistry((state) => state.replaceAll);
  const resetToDefaults = useNodeRegistry((state) => state.resetToDefaults);

  const [draft, setDraft] = useState<NodeConfig[]>(nodes);
  const [seed, setSeed] = useState<NodeConfig[]>(nodes);
  const [dirty, setDirty] = useState(false);

  // Re-seed the form when the registry changes underneath it — an applied
  // edit, or a reset to defaults. Adjusting state during render is the
  // sanctioned pattern for this; an effect would render the stale form first.
  if (seed !== nodes) {
    setSeed(nodes);
    setDraft(nodes);
    setDirty(false);
  }

  function update(index: number, patch: Partial<NodeConfig>): void {
    setDraft((current) =>
      current.map((node, position) => (position === index ? { ...node, ...patch } : node)),
    );
    setDirty(true);
  }

  function addNode(): void {
    const index = draft.length + 1;
    setDraft((current) => [
      ...current,
      {
        id: `node${index}`,
        label: `Node ${index}`,
        baseUrl: "http://192.168.1.60",
        transport: "http-poll",
        telemetryPath: "/telemetry",
        expectedIntervalMs: 1000,
        enabled: true,
      },
    ]);
    setDirty(true);
  }

  function removeNode(index: number): void {
    setDraft((current) => current.filter((_, position) => position !== index));
    setDirty(true);
  }

  function apply(): void {
    const cleaned = draft.filter((node) => node.baseUrl.trim().length > 0);
    if (cleaned.length === 0) {
      toast.error("At least one node needs an address");
      return;
    }
    replaceAll(cleaned.map(normalise));
    setDirty(false);
    toast.success("Addresses applied — reconnecting");
  }

  // Nodes this page is structurally unable to reach, e.g. a hosted HTTPS
  // dashboard pointed at an http:// LAN address.
  const blocked = nodes.filter((node) => node.enabled && mixedContentBlocked(node.baseUrl));

  return (
    <div className="space-y-5">
      <DataModePanel blocked={blocked} />

      <Panel>
        <PanelHeader
          title="Rover nodes"
          hint="Telemetry can arrive from any number of addresses. Each node is polled on its own schedule and fails on its own."
          action={
            <Button size="sm" variant="ghost" onClick={addNode}>
              <IconPlus size={14} />
              Add node
            </Button>
          }
        />

        <div className="space-y-3">
          {draft.map((node, index) => (
            <NodeRow
              key={`${node.id}-${index}`}
              node={node}
              onChange={(patch) => update(index, patch)}
              onRemove={draft.length > 1 ? () => removeNode(index) : undefined}
            />
          ))}
        </div>

        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              resetToDefaults();
              toast.success("Addresses reset to defaults");
            }}
            title="Discard overrides and return to the compiled-in addresses"
          >
            <IconReset size={14} />
            Reset to defaults
          </Button>

          <div className="flex items-center gap-3">
            {dirty ? (
              <span className="text-xs text-warning">Unapplied changes</span>
            ) : null}
            <Button variant="primary" size="sm" onClick={apply} disabled={!dirty}>
              Apply addresses
            </Button>
          </div>
        </div>

        <p className="mt-3 text-[11px] text-faint-foreground">
          Every node must send{" "}
          <code className="rounded bg-surface-raised px-1 font-mono">
            Access-Control-Allow-Origin
          </code>{" "}
          for this dashboard&apos;s origin, and all nodes must share one scheme — a dashboard
          served over HTTPS cannot read an HTTP node.
        </p>
      </Panel>

      <LiveDataPanel />
      <RoutingPanel />
    </div>
  );
}

function normalise(node: NodeConfig): NodeConfig {
  const trimmed = node.baseUrl.trim();
  const baseUrl = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const path = node.telemetryPath.trim();
  return {
    ...node,
    baseUrl: baseUrl.replace(/\/$/, ""),
    telemetryPath: path === "" ? "" : path.startsWith("/") ? path : `/${path}`,
    cameraPath: pathOrUndefined(node.cameraPath),
    cameraKind: node.cameraKind ?? "mjpeg",
    thermalPath: pathOrUndefined(node.thermalPath),
  };
}

function pathOrUndefined(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
}

/* ------------------------------------------------------------------ */
/* Data mode                                                           */
/* ------------------------------------------------------------------ */

function DataModePanel({ blocked }: { blocked: NodeConfig[] }) {
  const mode = useDataModeStore((state) => state.mode);
  const setMode = useDataModeStore((state) => state.setMode);

  return (
    <Panel>
      <PanelHeader
        title="Data source"
        hint="Which rover the dashboard is looking at: the real one, or a simulated one running in this browser."
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <ModeCard
          active={mode === "real"}
          title="Real data"
          body="Connects to the node addresses below. A node that does not answer reads as offline — nothing is substituted for it."
          onSelect={() => setMode("real")}
        />
        <ModeCard
          active={mode === "mock"}
          title="Mock data"
          body="Runs a simulated rover in the browser. No address is contacted. Values stay within what the real sensors can report, and every frame is marked simulated."
          onSelect={() => setMode("mock")}
        />
      </div>

      <p className="mt-3 text-[11px] text-faint-foreground">
        Switching takes effect immediately and clears the current readings, so a value from one
        mode is never shown as if it came from the other.
      </p>

      {/*
        A hosted dashboard is served over HTTPS, and a browser refuses to let an
        HTTPS page read an http:// address. The request never reaches the
        network, so without this the node would simply read as offline forever
        and the address would look wrong when it is not. §12.1 rule 13.
      */}
      {blocked.length > 0 ? (
        <div className="mt-4 rounded-card border border-warning/40 bg-warning-soft/40 p-4">
          <p className="text-sm font-medium text-warning">
            This page is served over HTTPS and cannot reach a plain-HTTP node.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            The browser blocks the request before it leaves the machine, so{" "}
            {blocked.map((node) => node.label).join(", ")} will never answer from here, whatever
            the address says. Real data needs the dashboard and the nodes on one scheme: run it
            from the rover network over HTTP, or put HTTPS in front of the nodes. Mock data is
            unaffected.
          </p>
        </div>
      ) : null}
    </Panel>
  );
}

function ModeCard({
  active,
  title,
  body,
  onSelect,
}: {
  active: boolean;
  title: string;
  body: string;
  onSelect(): void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "rounded-card border p-4 text-left transition-state",
        active
          ? "border-primary/60 bg-primary/5"
          : "border-border bg-surface-raised hover:border-border-strong",
      )}
    >
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "size-3 rounded-full border-2",
            active ? "border-primary bg-primary" : "border-border-strong",
          )}
        />
        <span className="text-sm font-semibold text-foreground">{title}</span>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{body}</p>
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* One node                                                            */
/* ------------------------------------------------------------------ */

const STATE_DOT: Record<SourceState, string> = {
  ONLINE: "bg-normal",
  DEGRADED: "bg-warning",
  STALE: "bg-warning",
  OFFLINE: "bg-critical",
};

function NodeRow({
  node,
  onChange,
  onRemove,
}: {
  node: NodeConfig;
  onChange(patch: Partial<NodeConfig>): void;
  onRemove?: () => void;
}) {
  const health = useSourceHealthList().find((entry) => entry.id === node.id);
  const state: SourceState = health?.state ?? "OFFLINE";

  return (
    <div className="rounded-card border border-border bg-surface-raised p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <span className={cn("size-2 shrink-0 rounded-full", STATE_DOT[state])} title={state} />
        <input
          value={node.label}
          onChange={(event) => onChange({ label: event.target.value })}
          aria-label="Node name"
          className="min-w-40 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-foreground hover:border-border focus:border-primary/60 focus:outline-none"
        />

        <label className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <input
            type="checkbox"
            checked={node.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
            className="size-3.5 accent-[var(--color-primary)]"
          />
          Enabled
        </label>

        {onRemove ? (
          <button
            type="button"
            onClick={onRemove}
            aria-label={`Remove ${node.label}`}
            className="rounded-md p-1 text-muted-foreground transition-state hover:text-critical focus-visible:ring-2 focus-visible:ring-primary/60 focus-visible:outline-none"
          >
            <IconTrash size={14} />
          </button>
        ) : null}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Host address"
          value={node.baseUrl}
          placeholder="http://192.168.1.50:8000"
          onChange={(value) => onChange({ baseUrl: value })}
          wide
        />
        <Field
          label="Telemetry path"
          value={node.telemetryPath}
          placeholder="/api/sensors"
          onChange={(value) => onChange({ telemetryPath: value })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-faint-foreground uppercase">
            Transport
          </span>
          <select
            value={node.transport}
            onChange={(event) =>
              onChange({ transport: event.target.value as NodeConfig["transport"] })
            }
            className="h-9 rounded-md border border-border bg-background px-2 text-sm text-foreground focus:border-primary/60 focus:outline-none"
          >
            {TRANSPORTS.map((transport) => (
              <option key={transport.id} value={transport.id}>
                {transport.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Field
          label="Expected interval (ms)"
          value={String(node.expectedIntervalMs)}
          placeholder="1000"
          onChange={(value) => {
            const parsed = Number(value);
            onChange({ expectedIntervalMs: Number.isFinite(parsed) ? parsed : 1000 });
          }}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-faint-foreground uppercase">
            Camera path
          </span>
          <div className="flex gap-1.5">
            <input
              value={node.cameraPath ?? ""}
              placeholder={node.cameraKind === "whep" ? "/cam" : "/stream.mjpg"}
              spellCheck={false}
              aria-label="Camera path"
              onChange={(event) => onChange({ cameraPath: event.target.value })}
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-faint-foreground focus:border-primary/60 focus:outline-none"
            />
            <select
              value={node.cameraKind ?? "mjpeg"}
              aria-label="Camera stream type"
              onChange={(event) =>
                onChange({ cameraKind: event.target.value as CameraKind })
              }
              className="h-9 shrink-0 rounded-md border border-border bg-background px-1.5 text-xs text-foreground focus:border-primary/60 focus:outline-none"
            >
              {CAMERA_KINDS.map((kind) => (
                <option key={kind.id} value={kind.id}>
                  {kind.label}
                </option>
              ))}
            </select>
          </div>
          {node.cameraKind === "whep" ? (
            <span className="text-[10px] text-faint-foreground">
              MediaMTX: the stream name, e.g. /cam. The /whep suffix is added for you.
            </span>
          ) : null}
        </div>
        <Field
          label="Thermal image path"
          value={node.thermalPath ?? ""}
          placeholder="/thermal.mjpg"
          onChange={(value) => onChange({ thermalPath: value })}
        />
        <div className="flex flex-col gap-1">
          <span className="text-[11px] font-medium text-faint-foreground uppercase">
            Mock role
          </span>
          <div className="flex flex-wrap gap-1.5">
            {PROFILES.map((profile) => {
              const active = node.mockProfiles?.includes(profile.id) ?? false;
              return (
                <button
                  key={profile.id}
                  type="button"
                  onClick={() => {
                    const current = node.mockProfiles ?? [];
                    onChange({
                      mockProfiles: active
                        ? current.filter((entry) => entry !== profile.id)
                        : [...current, profile.id],
                    });
                  }}
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] transition-state",
                    active
                      ? "border-primary/50 bg-primary/10 text-primary"
                      : "border-border text-muted-foreground hover:border-border-strong",
                  )}
                >
                  {profile.label}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <p className="mt-2 truncate font-mono text-[11px] text-faint-foreground">
        {node.baseUrl || "http://…"}
        {node.telemetryPath}
        {health?.lastError ? ` · ${health.lastError}` : ""}
      </p>

      {mixedContentBlocked(node.baseUrl) ? (
        <p className="mt-1 text-[11px] text-warning">
          Blocked by the browser: this page is HTTPS and this address is HTTP.
        </p>
      ) : null}
    </div>
  );
}

function Field({
  label,
  value,
  placeholder,
  onChange,
  wide = false,
}: {
  label: string;
  value: string;
  placeholder?: string;
  onChange(value: string): void;
  wide?: boolean;
}) {
  return (
    <div className={cn("flex flex-col gap-1", wide && "lg:col-span-2")}>
      <span className="text-[11px] font-medium text-faint-foreground uppercase">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        spellCheck={false}
        onChange={(event) => onChange(event.target.value)}
        className="h-9 rounded-md border border-border bg-background px-2.5 text-sm text-foreground placeholder:text-faint-foreground focus:border-primary/60 focus:outline-none"
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* What is actually arriving                                           */
/* ------------------------------------------------------------------ */

/**
 * The answer to "I pointed it at my IP, is anything happening?".
 *
 * Per node: state, age of the last frame, the fields it delivered, and any
 * keys the ingest layer did not recognise — so an unmapped payload is visible
 * here instead of silently missing from a module.
 */
function LiveDataPanel() {
  const health = useSourceHealthList();
  // Re-render on every ingest so this reads as live.
  useTelemetry((state) => state.revision);

  return (
    <Panel>
      <PanelHeader
        title="What each node is sending"
        hint="Recognised values are routed to the module that owns them, whichever node sent them."
      />

      <div className="space-y-3">
        {health.map((node) => (
          <div key={node.id} className="rounded-card border border-border bg-surface-raised p-4">
            <div className="flex flex-wrap items-center gap-2">
              <IconNode size={16} weight="duotone" className="text-muted-foreground" />
              <span className="text-sm font-medium text-foreground">{node.label}</span>
              <SourceStateBadge state={node.state} className="ml-auto" />
              <span className="text-[11px] text-faint-foreground">
                {formatAge(node.lastUpdateAt)}
              </span>
            </div>

            {node.fields.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {node.fields.map((field) => (
                  <span
                    key={field}
                    className="rounded-full bg-normal-soft px-2 py-0.5 text-[11px] text-normal"
                  >
                    {fieldLabel(field as TelemetryField)}
                  </span>
                ))}
              </div>
            ) : (
              <p className="mt-3 text-xs text-muted-foreground">
                {node.lastError
                  ? `Nothing recognised yet — ${node.lastError}`
                  : "No payload received yet."}
              </p>
            )}

            {node.unknownKeys.length > 0 ? (
              <div className="mt-3 border-t border-border pt-2">
                <p className="text-[11px] tracking-wide text-faint-foreground uppercase">
                  Keys not recognised
                </p>
                <p className="mt-1 font-mono text-[11px] break-words text-muted-foreground">
                  {node.unknownKeys.join(", ")}
                </p>
                <p className="mt-1 text-[11px] text-faint-foreground">
                  These are ignored rather than guessed at. Rename them to a known sensor key, or
                  add an alias in <span className="font-mono">src/lib/ingest.ts</span>.
                </p>
              </div>
            ) : null}
          </div>
        ))}

        {health.length === 0 ? (
          <p className="rounded-card border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
            No nodes are enabled.
          </p>
        ) : null}
      </div>
    </Panel>
  );
}

/* ------------------------------------------------------------------ */
/* Field routing                                                       */
/* ------------------------------------------------------------------ */

const MODULE_LABEL: Record<string, string> = {
  vision: "Vision & Detection",
  thermal: "Thermal Intelligence",
  map: "Mission Map",
  environment: "Environment Safety",
  personnel: "Personnel Tracking",
  health: "Rover Health",
  control: "Drive Status",
  reports: "Mission Reports",
};

/**
 * The whole contract on one screen: every value the dashboard can display,
 * the component that produces it, the page it appears on, and which node is
 * currently supplying it. Anything not in this table is not displayed.
 */
function RoutingPanel() {
  const owners = useTelemetry((state) => state.fieldOwners);
  const health = useSourceHealthList();

  function ownerLabel(field: TelemetryField): string {
    const id = owners[field];
    if (!id) return "—";
    return health.find((entry) => entry.id === id)?.label ?? id;
  }

  return (
    <Panel>
      <PanelHeader
        title="Where each value lands"
        hint="Routing is by payload content, not by host — the sender decides nothing about which page shows it."
      />

      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] border-collapse text-left text-xs">
          <thead>
            <tr className="text-[11px] tracking-wide text-faint-foreground uppercase">
              <th className="py-2 pr-4 font-medium">Value</th>
              <th className="py-2 pr-4 font-medium">Component</th>
              <th className="py-2 pr-4 font-medium">Shown on</th>
              <th className="py-2 font-medium">Supplied by</th>
            </tr>
          </thead>
          <tbody>
            {FIELD_CATALOG.map((entry) => {
              const live = Boolean(owners[entry.field]);
              return (
                <tr key={entry.field} className="border-t border-border">
                  <td className="py-2 pr-4 text-foreground">{entry.label}</td>
                  <td className="py-2 pr-4 text-muted-foreground">{entry.component}</td>
                  <td className="py-2 pr-4 text-muted-foreground">
                    {MODULE_LABEL[entry.module] ?? entry.module}
                  </td>
                  <td
                    className={cn(
                      "py-2 font-mono",
                      live ? "text-normal" : "text-faint-foreground",
                    )}
                  >
                    {ownerLabel(entry.field)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-3 text-[11px] text-faint-foreground">
        A value with no supplier is shown as unavailable on its page — never as zero, and never as
        a stale reading styled as live.
      </p>
    </Panel>
  );
}
