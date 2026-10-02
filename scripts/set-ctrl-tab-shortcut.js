/**
 * Sets Ctrl+Tab as the MRU Tab Switcher shortcut.
 *
 * Chrome won't let an extension ship Ctrl+Tab as its default, and the
 * chrome://extensions/shortcuts page refuses the Tab key, but that page's own
 * API accepts it. Run this once:
 *   1. Open chrome://extensions/shortcuts
 *   2. Open DevTools: Ctrl+Shift+J (Windows/Linux) or Cmd+Option+J (macOS)
 *   3. Paste this whole file into the Console and press Enter
 *      (Chrome may ask you to type "allow pasting" first)
 *
 * To use another shortcut, change KEYBINDING. Write "Ctrl" on every platform:
 * in this API it already means the Control key on macOS ("MacCtrl" is only for
 * manifest.json and is rejected here). To undo, set a different shortcut on
 * the shortcuts page as usual.
 */

(() => {
  const COMMAND = 'switch-to-previous-tab';
  const KEYBINDING = 'Ctrl+Tab';

  const api = chrome.developerPrivate;
  if (!api) {
    console.error('Run this on chrome://extensions/shortcuts, not on a regular page.');
    return;
  }

  // Find the extension by its command rather than its ID: a Chrome Web Store
  // install and an unpacked copy have different IDs. Only enabled ones count.
  api.getExtensionsInfo({}, (all) => {
    const matches = all.filter(
      (ext) => /MRU/i.test(ext.name) && ext.commands.some((c) => c.name === COMMAND),
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

    const { id } = matches[0];
    api.updateExtensionCommand({ extensionId: id, commandName: COMMAND, keybinding: KEYBINDING }, () => {
      // Chrome clears the old shortcut first and reports no error if the new
      // one is rejected, so read back what was actually stored.
      api.getExtensionInfo(id, ({ name, commands }) => {
        const { keybinding } = commands.find((c) => c.name === COMMAND);
        if (keybinding) {
          console.log(`${name}: shortcut is now ${keybinding}.`);
        } else {
          console.error(`Chrome rejected "${KEYBINDING}"; the shortcut is now unset.`);
        }
      });
    });
  });
})();
