/**
 * Detection chain check: when a person is detected, does everything the spec
 * hangs off that detection actually happen?
 *
 * PROJECT_CONTEXT.md §7 describes one flow that crosses six views — the
 * detection is born on the camera, confirmed by thermal, placed on the map
 * using the pose at the time it was seen, tracked in Personnel, alerted on,
 * and written into the mission report. Each link is cheap to break and none of
 * them is covered by a type check, so they are exercised here end to end
 * against the in-browser mock rover.
 *
 * Needs `npm run dev` running.
 * Run: npm run check:chain
 */

import puppeteer, { type Page } from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? String.raw`C:\Program Files\Google\Chrome\Application\chrome.exe`;

const failures: string[] = [];
function check(name: string, ok: boolean, detail = "") {
  console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : " :: " + detail.slice(0, 400)}`);
  if (!ok) failures.push(name);
}

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox"],
});
const page: Page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1200 });
const errors: string[] = [];
page.on("pageerror", (e) => errors.push(e.message));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const text = () => page.evaluate(() => document.body.innerText);

async function clickText(needle: string) {
  return page.evaluate((t: string) => {
    const el = [...document.querySelectorAll("button")].find((b) =>
      b.textContent?.trim().includes(t),
    );
    if (!el) return false;
    (el as HTMLButtonElement).click();
    return true;
  }, needle);
}

async function clickNear(marker: string, label: string) {
  return page.evaluate(
    (m: string, l: string) => {
      const buttons = [...document.querySelectorAll("button")].filter(
        (b) => b.textContent?.trim() === l,
      );
      for (const button of buttons) {
        let node: HTMLElement | null = button.parentElement;
        for (let depth = 0; depth < 5 && node; depth += 1) {
          if (node.textContent?.includes(m)) {
            (button as HTMLButtonElement).click();
            return true;
          }
          node = node.parentElement;
        }
      }
      return false;
    },
    marker,
    label,
  );
}

async function openCard(label: string) {
  await page.evaluate((name: string) => {
    const h = [...document.querySelectorAll("button h2")].find(
      (e) => e.textContent?.trim() === name,
    );
    (h?.closest("button") as HTMLButtonElement | undefined)?.click();
  }, label);
  await wait(1300);
}
const back = async () => {
  await clickText("Back");
  await wait(900);
};

await page.goto("http://localhost:5173/", { waitUntil: "networkidle2" });
await wait(1200);
await clickText("Launch Mission Control");

// The simulated rover has to travel far enough to meet the first person.
await wait(22000);

const home = await text();
check("home reports a tracked person", /person currently tracked/i.test(home), home);
check("a person alert is raised", /alert/i.test(home), home);

/* ---- vision: detection card carries the person to other views ---- */
await openCard("Vision & Detection");
const vision = await text();
const personId = /P-\d{3}/.exec(vision)?.[0] ?? "";
check("a person ID is assigned", personId !== "", vision);
check("detection is phrased for an operator", /Person detected/.test(vision), vision);
check("thermal confirmation is reported", /confirmed/.test(vision), vision);

check("detection offers view on map", await clickText("View on map"));
await wait(1500);

/* ---- map: that person is followed ---- */
const map = await text();
check("map is following that person", /Stop following/.test(map), map);
check("map names who it is following", map.includes(personId), map);
check(
  "followed person has a recorded location",
  /Last seen \d{2}:\d{2}:\d{2} at x /.test(map),
  map,
);
check("person events are on the map", /Person detected ahead/.test(map), map);

check("stop following clears it", await clickText("Stop following"));
await wait(800);
check("banner is gone", !/Stop following/.test(await text()));
await back();

/* ---- personnel: opened about that person ---- */
await openCard("Personnel Tracking");
// Select the person in the list, as an operator would.
await page.evaluate((id: string) => {
  const entry = [...document.querySelectorAll("button")].find((b) =>
    b.textContent?.includes(id),
  );
  (entry as HTMLButtonElement | undefined)?.click();
}, personId);
await wait(900);
const personnel = await text();
check("personnel lists the person", personnel.includes(personId), personnel);
check(
  "personnel opens that person's record",
  /First detected/i.test(personnel) && /Best confidence/i.test(personnel),
  personnel,
);
check("history names the reporting node", /RGB detection/.test(personnel), personnel);
check("thermal confirmation is in the record", /Thermal confirmation/i.test(personnel), personnel);
check("show on map is offered", /Show on map/.test(personnel), personnel);

check("show on map works from personnel", await clickNear(personId, "Show on map"));
await wait(1500);
check("map follows the person chosen in personnel", (await text()).includes(personId));
await clickText("Stop following");
await back();

/* ---- command palette: jump straight to a person ---- */
await page.keyboard.down("Control");
await page.keyboard.press("KeyK");
await page.keyboard.up("Control");
await wait(700);
await page.keyboard.type(personId);
await wait(600);
await page.keyboard.press("Enter");
await wait(1500);

const jumped = await text();
check("palette jump opens personnel", /Personnel Tracking/.test(jumped), jumped);
check(
  "palette jump selects that person",
  /First detected/i.test(jumped) && jumped.includes(personId),
  jumped,
);
await back();

/* ---- reports: the detection is part of the mission record ---- */
await openCard("Mission Reports");
const reports = await text();
const peopleCount = /People detected[\s\S]{0,40}/i.exec(reports)?.[0] ?? "";
check("report counts the person", /[1-9]/.test(peopleCount), peopleCount || reports);
check("timeline carries the detection", /Person detected ahead/.test(reports), reports);
check(
  "assessment mentions the person records",
  /person record/i.test(reports),
  reports,
);
check("thermal confirmation counted", /thermally confirmed/.test(reports), reports);

const fatal = errors.filter(
  (m) => /Maximum update depth|getSnapshot|Too many re-renders/i.test(m) || m.startsWith("pageerror"),
);
check("no fatal console errors", fatal.length === 0, fatal.join(" | "));

await page.screenshot({ path: `${process.env.SHOT_DIR ?? "."}/chain-reports.png` });

console.log(failures.length === 0 ? "\nDETECTION CHAIN OK" : `\n${failures.length} FAILED`);
await browser.close();
if (failures.length > 0) process.exit(1);
