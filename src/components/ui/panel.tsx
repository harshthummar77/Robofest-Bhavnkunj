import type { ComponentProps, ReactNode } from "react";
import { cn } from "../../lib/utils";

/** Generic surface. Large cards, generous spacing, strong hierarchy. §9 */
export function Panel({ className, ...props }: ComponentProps<"div">) {
  return (
    <div
      className={cn(
        "rounded-card border border-border bg-surface p-5 shadow-sm",
        className,
      )}
      {...props}
    />
  );
}

export function PanelHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <h3 className="text-sm font-semibold tracking-wide text-foreground uppercase">
          {title}
        </h3>
        {hint ? <p className="mt-1 text-xs text-muted-foreground">{hint}</p> : null}
      </div>
      {action}
    </div>
  );
}

/**
 * Exact technical values, kept available but never the primary experience.
 * §2 rule 6 / §4.4.
 */
export function TechnicalDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-xs">
      <span className="text-faint-foreground">{label}</span>
      <span className="tabular font-mono text-muted-foreground">{value}</span>
    </div>
  );
}
