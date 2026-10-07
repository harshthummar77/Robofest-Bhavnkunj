/**
 * WHEP client — WebRTC playback of a rover camera.
 *
 * MediaMTX (and any WHEP-compliant server) publishes a stream at
 * `http://<host>:8889/<path>/whep`: POST an SDP offer, get an SDP answer back,
 * and the media arrives over WebRTC.
 *
 * Why WebRTC and not HLS, which the same server also offers: HLS buffers
 * segments and lands around two to six seconds behind reality. The pilot drives
 * from this picture (PROJECT_CONTEXT.md §4.9 — obstacle distance is the value
 * that changes what they do in the next second), and a two-second-old tunnel is
 * worse than no tunnel, because it looks current. WebRTC on a LAN is tenths of
 * a second.
 *
 * This is a receive-only session: the dashboard never opens a camera or a
 * microphone of its own, it only accepts media the rover sends. When the rover
 * path carries audio as well as video (the Raspberry Pi microphone muxed into
 * the same MediaMTX path — see the rover A/V setup), that audio arrives on the
 * same peer connection and plays through the same <video> element. The track is
 * still only ever inbound; nothing is captured from the operator's machine.
 */

export type WhepState = "connecting" | "live" | "failed";

export interface WhepSession {
  close(): void;
}

/**
 * What the browser can measure about the stream it is actually decoding.
 *
 * The rover node reports a frame rate only if someone wrote code to publish
 * one, and this one does not. These numbers are a different thing and are
 * labelled as such in the view: not what the camera claims, but what arrived
 * and was decoded here in the last second.
 */
export interface WhepStats {
  fps: number | null;
  width: number | null;
  height: number | null;
  /** Video bitrate over the last sample, in kilobits per second. */
  kbps: number | null;
  /** Packets the receiver never got. On a rover this is the RF link talking. */
  packetsLost: number | null;
}

export interface WhepCallbacks {
  onState(state: WhepState, detail?: string): void;
  /**
   * Called once the remote media stream is attached, reporting whether it
   * carries an audio track. Lets the view show an unmute control only when
   * there is actually sound to hear, rather than a dead button on a
   * video-only camera.
   */
  onAudio?(present: boolean): void;
  /** Called about once a second while the stream is up. */
  onStats?(stats: WhepStats): void;
}

/** How often to sample decoder statistics. */
const STATS_INTERVAL_MS = 1000;

/** How long to wait for ICE candidates before sending the offer. */
const GATHER_TIMEOUT_MS = 1500;

/**
 * Collect ICE candidates, then send one complete offer.
 *
 * The WHEP spec allows trickling candidates to the server afterwards via
 * PATCH, but on a flat rover network every useful candidate is a host
 * candidate and arrives immediately, so a single non-trickle offer keeps the
 * client small and removes a failure mode.
 */
async function gatherComplete(connection: RTCPeerConnection): Promise<void> {
  if (connection.iceGatheringState === "complete") return;
  await new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      connection.removeEventListener("icegatheringstatechange", check);
      resolve();
    };
    const check = () => {
      if (connection.iceGatheringState === "complete") done();
    };
    const timer = setTimeout(done, GATHER_TIMEOUT_MS);
    connection.addEventListener("icegatheringstatechange", check);
  });
}

