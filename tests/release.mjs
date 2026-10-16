import { createRequire } from 'module';
import { execSync } from 'child_process';
import http from 'http';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const ext = process.argv[2] ?? REPO;
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');

// Plain web pages A..E (content scripts don't run on data: URLs).
const server = http.createServer((req, res) => {
  const n = req.url.slice(1) || 'index';
  res.setHeader('content-type', 'text/html');
  res.end(`<!doctype html><title>${n}</title><body style="font:40px sans-serif"><input placeholder="${n}"> page ${n}</body>`);
}).listen(0);
const port = server.address().port;

const ctx = await chromium.launchPersistentContext('', { channel: 'chromium', headless: false,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
let sw = ctx.serviceWorkers()[0] ?? await ctx.waitForEvent('serviceworker');
const ev = (fn, arg) => sw.evaluate(fn, arg);
const mgr = await ctx.newPage(); await mgr.goto('chrome://extensions');
await mgr.evaluate(() => new Promise(r => chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true }, r)));
await mgr.evaluate(readFileSync(REPO + '/scripts/set-ctrl-tab-shortcut.js', 'utf8')); await sleep(500);
// Turn on "End the cycle when I let go of Ctrl" as a user does: tick the box,
// then Allow in Chrome's prompt (Deny has the focus by default).
const extId = new URL(sw.url()).host;
const opts = await ctx.newPage(); await opts.goto(`chrome-extension://${extId}/options.html`); await sleep(600);
await opts.bringToFront(); await opts.click('#release-detection'); await sleep(1200);
execSync('xdotool key Tab Return'); await sleep(1200);
const grantedNow = await ev(() => chrome.permissions.contains({ origins: ['<all_urls>'] }));
const regNow = await ev(() => chrome.scripting.getRegisteredContentScripts());
check('turning it on: Chrome prompt allowed, listener registered', grantedNow && regNow.length === 1, { grantedNow, registered: regNow.map(r => r.id) });
await ev(async () => { for (const c of await chrome.runtime.getContexts({ contextTypes: ['TAB'] })) await chrome.tabs.remove(c.tabId); });
await sleep(400);
await ev(async (port) => {
  const w = await chrome.windows.getLastFocused();
  for (const n of ['A', 'B', 'C', 'D', 'E']) await chrome.tabs.create({ windowId: w.id, url: `http://127.0.0.1:${port}/${n}`, active: false });
}, port);
await sleep(1500);
const win = execSync('xdotool search --onlyvisible --class chromium | tail -1').toString().trim();
const title = () => execSync(`xdotool getwindowname ${win}`).toString().trim().replace(/ - Chromium$/, '');
const x = (cmd) => execSync(`xdotool windowfocus --sync ${win} ${cmd}`);
// Tab strip: _ (about:blank), chrome://extensions, A..E
const use = async (n) => { x(`key --clearmodifiers ctrl+${n === '_' ? 1 : ' ABCDE'.indexOf(n) + 2}`); await sleep(400); };
const cycleOpen = () => ev(() => cycle !== null).catch(() => '?');

for (const n of ['A', 'B', 'C', 'D', 'E']) await use(n);   // real Ctrl+1..6 presses
console.log(`start on ${title()}; using Ctrl+Tab / Ctrl+Shift+Tab`);

// 1. Hold Alt as long as you like: no time limit, like Brave.
x('keydown ctrl key Tab'); await sleep(2000);
x('key Tab'); await sleep(400);
const held = title(); const openWhileHeld = await cycleOpen();
x('keyup ctrl'); await sleep(250);
const openAfterRelease = await cycleOpen();
check('holding the modifier 2 s between presses keeps cycling: E -> D -> C', held === 'C' && openWhileHeld === true, { held, openWhileHeld });
check('releasing the modifier ends the cycle at once', openAfterRelease === false, { openAfterRelease });

// 2. Quick toggle: release, then press again right away -> new cycle (back), not further.
x('keydown ctrl key Tab keyup ctrl'); await sleep(200);
const first = title();
x('keydown ctrl key Tab keyup ctrl'); await sleep(400);
check('tap, release, tap again 200 ms later: C -> D -> back to C', first === 'D' && title() === 'C', { first, now: title() });

// 3. Reverse within the same hold.
await sleep(300);
x('keydown ctrl key Tab key Tab key shift+Tab keyup ctrl'); await sleep(400);
check('one hold: forward, forward, reverse -> C -> D -> E -> D', title() === 'D', title());

// 4. A mouse press ends the cycle, as in Brave.
await sleep(300);
x('keydown ctrl key Tab'); await sleep(300);           // D -> E
x('mousemove 600 400 click 1'); await sleep(300);
x('key Tab keyup ctrl'); await sleep(400);             // new cycle from E -> D (not C)
check('mouse press mid-cycle ends it; next press starts over: D -> E, click, -> D', title() === 'D', title());

// 5. Fallback where no page script can run: about:blank ("_") keeps the 0.7 s pause.
await sleep(300);
await use('_'); await use('A');
x('keydown ctrl key Tab'); await sleep(1500);          // A -> _ (no script there), wait past 0.7 s
x('key Tab keyup ctrl'); await sleep(400);             // pause ended that cycle: _ -> A
check('on a page without the script, a 0.7 s pause still ends the cycle: A -> _ , pause, -> A', title() === 'A', title());

// 6. Extension update/reload: tabs already open get the watcher without reloading.
await use('B'); await use('C');
await mgr.evaluate(() => new Promise(r => chrome.developerPrivate.getExtensionsInfo({}, ([e]) => chrome.developerPrivate.reload(e.id, { failQuietly: true }, r))));
await sleep(3000);   // the reloaded extension re-adds the watcher to open tabs
x('keydown ctrl key Tab keyup ctrl'); await sleep(200);
const r1 = title();
x('keydown ctrl key Tab keyup ctrl'); await sleep(400);
check('after an extension reload, release detection works in tabs opened before it: C -> B -> back to C', r1 === 'B' && title() === 'C', { r1, now: title() });

// 7. Very quick taps (Ctrl released ~10 ms after Tab), 250 ms apart: should flip between two tabs.
await sleep(500);
const seen = [];
for (let i = 0; i < 6; i++) { x('keydown ctrl key Tab keyup ctrl'); await sleep(250); seen.push(title()); }
const flips = seen.every((t, i) => t === seen[i % 2]) && seen[0] !== seen[1];
check('6 very quick taps flip between the last two tabs', flips, seen.join(' '));
// 8. Turning it off again (no prompt): the listener goes and the pause rules again.
await sleep(400);
const opts2 = await ctx.newPage(); await opts2.goto(`chrome-extension://${extId}/options.html`); await sleep(600);
await opts2.click('#release-detection'); await sleep(800);
const offState = await opts2.evaluate(async () => ({ granted: await chrome.permissions.contains({ origins: ['<all_urls>'] }), registered: (await chrome.scripting.getRegisteredContentScripts()).length, status: document.getElementById('release-status').textContent }));
await opts2.close(); await sleep(600);
const t0 = title();
x('keydown ctrl key Tab keyup ctrl'); await sleep(200); const t1 = title();
x('keydown ctrl key Tab keyup ctrl'); await sleep(400); const t2 = title();
check('after turning it off: access removed, listener gone; tap, release, tap 200 ms later goes further back', !offState.granted && offState.registered === 0 && t1 !== t0 && t2 !== t0, { ...offState, path: [t0, t1, t2].join(' -> ') });
await ctx.close(); server.close();
