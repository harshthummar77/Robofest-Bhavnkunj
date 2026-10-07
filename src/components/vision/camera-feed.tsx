import { useEffect, useRef, useState } from "react";
import { rgbCamera, useNodes } from "../../config/nodes";
import { IconAudioOff, IconAudioOn } from "../icons";
import { useIsMockMode } from "../../lib/data-mode";
import { startWhep, type WhepState, type WhepStats } from "../../lib/webrtc/whep";
import type { Detection } from "../../lib/types";
import { cn } from "../../lib/utils";

/**
 * The RGB surface, and the detection overlay that belongs on top of it.
 *
 * In real mode this is whatever the camera node publishes — an MJPEG image
 * stream consumed directly by an <img>, or a WebRTC stream from a WHEP server
 * such as MediaMTX. Either way it is consumed as media, never through the
 * telemetry channel (PROJECT_CONTEXT.md §12).
 *
 * In mock mode it plays recorded rover footage. That footage was captured from
 * the Pi Camera 3 with the detector running, so it already carries its own
 * boxes — drawing the simulated ones over it would put two disagreeing sets of
 * boxes on one picture, which reads as a bug. The overlay therefore lives here
 * rather than in each view, so one place decides whether the source draws its
 * own.
 *
 * The frame is marked SIMULATED whenever this is not the rover's live camera,
 * because recorded footage of a real corridor is exactly the thing that could
 * be mistaken for a live feed.
 */
/**
 * What the dashboard knows about the stream first-hand.
 *
 * Everything here is observed in the browser — the session state, whether a
 * microphone track arrived, and the decoder's own numbers. None of it comes
 * from rover telemetry, so a view may show it even when no node is reporting
 * anything.
 */
export interface CameraStatus {
  state: WhepState;
  audio: boolean;
  stats: WhepStats | null;
}