export function startWhep(
  url: string,
  video: HTMLVideoElement,
  callbacks: WhepCallbacks | ((state: WhepState, detail?: string) => void),
): WhepSession {
  // Accept either the full callbacks object or a bare state callback, so the
  // older two-argument call site keeps working.
  const onState = typeof callbacks === "function" ? callbacks : callbacks.onState;
  const onAudio = typeof callbacks === "function" ? undefined : callbacks.onAudio;
  const onStats = typeof callbacks === "function" ? undefined : callbacks.onStats;

  let closed = false;

  const connection = new RTCPeerConnection({
    // Everything is on one LAN. A STUN server would only add a round trip to
    // the public internet, which the rover network may not even have.
    iceServers: [],
    bundlePolicy: "max-bundle",
  });

  connection.addTransceiver("video", { direction: "recvonly" });
  // Also offer to receive audio. If the rover path is video-only the server
  // simply leaves this track inactive in its answer, so offering it always is
  // harmless and means no reconnect is needed when a mic appears.
  connection.addTransceiver("audio", { direction: "recvonly" });

  connection.ontrack = (event) => {
    if (closed) return;
    const stream = event.streams[0] ?? new MediaStream([event.track]);
    video.srcObject = stream;
    onAudio?.(stream.getAudioTracks().length > 0);
    void video.play().catch(() => {
      // Autoplay can be refused until the page has been interacted with. The
      // element is muted, which browsers allow, so this is rare — report it
      // rather than leaving a black rectangle with no explanation.
      onState("failed", "the browser blocked playback");
    });
  };

  // Decoder statistics, sampled from the peer connection itself. `getStats`
  // reports the inbound video track's current decode rate and frame size, so
  // this measures the picture on screen rather than trusting a claim about it.
  let lastBytes: { bytes: number; at: number } | null = null;

  const statsTimer = onStats
    ? setInterval(() => {
        if (closed) return;
        void connection
          .getStats()
          .then((report) => {
            if (closed) return;
            let video: Record<string, unknown> | null = null;
            report.forEach((entry) => {
              if (entry.type !== "inbound-rtp") return;
              if (entry.kind !== "video" && entry.mediaType !== "video") return;
              video = entry as Record<string, unknown>;
            });
            if (!video) return;
            const track = video as Record<string, unknown>;

            // Bitrate is a delta, so it needs the previous sample. The first
            // tick therefore reports no rate rather than a made-up one.
            let kbps: number | null = null;
            const bytes = typeof track.bytesReceived === "number" ? track.bytesReceived : null;
            const at = typeof track.timestamp === "number" ? track.timestamp : Date.now();
            if (bytes !== null) {
              if (lastBytes && at > lastBytes.at) {
                kbps = ((bytes - lastBytes.bytes) * 8) / (at - lastBytes.at);
              }
              lastBytes = { bytes, at };
            }

            onStats({
              fps: typeof track.framesPerSecond === "number" ? track.framesPerSecond : null,
              width: typeof track.frameWidth === "number" ? track.frameWidth : null,
              height: typeof track.frameHeight === "number" ? track.frameHeight : null,
              kbps,
              packetsLost: typeof track.packetsLost === "number" ? track.packetsLost : null,
            });
          })
          .catch(() => {
            // Statistics are decoration; a failure here must not disturb the
            // picture or the state machine.
          });
      }, STATS_INTERVAL_MS)
    : null;

  connection.onconnectionstatechange = () => {
    if (closed) return;
    if (connection.connectionState === "connected") onState("live");
    if (connection.connectionState === "failed") onState("failed", "connection failed");
    if (connection.connectionState === "disconnected") onState("connecting", "reconnecting");
  };

  async function negotiate(): Promise<void> {
    onState("connecting");

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    await gatherComplete(connection);
    if (closed) return;

    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/sdp" },
      body: connection.localDescription?.sdp ?? offer.sdp ?? "",
    });

    if (!response.ok) {
      throw new Error(`stream server answered HTTP ${response.status}`);
    }

    const answer = await response.text();
    if (closed) return;
    await connection.setRemoteDescription({ type: "answer", sdp: answer });
  }

  negotiate().catch((error: unknown) => {
    if (closed) return;
    onState("failed", error instanceof Error ? error.message : "could not start the stream");
  });

  return {
    close() {
      closed = true;
      if (statsTimer !== null) clearInterval(statsTimer);
      video.srcObject = null;
      // Closing the peer connection is what ends the session: the server sees
      // the connection drop and reaps its reader immediately.
      //
      // WHEP also defines a DELETE on the session resource, which this client
      // deliberately does not send. Teardown happens in a React effect cleanup,
      // which cannot await, so the request is only queued — and by the time it
      // is dispatched the server has already released the session and answers
      // 404. It released nothing extra and logged an error on every navigation
      // away from the camera.
      try {
        connection.close();
      } catch {
        // Teardown is best-effort.
      }
    },
  };
}
