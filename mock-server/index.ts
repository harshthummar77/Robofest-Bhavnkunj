/**
 * MOCK ROVER NODES — standalone HTTP servers, one per rover node.
 *
 * The dashboard has its own in-browser mock (the Mock data switch in Settings),
 * which needs no server at all. This exists for the other job: exercising the
 * **real** data path — three separate origins, CORS, HTTP polling, WebSocket
 * frames, MJPEG endpoints, and a node going away mid-mission.
 *
 * The ports mirror the hardware split in PROJECT_CONTEXT.md §11: one Pi 5 and
 * two ESP32s. Payload shapes come from `src/lib/mock/simulator.ts`, the same
 * module the in-browser mock uses, so the two cannot drift apart.
 *
 * Run:  npm run mock
 *
 * Then in Settings, switch to Real data and point the three nodes at:
 *   http://localhost:7001  /telemetry   (Pi 5 — camera + thermal)
 *   http://localhost:7002  /api/sensors (ESP32 A — environment)
 *   http://localhost:7003  /api/status  (ESP32 B — drive, LiDAR, RC link)
 *
 * Kill one to watch that node degrade while the others keep reporting:
 *   node --import tsx mock-server/index.ts --drop=esp32a
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { WebSocketServer, type WebSocket } from "ws";
import { createSimulator, type MockProfile } from "../src/lib/mock/simulator";

interface NodeSpec {
  id: string;
  port: number;
  /** JSON endpoint path, matching what the real firmware would serve. */
  telemetryPath: string;
  profiles: MockProfile[];
  /** MJPEG-ish paths this node serves, if any. */
  streams?: string[];
}

const NODES: NodeSpec[] = [
  {
    id: "pi",
    port: 7001,
    telemetryPath: "/telemetry",
    profiles: ["vision", "thermal"],
    streams: ["/stream.mjpg", "/thermal.mjpg"],
  },
  {
    id: "esp32a",
    port: 7002,
    telemetryPath: "/api/sensors",
    profiles: ["environment"],
  },
  {
    id: "esp32b",
    port: 7003,
    telemetryPath: "/api/status",
    profiles: ["motion"],
  },
];

const CADENCE: Record<string, number> = { pi: 500, esp32a: 2000, esp32b: 300 };

/** `--drop=esp32a,pi` starts without those nodes, to test degradation. */
const dropped = new Set(
  (process.argv.find((argument) => argument.startsWith("--drop="))?.split("=")[1] ?? "")
    .split(",")
    .filter(Boolean),
);

/* ------------------------------------------------------------------ */
/* One simulated world, shared by every node                           */
/* ------------------------------------------------------------------ */

const simulator = createSimulator();
let last = Date.now();
setInterval(() => {
  const now = Date.now();
  simulator.step(now - last);
  last = now;
}, 100);

/* ------------------------------------------------------------------ */
/* Server plumbing                                                     */
/* ------------------------------------------------------------------ */

/**
 * CORS. Real rover nodes need the same headers, and all nodes must share one
 * scheme — an HTTPS dashboard cannot read HTTP nodes. §12.1 rule 13.
 */
function cors(response: ServerResponse): void {
  response.setHeader("Access-Control-Allow-Origin", "*");
  response.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  response.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
}

/**
 * Placeholder visual feed. A real node serves multipart MJPEG here; encoding
 * JPEG without a dependency is not worth it for a mock, so this returns a
 * self-animating SVG that an <img> renders the same way.
 */
function feedSvg(path: string): string {
  const thermal = path.includes("thermal");
  const tint = thermal ? "#f97316" : "#38bdf8";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 640 360">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b1220"/>
      <stop offset="100%" stop-color="#1e293b"/>
    </linearGradient>
  </defs>
  <rect width="640" height="360" fill="url(#g)"/>
  <g stroke="${tint}" stroke-opacity="0.18" stroke-width="1">
    ${Array.from({ length: 12 }, (_, i) => `<line x1="0" y1="${i * 30}" x2="640" y2="${i * 30}"/>`).join("")}
    ${Array.from({ length: 21 }, (_, i) => `<line x1="${i * 32}" y1="0" x2="${i * 32}" y2="360"/>`).join("")}
  </g>
  <rect x="-200" y="0" width="200" height="360" fill="${tint}" fill-opacity="0.12">
    <animate attributeName="x" from="-200" to="640" dur="3.4s" repeatCount="indefinite"/>
  </rect>
  <text x="320" y="186" fill="#94a3b8" font-family="ui-sans-serif, system-ui" font-size="18"
        text-anchor="middle">${thermal ? "THERMAL" : "CAMERA"} — MOCK FEED</text>
</svg>`;
}

function startNode(spec: NodeSpec): void {
  if (dropped.has(spec.id)) {
    console.log(`  [skipped] ${spec.id} — started with --drop=${spec.id}`);
    return;
  }

  const payload = () => simulator.combined(spec.profiles);

  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    cors(response);

    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url ?? "/", `http://localhost:${spec.port}`);

    // HTTP polling endpoint — the transport the rover uses today.
    if (url.pathname === spec.telemetryPath) {
      response.writeHead(200, { "Content-Type": "application/json", "Cache-Control": "no-store" });
      response.end(JSON.stringify(payload()));
      return;
    }

    if (spec.streams?.includes(url.pathname)) {
      response.writeHead(200, { "Content-Type": "image/svg+xml", "Cache-Control": "no-store" });
      response.end(feedSvg(url.pathname));
      return;
    }

    // Mission recording path: acknowledged, separate from telemetry. §12
    // No motor commands exist on this path by design. §4.7
    if (url.pathname === "/command" && request.method === "POST") {
      let body = "";
      request.on("data", (chunk) => {
        body += chunk;
      });
      request.on("end", () => {
        let command: { kind?: string; action?: string } = {};
        try {
          command = JSON.parse(body || "{}");
        } catch {
          response.writeHead(400, { "Content-Type": "application/json" });
          response.end(JSON.stringify({ accepted: false, message: "Malformed command" }));
          return;
        }
        response.writeHead(200, { "Content-Type": "application/json" });
        response.end(
          JSON.stringify({
            accepted: true,
            message: `${command.kind ?? "command"} ${command.action ?? ""} acknowledged`.trim(),
          }),
        );
      });
      return;
    }

    if (url.pathname === "/health") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ node: spec.id, ok: true }));
      return;
    }

    response.writeHead(404, { "Content-Type": "text/plain" });
    response.end("not found");
  });

  // WebSocket endpoint — the target transport for live telemetry.
  const sockets = new WebSocketServer({ server, path: "/ws" });

  sockets.on("connection", (socket: WebSocket) => {
    console.log(`  ${spec.id}: client connected`);
    const timer = setInterval(() => {
      if (socket.readyState !== socket.OPEN) return;
      socket.send(JSON.stringify(payload()));
    }, CADENCE[spec.id] ?? 1000);

    socket.on("close", () => {
      clearInterval(timer);
      console.log(`  ${spec.id}: client disconnected`);
    });
  });

  server.listen(spec.port, () => {
    console.log(
      `  ${spec.id.padEnd(8)} http://localhost:${spec.port}${spec.telemetryPath}` +
        `  (ws://localhost:${spec.port}/ws)`,
    );
  });
}

console.log("\nOrionPax mock rover nodes — three independent origins\n");
for (const spec of NODES) startNode(spec);
console.log("\nStop one node to watch it degrade while the rest keep reporting.\n");
