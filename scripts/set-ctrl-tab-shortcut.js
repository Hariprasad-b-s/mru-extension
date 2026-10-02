/**
 * Sets Ctrl+Tab as the Pure MRU Tab Switcher shortcut.
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
  // Fixed by the "key" in manifest.json, whatever folder it's loaded from.
  const EXTENSION_ID = 'olophmoglokjdojcacoihjcepmlhafag';
  const COMMAND = 'switch-to-previous-tab';
  const KEYBINDING = 'Ctrl+Tab';

  const api = chrome.developerPrivate;
  if (!api) {
    console.error('Run this on chrome://extensions/shortcuts, not on a regular page.');
    return;
  }

  // Chrome silently ignores an unknown ID, so check the extension is there.
  api.getExtensionInfo(EXTENSION_ID, (info) => {
    if (chrome.runtime.lastError || !info) {
      console.error(
        `Pure MRU Tab Switcher (ID ${EXTENSION_ID}) isn't installed. A copy ` +
          'installed before the ID was fixed has a different ID: remove it on ' +
          'chrome://extensions, Load unpacked again, then rerun this.',
      );
      return;
    }

    api.updateExtensionCommand(
      { extensionId: EXTENSION_ID, commandName: COMMAND, keybinding: KEYBINDING },
      () => {
        // Chrome clears the old shortcut first and reports no error if the new
        // one is rejected, so read back what was actually stored.
        api.getExtensionInfo(EXTENSION_ID, ({ commands }) => {
          const { keybinding } = commands.find((c) => c.name === COMMAND);
          if (keybinding) {
            console.log(`Pure MRU Tab Switcher shortcut is now ${keybinding}.`);
          } else {
            console.error(`Chrome rejected "${KEYBINDING}"; the shortcut is now unset.`);
          }
        });
      },
    );
  });
})();
