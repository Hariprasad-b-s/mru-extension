import { createRequire } from 'module';
import { fileURLToPath } from 'url';
// Paths: the repo (or EXT_DIR) and Playwright (or PLAYWRIGHT=/path/to/playwright).
const REPO = process.env.EXT_DIR ?? fileURLToPath(new URL('..', import.meta.url)).replace(/\/$/, '');
const PLAYWRIGHT = process.env.PLAYWRIGHT ?? 'playwright';
const require = createRequire(import.meta.url);
const { chromium } = require(PLAYWRIGHT);
const ext = REPO;
const ctx = await chromium.launchPersistentContext('', {
  channel: 'chromium', headless: true,
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`],
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');

// 1.1.0 opens a welcome tab on install; close it so the tab layout is as before.
for (let i = 0; i < 30; i++) {
  const closed = await sw.evaluate(async () => {
    const t = await chrome.runtime.getContexts({ contextTypes: ['TAB'] });
    for (const x of t) await chrome.tabs.remove(x.tabId);
    return t.length;
  });
  if (closed) break;
  await new Promise((r) => setTimeout(r, 100));
}
await new Promise((r) => setTimeout(r, 300));
const ev = (fn, arg) => sw.evaluate(fn, arg);
const settle = () => new Promise(r => setTimeout(r, 400));
const press = async () => { await ev(() => enqueue(() => onSwitchCommand('switch-to-previous-tab', Date.now()))); await new Promise(r => setTimeout(r, 1300)); };
const check = (label, cond, info) => console.log(`${cond ? 'PASS' : 'FAIL'} ${label}`, info ?? '');

await settle();
const stack = () => ev(async () => (await chrome.storage.session.get('mruStack')).mruStack);
const active = () => ev(async () => (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0]?.id);

console.log('seeded stack:', await stack(), 'badge:', await ev(() => chrome.action.getBadgeText({})));
check('badge ON on install', (await ev(() => chrome.action.getBadgeText({}))) === 'ON');

const ids = await ev(async () => {
  const w = await chrome.windows.getLastFocused();
  const out = [];
  for (const u of ['about:blank#a', 'about:blank#b', 'about:blank#c']) out.push((await chrome.tabs.create({ windowId: w.id, url: u, active: false })).id);
  return out;
});
const [A, B, C] = ids;
for (const id of [A, B, C]) { await ev(id => chrome.tabs.update(id, { active: true }), id); await settle(); }
let s = await stack();
check('onActivated orders MRU', s[0] === C && s[1] === B && s[2] === A, s);

// Real keyboard shortcut if the browser routes it; otherwise call the handler.
const page = ctx.pages().find(p => p.url().endsWith('#c'));
await page.keyboard.press('Alt+Y'); await settle();
let viaKey = (await active()) === B;
console.log('shortcut delivered via keyboard:', viaKey);
if (!viaKey) { await press(); }
check('switch goes to previous tab', (await active()) === B, { active: await active(), stack: await stack() });

await press();
check('second switch toggles back', (await active()) === C);

await ev(id => chrome.tabs.remove(id), B); await settle();
s = await stack();
check('onRemoved purges tab', !s.includes(B), s);

// Another window: switching stays inside it, and closing it purges its tabs.
// (Real two-window switching is covered by the headed windows.mjs suite.)
const { D, w2 } = await ev(async () => { const w = await chrome.windows.create({ url: 'about:blank#d', focused: true }); return { D: w.tabs[0].id, w2: w.id }; });
await settle();
s = await stack();
check('new window tab at front', s[0] === D, s);
await ev((w2) => chrome.windows.remove(w2), w2); await settle();
s = await stack();
check('closing the window purges its tab', !s.includes(D) && s[0] === C, s);

// Toggle OFF: switching must do nothing.
await ev(() => toggleEnabled()); await settle();
const st = await ev(async () => ({ en: (await chrome.storage.local.get('isEnabled')).isEnabled, badge: await chrome.action.getBadgeText({}), title: await chrome.action.getTitle({}) }));
check('toggle OFF persists + badge', st.en === false && st.badge === 'OFF', st);
const before = await active();
await press();
check('disabled: no switch', (await active()) === before);
await ev(() => toggleEnabled()); await settle();
check('toggle back ON', (await ev(() => chrome.action.getBadgeText({}))) === 'ON');

// Worker restart: in-memory stack is restored from storage.session.
const saved = await stack();
await ev(async () => { mruStack = []; await restoreStack(); });
check('restore after worker restart', JSON.stringify(await ev(() => mruStack)) === JSON.stringify(saved));

// Stale ID at index 1 is skipped.
await ev(() => enqueue(() => { mruStack.splice(1, 0, 999999); return saveStack(); })); await settle();
const expected = (await stack())[2];
console.log('stack with stale id:', await stack());
await press();
check('stale id skipped', (await active()) === expected, { active: await active(), expected, stack: await stack() });

await ctx.close();
