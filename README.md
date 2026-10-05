# OrionPax Dashboard

Rescue-intelligence command interface for the OrionPax rover.

Functional spec and all design rules live in `../PROJECT_CONTEXT.md`. Section
references in the code (`§12.1`, `§4.6`, …) point there.

## Run

```bash
npm install
npm run dev
```

Then open http://localhost:5173. It starts in **Mock data** mode, so the whole
dashboard is populated with no rover and no server running.

| Script | What it does |
|---|---|
| `npm run dev` | The dashboard |
| `npm run mock` | Three mock rover nodes on ports 7001–7003, for exercising the real network path |
| `npm run dev:all` | Both together |
| `npm run typecheck` | Full TypeScript check |
| `npm run check:ingest` | Replays each node's wire shape through the ingest layer and asserts every value routes to the field the catalogue names |
| `npm run smoke` | Headless Chrome check: app mounts, all eight modules render, no render loop (needs `npm run dev` running) |
| `npm run build` | Production build |

## Mock data and real data

One switch, in the header on every screen and in **Settings → Data source**.

**Mock data** runs a simulated rover inside the browser. No address is
contacted and no mock server is needed. The simulator
(`src/lib/mock/simulator.ts`) emits only values the components in §11 can
actually produce, in their own units — 32×24 thermal frames, 12-bit MQ ADC
counts, pack voltage with no fuel gauge, iBUS channels in µs, and a GPS with no
fix because the simulated mission is underground. Those payloads go through the
same ingest path as real traffic, so mock mode tests the routing rather than
bypassing it. The camera, which has nothing to decode, is drawn as a tunnel
scene marked **simulated** on the frame.

**Real data** connects to the node addresses in the registry. A node that does
not answer reads as offline; nothing is ever substituted for it, and the
dashboard never silently falls back to simulated data while presenting it as
live. Switching modes clears the current readings so a value from one mode is
never shown as if it came from the other.

## Pointing at the real rover

Two ways, both ending in the same registry:

- **Settings page** (header gear): edit each node's address, telemetry path,
  transport and cadence, add or remove nodes, and apply. Takes effect
  immediately — no rebuild, no reload. Stored per browser.
- **Env vars** for a deployment default: copy `.env.example` to `.env.local`.

```
VITE_NODE_PI=http://<pi-ip>:<port>
VITE_NODE_ESP32_A=http://<esp32-a-ip>
VITE_NODE_ESP32_B=http://<esp32-b-ip>
```

The defaults mirror the hardware in §11 — one Raspberry Pi 5 and two ESP32s.
Each node needs CORS allowing the dashboard origin, and every node must share
one scheme: an HTTPS dashboard cannot read HTTP nodes.

### Any node can send anything

Routing is by **payload content, not by host**. `src/lib/ingest.ts` takes any
JSON object from any node, recognises the values a component in §11 can
produce, and emits a patch keyed by telemetry field; the store tags each field
with the node that delivered it, and the module that owns that field renders
it. Thermal data lands on the Thermal page whichever IP it arrived from.

That means the node split is free. One address or six both work: move the
MLX90640 from the Pi to an ESP32, merge two ESP32s into one endpoint, or serve
everything from a single Flask route, and only the address changes.

Recognition is deliberately conservative:

- A key is accepted only when its name — or its parent's name — matches a known
  sensor alias **and** the value passes a range check for that physical
  quantity. `mpu6050.temperature` is the IMU die, not the air, so it never
  becomes the environment reading.
- Anything unrecognised is listed in **Settings → What each node is sending**,
  under "Keys not recognised". It is never guessed at.
- Absent stays absent: a field not in the payload resolves to *unavailable*,
  never to `0`.
- Units convert only where they are unambiguous: Pa→hPa, mm→cm, knots→km/h,
  centi-degrees→degrees. Otherwise the sensor's native unit is assumed.

Both flat and nested shapes work, e.g. all of these are the air temperature:

```json
{ "temperatureC": 24.5 }
{ "bme280": { "temperature": 24.5 } }
{ "environment": { "temp": 24.5 } }
```

To teach it a new key name, add an alias in `src/lib/ingest.ts` and nothing
else changes. To add a genuinely new value, add it to `TelemetryField`,
`src/lib/field-catalog.ts` (which names its component and its module) and the
view that shows it.

## Only what the hardware reports

`src/lib/field-catalog.ts` is the whole contract: every value the dashboard can
display, the component that produces it, and the page it appears on. It is
rendered as a live table in Settings, with the node currently supplying each
row. Anything not in that table is not displayed.

A few consequences worth knowing, because they look like missing features:

- **No gas ppm.** MQ-2 and MQ-135 are uncalibrated: they output a voltage that
  rises with total reducing-gas concentration. ppm would need a per-sensor
  calibration curve the rover does not carry, so the proportion of full scale
  is shown along with what the sensor responds to.
- **No battery runtime estimate.** The pack is read through a voltage divider
  and there is no coulomb counter, so charge is derived from a 3S voltage curve
  and marked as an estimate. Minutes-remaining has no source.
- **No RSSI.** The FS-iA6B does not publish signal strength in its iBUS servo
  frames, so transmitter link health is frame age and failsafe state.
- **No absolute heading unless a node sends one.** The MPU6050 has no
  magnetometer; pitch and roll are solved from gravity, yaw only ever comes
  from the node and is labelled relative.
- **No odometer.** There are no wheel encoders, so the map shows route length
  summed from the reported poses.
- **No recording or snapshot buttons.** Nothing behind them records. The
  mission bookmark stays, because the dashboard owns the mission timeline.

## Deploying