export function CameraFeed({
  detections,
  stale,
  className,
  onStatus,
}: {
  detections: Detection[];
  stale: boolean;
  className?: string;
  /**
   * Observed here, in the browser, about once a second — never reported by the
   * rover. A view that shows these numbers has to say so. `null` means there is
   * no stream of this kind to observe.
   */
  onStatus?(status: CameraStatus | null): void;
}) {
  const mock = useIsMockMode();
  const nodes = useNodes();
  const camera = rgbCamera(nodes.filter((node) => node.enabled));

  if (mock) {
    // Mock mode is a rehearsal of the real thing, so it reports the same
    // status and carries the same controls: the two modes must not differ in
    // what the operator sees, only in where the picture came from.
    return <MockCamera detections={detections} className={className} onStatus={onStatus} />;
  }

  if (!camera) {
    return (
      <div
        className={cn(
          "flex h-full w-full items-center justify-center bg-black px-6 text-center text-sm text-white/55",
          className,
        )}
      >
        No camera configured — set a camera path on a node in Settings.
      </div>
    );
  }

  return (
    <div className={cn("relative h-full w-full bg-black", className)}>
      {camera.kind === "whep" ? (
        <WebRtcFeed url={camera.url} stale={stale} onStatus={onStatus} />
      ) : (
        <img
          src={camera.url}
          alt="Live RGB feed from the rover camera"
          className={cn(
            "h-full w-full object-cover transition-state",
            stale && "opacity-60 saturate-50",
          )}
        />
      )}
      <DetectionOverlay detections={detections} stale={stale} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Detection overlay                                                   */
/* ------------------------------------------------------------------ */

/** AI overlays. The box appears, then the ID locks in. §9 */
function DetectionOverlay({ detections, stale }: { detections: Detection[]; stale: boolean }) {
  return (
    <>
      {detections.map((detection, index) => {
        const person = !detection.label || detection.label === "person";
        return (
          <div
            key={`${detection.personId}-${index}`}
            className={cn(
              "absolute rounded-md border-2 transition-layout",
              stale ? "border-warning/70" : person ? "border-critical" : "border-attention",
            )}
            style={{
              left: `${detection.box.x * 100}%`,
              top: `${detection.box.y * 100}%`,
              width: `${detection.box.w * 100}%`,
              height: `${detection.box.h * 100}%`,
            }}
          >
            <span
              className={cn(
                "absolute -top-6 left-0 rounded px-1.5 py-0.5 font-mono text-[11px] font-semibold text-white",
                stale ? "bg-warning/90" : person ? "bg-critical" : "bg-attention",
              )}
            >
              {detection.personId}
            </span>
          </div>
        );
      })}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* WebRTC                                                              */
/* ------------------------------------------------------------------ */

/** How long to wait before retrying a stream that failed to start. */
const RETRY_MS = 4000;

/** How often playback is sampled — the same cadence in both modes. */
const STATS_INTERVAL_MS = 1000;

function WebRtcFeed({
  url,
  stale,
  onStatus,
}: {
  url: string;
  stale: boolean;
  onStatus?(status: CameraStatus | null): void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<WhepState>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  // Bumped to force a fresh session after a failure.
  const [attempt, setAttempt] = useState(0);
  // Whether the rover path actually carries sound. No control is shown until
  // it does, so the operator is never offered a button that does nothing.
  const [hasAudio, setHasAudio] = useState(false);
  // Starts muted: browsers only autoplay muted media, and sound arriving
  // unasked in a control room is its own kind of fault.
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState<WhepStats | null>(null);

  // Held in a ref: the session is torn down and rebuilt by the effect below,
  // and a parent that passes an inline callback must not cause a reconnect.
  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setHasAudio(false);
    setStats(null);

    const session = startWhep(url, video, {
      onState(next, why) {
        setState(next);
        setDetail(why ?? null);
      },
      onAudio: setHasAudio,
      onStats: setStats,
    });

    return () => {
      session.close();
      // The numbers belonged to that session; leaving them on screen would
      // turn a dead stream into a plausible-looking live one.
      statusRef.current?.(null);
    };
  }, [url, attempt]);

  // One report upward whenever anything observed changes.
  useEffect(() => {
    statusRef.current?.({ state, audio: hasAudio, stats });
  }, [state, hasAudio, stats]);

  // The element is the source of truth for mute, and it is replaced on every
  // reconnect, so the choice is reapplied rather than set once on click.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted, state, hasAudio]);

  // A camera that drops out must come back on its own: the pilot has both
  // hands on the transmitter and cannot reload a page. §4.9
  useEffect(() => {
    if (state !== "failed") return;
    const timer = setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <>
      <video
        ref={videoRef}
        // Muted and playsInline so the browser allows autoplay. The operator
        // can unmute once the stream is up, if it carries a microphone.
        muted
        playsInline
        autoPlay
        className={cn(
          "h-full w-full object-cover transition-state",
          (stale || state !== "live") && "opacity-60",
        )}
      />

      {hasAudio && state === "live" ? (
        <AudioToggle
          muted={muted}
          onToggle={() => {
            const video = videoRef.current;
            setMuted((wasMuted) => !wasMuted);
            // Unmuting counts as the user gesture a blocked stream was waiting
            // for, so nudge playback rather than leaving a stalled picture.
            if (video) void video.play().catch(() => undefined);
          }}
        />
      ) : null}

      {state !== "live" ? (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-1 text-center">
          <p className="text-sm text-white/70">
            {state === "connecting" ? "Connecting to the camera…" : "Camera stream unavailable"}
          </p>
          {detail ? <p className="text-[11px] text-white/45">{detail}</p> : null}
          {state === "failed" ? (
            <p className="text-[11px] text-white/45">Retrying automatically.</p>
          ) : null}
        </div>
      ) : null}
    </>
  );
}

/**
 * Mute control for a camera path that carries the rover microphone.
 *
 * It states the current condition rather than the action, because silence and
 * a silent feed look identical: the operator has to be able to tell whether
 * there is nothing to hear or nothing being played.
 */
function AudioToggle({ muted, onToggle }: { muted: boolean; onToggle(): void }) {
  const Icon = muted ? IconAudioOff : IconAudioOn;
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!muted}
      aria-label={muted ? "Unmute the camera audio" : "Mute the camera audio"}
      className="absolute right-3 bottom-3 z-20 inline-flex items-center gap-2 rounded-xl bg-black/65 px-3 py-2 text-[11px] font-semibold tracking-[0.12em] text-white/85 uppercase backdrop-blur transition-state outline-none hover:bg-black/80 hover:text-white focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Icon size={16} weight="bold" />
      {muted ? "Muted" : "Audio on"}
    </button>
  );
}

/* ------------------------------------------------------------------ */
/* Mock camera                                                         */
/* ------------------------------------------------------------------ */

/**
 * Recorded rover footage, served from `public/`.
 *
 * It already carries the detector's own boxes, so the simulated overlay is
 * suppressed while it plays. The simulated detections still run the rest of
 * the chain — person records, map markers, alerts, the report — they just are
 * not drawn a second time on a picture that disagrees with them.
 */
const MOCK_VIDEO = "/mock-camera.mp4";

function MockCamera({
  detections,
  className,
  onStatus,
}: {
  detections: Detection[];
  className?: string;
  onStatus?(status: CameraStatus | null): void;
}) {
  // If the footage is missing from a checkout, fall back to the drawn scene
  // rather than a black rectangle.
  const [videoFailed, setVideoFailed] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(true);
  const [stats, setStats] = useState<WhepStats | null>(null);

  const statusRef = useRef(onStatus);
  useEffect(() => {
    statusRef.current = onStatus;
  }, [onStatus]);

  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted, videoFailed]);

  // The same numbers the live feed reports, read off the element that is
  // actually playing: decoded frames per second and the frame size. They are
  // measurements of this picture rather than invented figures — the picture
  // just happens to be a recording, which the badge says plainly.
  useEffect(() => {
    if (videoFailed) {
      setStats(null);
      return;
    }
    let previous: { frames: number; at: number } | null = null;
    const timer = setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const quality = video.getVideoPlaybackQuality?.();
      const now = performance.now();
      let fps: number | null = null;
      if (quality) {
        if (previous && now > previous.at) {
          fps = ((quality.totalVideoFrames - previous.frames) * 1000) / (now - previous.at);
        }
        previous = { frames: quality.totalVideoFrames, at: now };
      }
      setStats({
        fps,
        width: video.videoWidth || null,
        height: video.videoHeight || null,
        kbps: null,
        packetsLost: null,
      });
    }, STATS_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [videoFailed]);

  useEffect(() => {
    statusRef.current?.({ state: "live", audio: true, stats });
  }, [stats]);

  useEffect(() => () => statusRef.current?.(null), []);

  if (videoFailed) {
    return <MockCameraScene detections={detections} className={className} />;
  }

  return (
    <div className={cn("relative h-full w-full bg-black", className)}>
      <video
        ref={videoRef}
        src={MOCK_VIDEO}
        autoPlay
        loop
        muted
        playsInline
        onError={() => setVideoFailed(true)}
        className="h-full w-full object-cover"
      />
      {/* Same control, same place as on the live feed. */}
      <AudioToggle
        muted={muted}
        onToggle={() => {
          const video = videoRef.current;
          setMuted((wasMuted) => !wasMuted);
          if (video) void video.play().catch(() => undefined);
        }}
      />
      <SimulatedBadge />
    </div>
  );
}

