/**
 * Sets Ctrl+Tab and Ctrl+Shift+Tab as the MRU Tab Switcher shortcuts, like
 * Brave: Ctrl+Tab goes back through recently used tabs, Ctrl+Shift+Tab goes
 * the other way.
 *
 * Chrome won't let an extension ship Tab shortcuts as its defaults, and the
 * chrome://extensions/shortcuts page refuses the Tab key, but that page's own
 * API accepts it. Run this once:
 *   1. Open chrome://extensions/shortcuts
 *   2. Open DevTools: Ctrl+Shift+J (Windows/Linux) or Cmd+Option+J (macOS)
 *   3. Paste this whole file into the Console and press Enter
 *      (Chrome may ask you to type "allow pasting" first)
 *
 * To use other shortcuts, change SHORTCUTS. Write "Ctrl" on every platform: in
 * this API it already means the Control key on macOS ("MacCtrl" is only for
 * manifest.json and is rejected here). To undo, set different shortcuts on the
 * shortcuts page as usual.
 */

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
