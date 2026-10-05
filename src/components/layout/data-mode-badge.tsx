import { useDataModeStore } from "../../lib/data-mode";
import { cn } from "../../lib/utils";
import { IconLive, IconMock } from "../icons";

/**
 * The mock/real switch, and the standing reminder of which one is on.
 *
 * It is a toggle rather than a status chip because flipping it is a one-click
 * operation the operator does often while bringing a rover up. It is also
 * deliberately loud in mock mode: a simulated reading that reads as live
 * telemetry is the one failure this whole feature could introduce, so the
 * badge stays visible on every screen while mock data is running.
 */
export function DataModeBadge({ onOpenSettings }: { onOpenSettings?: () => void }) {
  const mode = useDataModeStore((state) => state.mode);
  const toggle = useDataModeStore((state) => state.toggle);
  const mock = mode === "mock";
  const Icon = mock ? IconMock : IconLive;

  return (
    <div className="flex items-center">
      <button
        type="button"
        onClick={toggle}
        title={
          mock
            ? "Mock data: a simulated rover running in this browser. Click to use the real node addresses."
            : "Real data: connected to the configured node addresses. Click to switch to mock data."
        }
        aria-label={mock ? "Switch to real data" : "Switch to mock data"}
        className={cn(
          "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold tracking-wide uppercase transition-state",
          mock
            ? "border-warning/50 bg-warning-soft text-warning"
            : "border-border bg-surface-raised text-muted-foreground hover:border-border-strong",
        )}
      >
        <Icon size={13} weight="bold" />
        {mock ? "Mock data" : "Live data"}
      </button>

      {/* In mock mode, say plainly where to change it. */}
      {mock && onOpenSettings ? (
        <button
          type="button"
          onClick={onOpenSettings}
          className="ml-1 hidden text-[11px] text-faint-foreground underline-offset-2 transition-state hover:text-foreground hover:underline lg:inline"
        >
          simulated
        </button>
      ) : null}
    </div>
  );
}