function SimulatedBadge() {
  return (
    <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-warning uppercase">
      Simulated camera
    </span>
  );
}

/* ------------------------------------------------------------------ */
/* Drawn fallback scene                                                */
/* ------------------------------------------------------------------ */

const WIDTH = 640;
const HEIGHT = 360;

function MockCameraScene({
  detections,
  className,
}: {
  detections: Detection[];
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  // The animation loop reads detections through a ref, so a new telemetry
  // frame updates what is drawn without restarting the loop. Motion rule 5:
  // live data must never cause a re-entry animation.
  const latest = useRef<Detection[]>(detections);
  useEffect(() => {
    latest.current = detections;
  }, [detections]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;

    canvas.width = WIDTH;
    canvas.height = HEIGHT;

    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let raf = 0;

    function draw(): void {
      frame += reduceMotion ? 0 : 1;
      const depth = frame * 0.9;

      const gradient = context!.createLinearGradient(0, 0, 0, HEIGHT);
      gradient.addColorStop(0, "#0a1119");
      gradient.addColorStop(0.55, "#111c27");
      gradient.addColorStop(1, "#060a0f");
      context!.fillStyle = gradient;
      context!.fillRect(0, 0, WIDTH, HEIGHT);

      // Tunnel walls: rings receding to a vanishing point, advancing forward.
      const centreX = WIDTH / 2;
      const centreY = HEIGHT * 0.52;
      context!.lineWidth = 1;
      for (let ring = 0; ring < 14; ring += 1) {
        const t = ((ring * 40 + depth) % 560) / 560;
        const scale = t * t;
        const width_ = scale * WIDTH * 1.5;
        const height_ = scale * HEIGHT * 1.5;
        context!.strokeStyle = `rgba(96, 165, 250, ${0.05 + t * 0.2})`;
        context!.beginPath();
        context!.rect(centreX - width_ / 2, centreY - height_ / 2, width_, height_);
        context!.stroke();
      }

      // Floor lines, for a sense of travel.
      context!.strokeStyle = "rgba(148, 163, 184, 0.14)";
      for (let lane = -3; lane <= 3; lane += 1) {
        context!.beginPath();
        context!.moveTo(centreX + lane * 14, centreY);
        context!.lineTo(centreX + lane * 150, HEIGHT);
        context!.stroke();
      }

      // A figure wherever the simulated detector says there is one.
      for (const detection of latest.current) {
        if (detection.label && detection.label !== "person") continue;
        drawFigure(
          context!,
          detection.box.x * WIDTH,
          detection.box.y * HEIGHT,
          detection.box.w * WIDTH,
          detection.box.h * HEIGHT,
        );
      }

      raf = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className={cn("relative h-full w-full bg-black", className)}>
      <canvas ref={canvasRef} className="h-full w-full object-cover" />
      {/* The drawn scene has no boxes of its own, so the overlay belongs here. */}
      <DetectionOverlay detections={detections} stale={false} />
      <SimulatedBadge />
    </div>
  );
}

/** A crude human silhouette — enough to read as a person, honest about being drawn. */
function drawFigure(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
): void {
  const centreX = x + width / 2;
  const headRadius = width * 0.22;

  context.save();
  context.fillStyle = "rgba(226, 232, 240, 0.82)";

  context.beginPath();
  context.arc(centreX, y + headRadius, headRadius, 0, Math.PI * 2);
  context.fill();

  context.beginPath();
  context.moveTo(centreX - width * 0.3, y + height);
  context.lineTo(centreX - width * 0.26, y + headRadius * 2.1);
  context.lineTo(centreX + width * 0.26, y + headRadius * 2.1);
  context.lineTo(centreX + width * 0.3, y + height);
  context.closePath();
  context.fill();

  context.restore();
}
