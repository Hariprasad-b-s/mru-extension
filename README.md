# MRU Tab Switcher

<img src="icons/icon-128.png" alt="" width="96" align="right">

**Ctrl+Tab takes you to the tab you used last, not the next one to the right**, the way Brave and Firefox can. Tap it again quickly to go further back through your recent tabs.

It works in the background with nothing on screen: no overlays, no popups, no access to the pages you visit, and no data collected.

- **One tap** goes to the tab you were on before this one.
- **Quick repeated taps** (closer together than the pause you set, 0.7 seconds by default) go further back: 2nd most recent, 3rd, and so on, wrapping round to where you started.
- **Ctrl+Shift+Tab goes the other way** through the same list, so on its own it jumps to the tab you've used least recently. You can mix both directions in one go.
- **Works like Brave:** every tab you land on, even briefly while cycling, counts as recently used.
- **Optional: let go of Ctrl to stop, exactly like Brave.** Turn on *End the cycle when I let go of Ctrl* in Settings and you can hold Ctrl as long as you like; letting go ends the cycle. It's off by default because it needs site access (see Privacy).
- **Stays in your window**, or covers all windows if you prefer (see Settings).
- **On/off with one click.** Click the toolbar icon to toggle it; the badge shows **ON** (green) or **OFF**, and the icon goes gray when it's off. While it's off, Ctrl+Tab and Ctrl+Shift+Tab behave like Chrome's normal "next tab" and "previous tab".

![What Ctrl+Tab does](store/screenshot-1280x800.png)

## Install

### From the Chrome Web Store

