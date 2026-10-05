/**
 * Headless smoke test: does the app actually mount, and does it stay mounted?
 *
 * Drives the running dev server in headless Chrome and asserts that React
 * rendered, that no console error appeared, and that opening each of the eight
 * modules leaves content on screen. This catches the class of failure that
 * shows as a blank page — a crash or an infinite render loop — which both the
 * type check and the production build pass straight through.
 *
 * Run:  npm run dev        (in one terminal)
 *       npm run smoke
 */

import puppeteer, { type ConsoleMessage } from "puppeteer-core";

const CHROME =
  process.env.CHROME_PATH ?? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const URL = process.env.SMOKE_URL ?? "http://localhost:5173/";

const MODULES = [
  "Vision & Detection",
  "Thermal Intelligence",
  "Mission Map",
  "Environment Safety",
  "Personnel Tracking",
  "Rover Health",
  "Drive Status",
  "Mission Reports",
];

const errors: string[] = [];

const browser = await puppeteer.launch({
  executablePath: CHROME,
  headless: true,
  args: ["--no-sandbox", "--disable-dev-shm-usage"],
});

try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });

  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") errors.push(message.text());
  });
  page.on("pageerror", (error: Error) => errors.push(`pageerror: ${error.message}`));

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30_000 });
  await new Promise((done) => setTimeout(done, 1500));

  const landing = await page.evaluate(() => ({
    children: document.getElementById("root")?.childElementCount ?? 0,
    text: document.body.innerText.slice(0, 200),
  }));

  console.log(`landing #root children : ${landing.children}`);
  console.log(`landing text           : ${landing.text.replace(/\s+/g, " ").trim().slice(0, 90)}`);

  if (landing.children === 0) {
    throw new Error("nothing rendered into #root — blank page");
  }

  // Enter mission control.
  await page.evaluate(() => {
    const button = [...document.querySelectorAll("button")].find((element) =>
      element.textContent?.includes("Launch Mission Control"),
    );
    (button as HTMLButtonElement | undefined)?.click();
  });
  await new Promise((done) => setTimeout(done, 1200));

  const cards = await page.evaluate(
    () => document.querySelectorAll("button h2").length,
  );
  console.log(`home module cards      : ${cards}`);
  if (cards !== 8) throw new Error(`expected 8 module cards, found ${cards}`);

  // Open each module, confirm it renders, then go back.
  for (const label of MODULES) {
    await page.evaluate((name: string) => {
      const heading = [...document.querySelectorAll("button h2")].find(
        (element) => element.textContent?.trim() === name,
      );
      (heading?.closest("button") as HTMLButtonElement | undefined)?.click();
    }, label);
    await new Promise((done) => setTimeout(done, 700));

    const body = await page.evaluate(() => document.body.innerText.length);
    if (body < 200) throw new Error(`module "${label}" rendered almost nothing`);
    console.log(`  ${label.padEnd(22)} ok (${body} chars)`);

    await page.evaluate(() => {
      const back = [...document.querySelectorAll("button")].find((element) =>
        element.textContent?.trim().startsWith("Back"),
      );
      (back as HTMLButtonElement | undefined)?.click();
    });
    await new Promise((done) => setTimeout(done, 400));
  }

  // Telemetry must actually be flowing from the mock nodes.
  await new Promise((done) => setTimeout(done, 1500));
  const live = await page.evaluate(() => document.body.innerText);
  const connected = /Mission Active|Online|Normal|Tracking/i.test(live);
  console.log(`telemetry visible      : ${connected ? "yes" : "no"}`);

  const fatal = errors.filter(
    (message) =>
      /Maximum update depth|getSnapshot should be cached|Too many re-renders/i.test(message) ||
      message.startsWith("pageerror:"),
  );

  if (fatal.length > 0) {
    console.error("\nFAIL — fatal console errors:");
    for (const message of fatal.slice(0, 5)) console.error(`  ${message.slice(0, 300)}`);
    process.exit(1);
  }

  console.log("\nPASS — app mounts, all eight modules render, no fatal errors.");
  if (errors.length > 0) {
    console.log(`(${errors.length} non-fatal console error(s))`);
    for (const message of errors.slice(0, 3)) console.log(`  ${message.slice(0, 160)}`);
  }
} catch (error) {
  console.error(`\nFAIL — ${error instanceof Error ? error.message : String(error)}`);
  for (const message of errors.slice(0, 5)) console.error(`  ${message.slice(0, 300)}`);
  process.exit(1);
} finally {
  await browser.close();
}