The dashboard is a static build (`npm run build` -> `dist/`), so any static host
serves it. `vercel.json` sets the build command, output directory, SPA rewrite
and asset caching; importing the repo on Vercel needs no further configuration.

**A hosted dashboard cannot read a plain-HTTP rover node.** Vercel serves over
HTTPS, and a browser refuses to let an HTTPS page fetch `http://` or `ws://` —
the request is blocked as mixed content before it reaches the network, so the
node reads as permanently offline no matter how correct its address is. This is
§12.1 rule 13: the dashboard and every node must share one scheme. Settings
detects the situation and names it rather than leaving a node looking
misconfigured.

So:

| Where it runs | Mock data | Real rover data |
|---|---|---|
| Vercel (HTTPS) | works | blocked, unless the nodes serve HTTPS |
| `npm run dev` / `npm run preview` on the rover network | works | works |
| `dist/` served over plain HTTP on the rover network | works | works |

For an actual mission run the production build, not the dev server:

```bash
npm run build
npm run preview     # http://<this-machine-ip>:4173
```

Both `dev` and `preview` bind every interface, so the dashboard also opens from
a second laptop or a phone on the same network — useful when the pilot holds
the FS-i6 and someone else watches the feed.

A hosted build is therefore the right home for demos, presentations and sharing
the interface. **For driving an actual mission, serve it on the rover network**
— that also removes the dependency on having internet underground.

If a hosted dashboard really must reach the rover, give the nodes HTTPS: put one
reverse proxy with a certificate in front of all three (a tunnel from the Pi is
the usual way, since LAN addresses are not publicly routable), and point the
nodes at those HTTPS URLs in Settings.

### Build-time environment

`VITE_NODE_*` are inlined at build time, so changing them on the host needs a
redeploy. The Settings page overrides them at runtime and is stored per
browser, which is usually the easier path for a deployed build.

## Testing degradation

The multi-source rules are the hard part, so exercise them:

```bash
npm run mock -- --drop=esp32a      # start without the environment node
```

Point the nodes at `localhost:7001–7003` in Settings, switch to Real data, then
stop one node while the dashboard runs. Expect:

- only that node's values marked unavailable; every other module unaffected
- cards naming what they are waiting on, not a host that may move tomorrow
- Rover Health showing the node offline with its last-update age
- an alert at WARNING if that node was supplying safety data, ATTENTION
  otherwise, and a one-time alert naming the address if a node never answers
- Environment safety state going **UNKNOWN**, never NORMAL
- no layout shift when it reconnects

## Layout

```
src/
├── config/
│   ├── nodes.ts          # the ONLY file holding addresses; runtime registry
│   └── modules.ts        # the eight modules and the fields each needs
├── lib/
│   ├── types.ts          # domain types, one payload per component
│   ├── field-catalog.ts  # every displayable value -> component + module
│   ├── ingest.ts         # any payload -> telemetry fields (content routing)
│   ├── data-mode.ts      # mock / real switch
│   ├── mission-clock.ts  # single authority for every displayed time
│   ├── thresholds.ts     # the one place a number becomes a status
│   ├── telemetry-store.ts# provenance-tagged store + selectors
│   ├── control.ts        # acknowledged mission-recording path (no motors)
│   ├── connectors/       # one connector per transport
│   └── mock/             # in-browser simulated rover
├── components/
│   ├── ui/               # button, panel primitives
│   ├── layout/           # header, module card, status badge, reading display
│   ├── modules/          # the eight module views
│   ├── settings/         # settings page (data mode, nodes, routing)
│   ├── vision/           # camera surface: MJPEG, or the simulated scene
│   ├── map/              # mission map canvas
│   ├── thermal/          # thermal canvas + palettes
│   ├── command/          # cmdk palette
│   ├── marketing/        # landing page
│   └── icons.ts          # every icon resolves here
└── mock-server/          # three independent mock nodes, over the network
```

## Rules that are easy to break

1. Never hardcode a host in a component. Resolve from the registry in
   `config/nodes.ts`.
2. Never render a missing value as `0`. A false `0 ppm` reads as "safe".
3. Never show stale data as live. `ReadingDisplay` handles this — use it.
4. Never put a safety alert in a toast. Toasts are for transient confirmations.
5. Never derive a status inline. Add it to `lib/thresholds.ts`.
6. Never render a timestamp directly. Go through `lib/mission-clock.ts`.
7. Never display a value that no component can produce. If it is not in
   `lib/field-catalog.ts`, it does not go on screen.
8. Never let mock data read as live. The mode badge is on every screen and the
   simulated camera is labelled on the frame — keep it that way.
9. **The dashboard never commands motors.** The FlySky FS-i6 is the sole drive
   authority (PROJECT_CONTEXT.md §4.7). `lib/control.ts` sends mission-recording
   commands only. Do not add movement, speed or stop commands — two unarbitrated
   authorities on the same motors is a hazard, and stopping belongs on the
   transmitter switch plus an ESP32 iBUS failsafe.
10. **Never subscribe to a selector that builds a new array or object.** zustand
    compares selector output by reference, so `useTelemetry(personList)`
    re-renders forever and the page goes blank. Use the `use*` hooks in
    `telemetry-store.ts` (`useSourceHealthList`, `usePersonList`,
    `useFieldResolution`, `useModuleAvailability`, `useSummary`, …) — they wrap
    the selector in `useShallow`. For the same reason, nothing inside a selector
    may read the current time.

`npm run smoke` catches a breach of rule 10; a type check and a build will not.

## Still open

Each node's exact JSON key names are still the rover's choice — the ingest
aliases cover the common spellings, and Settings shows anything it did not
recognise so the gap is visible rather than silent. Remaining questions are
listed in `../PROJECT_CONTEXT.md` §14.
