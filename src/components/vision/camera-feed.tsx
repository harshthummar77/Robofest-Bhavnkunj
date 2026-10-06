import { useEffect, useRef, useState } from "react";
import { rgbCamera, useNodes } from "../../config/nodes";
import { useIsMockMode } from "../../lib/data-mode";
import { startWhep, type WhepState } from "../../lib/webrtc/whep";
import type { Detection } from "../../lib/types";
import { cn } from "../../lib/utils";
import { IconAudioOn, IconAudioOff } from "../icons";

/**
 * The RGB surface.
 *
 * In real mode this is whatever the camera node publishes — an MJPEG image
 * stream consumed directly by an <img>, or a WebRTC stream from a WHEP server
 * such as MediaMTX. Either way it is consumed as media, never through the
 * telemetry channel (PROJECT_CONTEXT.md §12).
 *
 * In mock mode there is no camera to read, so rather than show a dead black
 * box the simulated scene is drawn here: a tunnel the rover is advancing
 * through, with a figure wherever the simulated detector reports one. It is
 * drawn, not decoded — and it is marked SIMULATED on the frame itself so it
 * can never be mistaken for a picture of the world.
 */
export function CameraFeed({
  detections,
  stale,
  className,
}: {
  detections: Detection[];
  stale: boolean;
  className?: string;
}) {
  const mock = useIsMockMode();
  const nodes = useNodes();
  const camera = rgbCamera(nodes.filter((node) => node.enabled));

  if (mock) {
    return <MockCameraScene detections={detections} className={className} />;
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

  if (camera.kind === "whep") {
    return <WebRtcFeed url={camera.url} stale={stale} className={className} />;
  }

  return (
    <img
      src={camera.url}
      alt="Live RGB feed from the rover camera"
      className={cn(
        "h-full w-full object-cover transition-state",
        stale && "opacity-60 saturate-50",
        className,
      )}
    />
  );
}

/* ------------------------------------------------------------------ */
/* WebRTC                                                              */
/* ------------------------------------------------------------------ */

/** How long to wait before retrying a stream that failed to start. */
const RETRY_MS = 4000;

function WebRtcFeed({
  url,
  stale,
  className,
}: {
  url: string;
  stale: boolean;
  className?: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [state, setState] = useState<WhepState>("connecting");
  const [detail, setDetail] = useState<string | null>(null);
  // Bumped to force a fresh session after a failure.
  const [attempt, setAttempt] = useState(0);
  // Whether the stream carries a microphone track at all.
  const [hasAudio, setHasAudio] = useState(false);
  // Audio starts muted: browsers refuse to autoplay a stream with sound until
  // the page has been interacted with, and a camera that will not start because
  // of a blocked audio track is worse than a camera with no sound. The operator
  // turns it on with the speaker control, which counts as that interaction.
  const [muted, setMuted] = useState(true);

  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    setHasAudio(false);
    const session = startWhep(url, video, {
      onState(next, why) {
        setState(next);
        setDetail(why ?? null);
      },
      onAudio: setHasAudio,
    });

    return () => session.close();
  }, [url, attempt]);

  // Keep the element's muted property in sync with operator intent.
  useEffect(() => {
    const video = videoRef.current;
    if (video) video.muted = muted;
  }, [muted, hasAudio]);

  // A camera that drops out must come back on its own: the pilot has both
  // hands on the transmitter and cannot reload a page. §4.9
  useEffect(() => {
    if (state !== "failed") return;
    const timer = setTimeout(() => setAttempt((count) => count + 1), RETRY_MS);
    return () => clearTimeout(timer);
  }, [state]);

  return (
    <div className={cn("relative h-full w-full bg-black", className)}>
      <video
        ref={videoRef}
        // Muted at first and playsInline so the browser allows autoplay. The
        // muted property is then driven by the `muted` state via an effect, so
        // the operator can turn the rover microphone on with the control below.
        muted
        playsInline
        autoPlay
        className={cn(
          "h-full w-full object-cover transition-state",
          (stale || state !== "live") && "opacity-60",
        )}
      />

      {/* Microphone control — shown only when the stream actually carries audio
          (the rover mic muxed into the camera path). On a video-only camera it
          never appears. */}
      {state === "live" && hasAudio ? (
        <button
          type="button"
          onClick={() => setMuted((on) => !on)}
          aria-label={muted ? "Unmute rover microphone" : "Mute rover microphone"}
          aria-pressed={!muted}
          title={muted ? "Rover mic muted — click to listen" : "Rover mic live — click to mute"}
          className="absolute bottom-2 right-2 flex items-center gap-1.5 rounded-full bg-black/70 px-3 py-1.5 text-[11px] font-semibold tracking-wide text-white/85 backdrop-blur-sm transition-state hover:bg-black/85 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/60"
        >
          {muted ? (
            <IconAudioOff size={16} weight="fill" />
          ) : (
            <IconAudioOn size={16} weight="fill" className="text-normal" />
          )}
          {muted ? "MIC OFF" : "MIC LIVE"}
        </button>
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
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Simulated scene                                                     */
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
      <span className="absolute bottom-2 left-1/2 -translate-x-1/2 rounded-full bg-black/70 px-2.5 py-1 text-[10px] font-semibold tracking-[0.18em] text-warning uppercase">
        Simulated camera
      </span>
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
