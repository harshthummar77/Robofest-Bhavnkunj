import { useEffect, useMemo, useRef } from "react";
import type { MissionEvent, Pose } from "../../lib/types";

/**
 * Mission Map rendering. §4.3
 *
 * The rover marker moves continuously and the travelled route draws behind it.
 * Pose updates are interpolated frame-to-frame rather than snapped, so a new
 * telemetry frame never makes the map jump. §9.1 motion rule 5.
 *
 * Coordinates are metres in the mission frame, origin at the mission start
 * point. This is NOT a GPS projection: GPS alone is not sufficient underground
 * (§4.3), so the map consumes whatever pose the motion node reports.
 */

const PADDING = 48;

export interface MapTheme {
  background: string;
  grid: string;
  route: string;
  rover: string;
  start: string;
  text: string;
}

function levelColour(level: MissionEvent["level"]): string {
  switch (level) {
    case "CRITICAL":
      return "#ef4444";
    case "WARNING":
      return "#f97316";
    case "ATTENTION":
      return "#eab308";
    case "NORMAL":
      return "#22c55e";
    default:
      return "#94a3b8";
  }
}

export function MissionMapCanvas({
  path,
  pose,
  events,
  theme,
  stale,
  onPickEvent,
  replayIndex,
}: {
  path: Pose[];
  pose: Pose | null;
  /** Events with a location become map markers. §4.3 */
  events: MissionEvent[];
  theme: MapTheme;
  stale: boolean;
  onPickEvent?(event: MissionEvent): void;
  /** When set, the route is drawn only up to this index (mission replay). */
  replayIndex?: number | null;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  /** Smoothed rover position, so the marker glides between pose updates. */
  const smoothed = useRef<Pose | null>(null);
  const frameRef = useRef<number>(0);
  const markersRef = useRef<{ x: number; y: number; event: MissionEvent }[]>([]);

  const visiblePath = useMemo(
    () => (replayIndex == null ? path : path.slice(0, Math.max(1, replayIndex))),
    [path, replayIndex],
  );

  const bounds = useMemo(() => {
    const points = [...path, ...events.map((event) => event.pose).filter(Boolean)] as Pose[];
    if (points.length === 0) {
      return { minX: -5, maxX: 5, minY: -5, maxY: 5 };
    }
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const point of points) {
      minX = Math.min(minX, point.x);
      maxX = Math.max(maxX, point.x);
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
    }
    // Keep a minimum window so an early mission does not render zoomed to a dot.
    const spanX = Math.max(maxX - minX, 8);
    const spanY = Math.max(maxY - minY, 8);
    const centreX = (minX + maxX) / 2;
    const centreY = (minY + maxY) / 2;
    return {
      minX: centreX - spanX / 2,
      maxX: centreX + spanX / 2,
      minY: centreY - spanY / 2,
      maxY: centreY + spanY / 2,
    };
  }, [path, events]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    let running = true;

    function draw() {
      if (!running || !canvas || !container) return;

      const ratio = window.devicePixelRatio || 1;
      const width = container.clientWidth;
      const height = container.clientHeight;
      if (canvas.width !== width * ratio || canvas.height !== height * ratio) {
        canvas.width = width * ratio;
        canvas.height = height * ratio;
      }

      const context = canvas.getContext("2d");
      if (!context) return;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.clearRect(0, 0, width, height);

      const scaleX = (width - PADDING * 2) / (bounds.maxX - bounds.minX);
      const scaleY = (height - PADDING * 2) / (bounds.maxY - bounds.minY);
      const scale = Math.min(scaleX, scaleY);

      const toScreen = (point: Pose | { x: number; y: number }) => ({
        x: PADDING + (point.x - bounds.minX) * scale,
        // Screen y is inverted: mission north points up.
        y: height - PADDING - (point.y - bounds.minY) * scale,
      });

      context.fillStyle = theme.background;
      context.fillRect(0, 0, width, height);

      // Grid, one line per metre-ish step, scaled to stay readable.
      const step = Math.max(1, Math.round((bounds.maxX - bounds.minX) / 10));
      context.strokeStyle = theme.grid;
      context.lineWidth = 1;
      for (let x = Math.ceil(bounds.minX); x <= bounds.maxX; x += step) {
        const start = toScreen({ x, y: bounds.minY });
        const end = toScreen({ x, y: bounds.maxY });
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }
      for (let y = Math.ceil(bounds.minY); y <= bounds.maxY; y += step) {
        const start = toScreen({ x: bounds.minX, y });
        const end = toScreen({ x: bounds.maxX, y });
        context.beginPath();
        context.moveTo(start.x, start.y);
        context.lineTo(end.x, end.y);
        context.stroke();
      }

      // Travelled route.
      if (visiblePath.length > 1) {
        context.strokeStyle = theme.route;
        context.lineWidth = 3;
        context.lineJoin = "round";
        context.lineCap = "round";
        context.globalAlpha = stale ? 0.5 : 1;
        context.beginPath();
        visiblePath.forEach((point, index) => {
          const screen = toScreen(point);
          if (index === 0) context.moveTo(screen.x, screen.y);
          else context.lineTo(screen.x, screen.y);
        });
        context.stroke();
        context.globalAlpha = 1;
      }

      // Mission start point.
      if (path.length > 0) {
        const start = toScreen(path[0]);
        context.fillStyle = theme.start;
        context.beginPath();
        context.arc(start.x, start.y, 6, 0, Math.PI * 2);
        context.fill();
        context.fillStyle = theme.text;
        context.font = "11px ui-sans-serif, system-ui";
        context.fillText("START", start.x + 10, start.y + 4);
      }

      // Event markers. Hit areas are recorded for click handling.
      markersRef.current = [];
      for (const event of events) {
        if (!event.pose) continue;
        const screen = toScreen(event.pose);
        markersRef.current.push({ x: screen.x, y: screen.y, event });
        context.fillStyle = levelColour(event.level);
        context.beginPath();
        context.arc(screen.x, screen.y, 7, 0, Math.PI * 2);
        context.fill();
        context.strokeStyle = theme.background;
        context.lineWidth = 2;
        context.stroke();
      }

      // Rover marker: interpolate toward the reported pose.
      if (pose) {
        if (!smoothed.current) {
          smoothed.current = { ...pose };
        } else {
          const ease = 0.18;
          smoothed.current = {
            x: smoothed.current.x + (pose.x - smoothed.current.x) * ease,
            y: smoothed.current.y + (pose.y - smoothed.current.y) * ease,
            heading:
              smoothed.current.heading +
              (pose.heading - smoothed.current.heading) * ease,
          };
        }

        const screen = toScreen(smoothed.current);
        const radians = ((smoothed.current.heading - 90) * Math.PI) / 180;

        context.save();
        context.translate(screen.x, screen.y);
        context.rotate(radians);
        context.fillStyle = stale ? theme.grid : theme.rover;
        context.beginPath();
        context.moveTo(14, 0);
        context.lineTo(-9, 8);
        context.lineTo(-5, 0);
        context.lineTo(-9, -8);
        context.closePath();
        context.fill();
        context.restore();
      }

      frameRef.current = requestAnimationFrame(draw);
    }

    frameRef.current = requestAnimationFrame(draw);
    return () => {
      running = false;
      cancelAnimationFrame(frameRef.current);
    };
  }, [bounds, events, path, pose, stale, theme, visiblePath]);

  return (
    <div ref={containerRef} className="relative h-full min-h-[22rem] w-full">
      <canvas
        ref={canvasRef}
        className="h-full w-full rounded-xl"
        onClick={(domEvent) => {
          if (!onPickEvent) return;
          const rect = domEvent.currentTarget.getBoundingClientRect();
          const x = domEvent.clientX - rect.left;
          const y = domEvent.clientY - rect.top;
          // Clicking an event on the map opens its details. §4.3
          const hit = markersRef.current.find(
            (marker) => Math.hypot(marker.x - x, marker.y - y) <= 12,
          );
          if (hit) onPickEvent(hit.event);
        }}
      />
    </div>
  );
}
