import { useEffect, useRef } from "react";
import type { Hotspot, ThermalFrame } from "../../lib/types";

/**
 * Thermal frame rendering. §4.2
 *
 * Canvas, not a chart library. Colours cross-fade between frames rather than
 * re-entering, so a new telemetry frame never flashes the view.
 * §9.1 motion rule 5.
 */

export type Palette = "iron" | "rainbow" | "whiteHot" | "blackHot" | "lava" | "arctic";

export const PALETTES: { id: Palette; label: string }[] = [
  { id: "iron", label: "Iron" },
  { id: "rainbow", label: "Rainbow" },
  { id: "whiteHot", label: "White-hot" },
  { id: "blackHot", label: "Black-hot" },
  { id: "lava", label: "Lava" },
  { id: "arctic", label: "Arctic" },
];

/** t in 0..1 -> [r, g, b]. */
function sample(palette: Palette, t: number): [number, number, number] {
  const clamped = Math.min(1, Math.max(0, t));
  switch (palette) {
    case "whiteHot": {
      const v = Math.round(clamped * 255);
      return [v, v, v];
    }
    case "blackHot": {
      const v = Math.round((1 - clamped) * 255);
      return [v, v, v];
    }
    case "iron":
      return [
        Math.round(255 * Math.min(1, clamped * 1.6)),
        Math.round(255 * Math.max(0, clamped * 1.3 - 0.35)),
        Math.round(255 * Math.max(0, clamped * 1.1 - 0.7)),
      ];
    case "lava":
      return [
        Math.round(255 * Math.min(1, 0.25 + clamped * 1.2)),
        Math.round(255 * Math.max(0, clamped * 1.5 - 0.6)),
        Math.round(255 * Math.max(0, clamped * 0.6 - 0.55)),
      ];
    case "arctic":
      return [
        Math.round(255 * Math.max(0, clamped * 1.2 - 0.45)),
        Math.round(255 * Math.min(1, 0.2 + clamped)),
        Math.round(255 * Math.min(1, 0.45 + clamped * 0.8)),
      ];
    case "rainbow": {
      const hue = (1 - clamped) * 240;
      const c = 1;
      const x = 1 - Math.abs(((hue / 60) % 2) - 1);
      const [r, g, b] =
        hue < 60
          ? [c, x, 0]
          : hue < 120
            ? [x, c, 0]
            : hue < 180
              ? [0, c, x]
              : [0, x, c];
      return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
    }
    default:
      return [0, 0, 0];
  }
}

export type { ThermalFrame };

export function ThermalCanvas({
  frame,
  palette,
  hotspots,
  stale,
}: {
  frame: ThermalFrame | null;
  palette: Palette;
  hotspots: Hotspot[];
  stale: boolean;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !frame) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = frame.width;
    canvas.height = frame.height;

    let min = Number.POSITIVE_INFINITY;
    let max = Number.NEGATIVE_INFINITY;
    for (const cell of frame.cells) {
      if (cell < min) min = cell;
      if (cell > max) max = cell;
    }
    const span = max - min || 1;

    const image = context.createImageData(frame.width, frame.height);
    for (let i = 0; i < frame.cells.length; i += 1) {
      const [r, g, b] = sample(palette, (frame.cells[i] - min) / span);
      image.data[i * 4] = r;
      image.data[i * 4 + 1] = g;
      image.data[i * 4 + 2] = b;
      image.data[i * 4 + 3] = 255;
    }
    context.putImageData(image, 0, 0);
  }, [frame, palette]);

  return (
    // Capped by viewport height as well as column width: a 32x24 frame in a
    // wide column would otherwise push the palette controls off the screen.
    <div className="relative mx-auto aspect-[4/3] w-full max-w-[calc(58vh*4/3)] overflow-hidden rounded-xl bg-black">
      {frame ? (
        <canvas
          ref={canvasRef}
          className="h-full w-full"
          // Thermal data is low-resolution by nature: keep the cells crisp
          // rather than letting the browser invent detail.
          style={{
            imageRendering: "pixelated",
            opacity: stale ? 0.6 : 1,
            transition: "opacity var(--duration-state) var(--ease-standard)",
          }}
        />
      ) : (
        <div className="flex h-full items-center justify-center text-sm text-white/50">
          No thermal frame
        </div>
      )}

      {hotspots.map((hotspot, index) => (
        <div
          key={`${hotspot.x}-${hotspot.y}-${index}`}
          className="absolute -translate-x-1/2 -translate-y-1/2"
          style={{ left: `${hotspot.x * 100}%`, top: `${hotspot.y * 100}%` }}
        >
          <span
            className={
              hotspot.humanLike
                ? "block size-6 rounded-full border-2 border-white pulse-critical"
                : "block size-4 rounded-full border-2 border-white/70"
            }
          />
          <span className="tabular mt-1 block font-mono text-[10px] whitespace-nowrap text-white drop-shadow">
            {hotspot.celsius.toFixed(1)}°C
          </span>
        </div>
      ))}
    </div>
  );
}

export function PaletteLegend({ palette }: { palette: Palette }) {
  const stops = Array.from({ length: 12 }, (_, index) => {
    const [r, g, b] = sample(palette, index / 11);
    return `rgb(${r},${g},${b})`;
  });
  return (
    <div
      className="h-2 w-full rounded-full"
      style={{ background: `linear-gradient(to right, ${stops.join(",")})` }}
    />
  );
}
