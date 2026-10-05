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
 * microphone, it only accepts video.
 */

export type WhepState = "connecting" | "live" | "failed";

export interface WhepSession {
  close(): void;
}

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
  onState: (state: WhepState, detail?: string) => void,
): WhepSession {
  let closed = false;

  const connection = new RTCPeerConnection({
    // Everything is on one LAN. A STUN server would only add a round trip to
    // the public internet, which the rover network may not even have.
    iceServers: [],
    bundlePolicy: "max-bundle",
  });

  connection.addTransceiver("video", { direction: "recvonly" });

  connection.ontrack = (event) => {
    if (closed) return;
    video.srcObject = event.streams[0] ?? new MediaStream([event.track]);
    void video.play().catch(() => {
      // Autoplay can be refused until the page has been interacted with. The
      // element is muted, which browsers allow, so this is rare — report it
      // rather than leaving a black rectangle with no explanation.
      onState("failed", "the browser blocked playback");
    });
  };

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