**[Install MRU Tab Switcher from the Chrome Web Store](https://chromewebstore.google.com/detail/ffkjkhogdepleegfoakgihhmcfekdnoa)**, then pin it from the puzzle-piece menu so you can see its ON/OFF badge.

### From source

1. Download this repository: [main.zip](https://github.com/Hariprasad-b-s/mru-extension/archive/refs/heads/main.zip), then unzip it. Or `git clone https://github.com/Hariprasad-b-s/mru-extension.git`.
2. Keep the folder somewhere permanent. Chrome loads the extension from it every time.
3. Open `chrome://extensions` and turn on **Developer mode** (top right).
4. Click **Load unpacked** and pick the folder that contains `manifest.json`.
5. Pin it from the puzzle-piece menu so you can see its ON/OFF badge.

It works straight away with **Alt+Y** and **Alt+Shift+Y** (in reverse), or **Control+Y** and **Control+Shift+Y** on macOS. To use Ctrl+Tab and Ctrl+Shift+Tab instead, do the one-time setup below.

## Settings

Right-click the toolbar icon and choose **Options** (or open the extension's details and click **Extension options**). The same page opens once after you install, as a welcome page.

- **Pause that ends a cycle:** from 0.3 to 1.5 seconds (0.7 by default). Presses closer together than this keep going further back.
- **Brave-style history** (on by default): every tab you land on while cycling counts as recently used. Turn it off to count only the tab you stop on.
- **End the cycle when I let go of Ctrl** (off by default): Brave's exact behaviour. Chrome asks you to allow site access ("Read and change all your data on all websites") when you turn it on, because a tiny listener has to run in pages to notice the key being released. Untick it to give the access back. On pages where extensions can't run (the New Tab page, `chrome://` pages, the Chrome Web Store) the pause is used instead.
- **Which tabs to cycle through:** only the window you're in (default), or all windows; with all windows, switching to a tab in another window brings that window to the front.
- An **On/Off** switch, the current shortcuts, and the Ctrl+Tab setup below with a **Copy setup code** button.

The toolbar icon's right-click menu also has **Change keyboard shortcuts**, **Set up Ctrl+Tab** and **Help**.

## Use Ctrl+Tab (one-time setup)

The quickest way: right-click the toolbar icon, choose **Set up Ctrl+Tab**, click **Copy setup code**, then follow the three steps on that page. Or do it by hand:

Chrome won't let an extension set Tab shortcuts itself, and the Keyboard shortcuts page won't let you type Tab. The page's own developer API does accept it, so you set it from the DevTools console, the same way [QuicKey](https://fwextensions.github.io/QuicKey/ctrl-tab/) does.

1. Open `chrome://extensions/shortcuts`.
2. Open DevTools: **Ctrl+Shift+J** on Windows/Linux, **Cmd+Option+J** on macOS.
3. Paste the code below into the Console and press **Enter**. If Chrome asks, type `allow pasting` first, then paste again.

```js
(() => {
  const SHORTCUTS = {
    'switch-to-previous-tab': 'Ctrl+Tab',
    'cycle-in-reverse': 'Ctrl+Shift+Tab',
  };

  const api = chrome.developerPrivate;
  if (!api) {
    console.error('Run this on chrome://extensions/shortcuts, not on a regular page.');
    return;
  }

  // Find the extension by its command rather than its ID: a Chrome Web Store
  // install and an unpacked copy have different IDs. Only enabled ones count.
  api.getExtensionsInfo({}, (all) => {
    const matches = all.filter(
      (ext) => /MRU/i.test(ext.name) && ext.commands.some((c) => c.name === 'switch-to-previous-tab'),
    );
    if (matches.length === 0) {
      console.error('MRU Tab Switcher is not installed, or is turned off.');
      return;
    }
    if (matches.length > 1) {
      console.warn(
        `${matches.length} copies are installed; setting the first. Remove the ` +
          'extras on chrome://extensions, then run this again.',
      );
    }

    const { id, commands } = matches[0];
    // An older version may not have every command yet.
    const toSet = Object.entries(SHORTCUTS).filter(([name]) => commands.some((c) => c.name === name));
    for (const [name] of Object.entries(SHORTCUTS)) {
      if (!toSet.some(([n]) => n === name)) {
        console.warn(`This version has no "${name}" command; update the extension, then run this again.`);
      }
    }

    // Set them one after another, then read back what Chrome actually stored:
    // it clears the old shortcut first and reports no error if a new one is
    // rejected.
    const setNext = (i) => {
      if (i < toSet.length) {
        const [commandName, keybinding] = toSet[i];
        api.updateExtensionCommand({ extensionId: id, commandName, keybinding }, () => setNext(i + 1));
        return;
      }
      api.getExtensionInfo(id, (info) => {
        for (const [commandName, wanted] of toSet) {
          const { keybinding } = info.commands.find((c) => c.name === commandName);
          if (keybinding) {
            console.log(`${info.name}: ${commandName} is now ${keybinding}.`);
          } else {
            console.error(`Chrome rejected "${wanted}" for ${commandName}; that shortcut is now unset.`);
          }
        }
      });
    };
    setNext(0);
  });
})();
```

4. It should print `...: switch-to-previous-tab is now Ctrl+Tab.` and `...: cycle-in-reverse is now Ctrl+Shift+Tab.`, and the shortcuts page should show **Ctrl + Tab** and **Ctrl + Shift + Tab** (⌃⇥ and ⌃⇧⇥ on macOS).

The same code is in [`scripts/set-ctrl-tab-shortcut.js`](scripts/set-ctrl-tab-shortcut.js). It works for a Web Store install and a source install alike, and it's safe to run more than once. On macOS, "Ctrl" means the Control key here, so the code is the same on every platform.

To go back to normal shortcuts, set them on the shortcuts page as usual. While they're bound to this extension, Chrome's own Ctrl+Tab and Ctrl+Shift+Tab ("next/previous tab") are replaced; use **Ctrl+PgDn / Ctrl+PgUp** (Windows/Linux) or **Cmd+Option+→ / ←** (macOS) for those instead, or switch the extension OFF.

## Updating a source install

Download the new files into the same folder (or `git pull`), then click the reload arrow on the extension's card in `chrome://extensions`. Your shortcut stays set.

If you installed a copy before the extension had a fixed ID, remove it and use **Load unpacked** again once. The Ctrl+Tab script tells you if more than one copy is installed.

## Privacy

The extension keeps the order you used your tabs in, as tab ID numbers in the browser's memory, and remembers whether it's switched on and your settings. It never reads page content, makes no network requests, and collects nothing.

By default it has no access to web pages. Only if you turn on *End the cycle when I let go of Ctrl* does it ask for site access and run [`content.js`](content.js) in pages: a listener that stays idle until you switch tabs, then only notices Ctrl being released or pressed and mouse clicks, and tells the extension "stop cycling". It never reads or changes page content. See [PRIVACY.md](PRIVACY.md).

## Publishing

`./scripts/package.sh` builds the zip to upload to the Chrome Web Store. The listing text, images and step-by-step instructions are in [store/listing.md](store/listing.md).

## Files

| Path | What it is |
| --- | --- |
| `manifest.json` | Extension manifest (Manifest V3) |
| `background.js` | Service worker: tab tracking, switching, the ON/OFF toggle and the toolbar menu |
| `options.html`, `options.js` | Settings and welcome page |
| `content.js` | Optional listener that reports when Ctrl is let go (only with site access) |
| `icons/` | Extension icons (`icon-off-*` for the OFF state), plus `icon.svg`, the source they're rendered from |
| `scripts/set-ctrl-tab-shortcut.js` | Ctrl+Tab setup code to paste into DevTools |
| `scripts/package.sh` | Builds `dist/mru-tab-switcher-<version>.zip` for the Web Store |
| `store/` | Web Store listing text and images |
