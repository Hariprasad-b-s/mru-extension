# Chrome Web Store listing

Everything to fill in on the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole), and how to publish.

## Before you submit: the name

The listing name comes from `"name"` in `manifest.json`: **MRU tab switcher - Smooth like brave browser**.

Brave is another company's trademark. The Web Store's policies on impersonation, intellectual property and keyword spam can lead reviewers to reject a listing whose name uses another product's name, even as a comparison. If it's rejected for that, change `"name"` to something like **MRU Tab Switcher – Smooth Ctrl+Tab**, rebuild, and upload again. Comparing to Brave in the description is less likely to be a problem.

## Publish, step by step

1. **Register as a developer.** Sign in at the [Developer Dashboard](https://chrome.google.com/webstore/devconsole) with the Google account that should own the listing, pay the one-time registration fee, and verify your contact email. On the **Account** page, also declare your trader status (required for EU users): publishing as an individual rather than a business means **non-trader**.
2. **Build the package.** In this repo, run `./scripts/package.sh`. It writes `dist/mru-tab-switcher-<version>.zip` containing only `manifest.json`, `background.js` and the icons, without the local development `"key"` (the store assigns its own ID).
3. **Upload it.** Dashboard → **New item** → upload the zip.
4. **Store listing tab:** paste the description below, pick the category and language, and upload the images listed below.
5. **Privacy tab:** fill it in from the answers below.
6. **Distribution tab:** Free, Public, all regions.
7. **Submit for review.** Reviews usually take from a few days to a couple of weeks. You'll get an email when it's published.
8. **After it's live:** replace "Coming soon" in `README.md` with the store link.

**Updating later:** raise `"version"` in `manifest.json` (e.g. `1.0.1`), run `./scripts/package.sh` again, upload the new zip on the item's **Package** tab, and submit for review.

**Optional:** on the item's **Package** tab, "View public key" shows the store's key. Putting that in `"key"` in `manifest.json` (replacing the current one) gives your local unpacked copy the same ID as the store version. Nothing depends on this; the Ctrl+Tab script finds the extension either way.

## Store listing tab

**Description** (paste as is):

```
Ctrl+Tab takes you to the tab you used last, not the next one to the right, the way Brave and Firefox can. Tap it again quickly to go further back through your recent tabs.

HOW IT WORKS
• One tap: back to the tab you were on before this one.
• Quick repeated taps (less than a second apart): further back, to your 2nd, 3rd, 4th most recent tab, wrapping round to where you started. Tabs you only pass through don't count as used.
• Stays in your window: it only cycles through the tabs of the window you're working in.
• One click on the toolbar icon turns it on or off. The badge shows ON (green) or OFF (gray).

SHORTCUT
Out of the box the shortcut is Alt+Y (Control+Y on macOS). You can change it on chrome://extensions/shortcuts.

Chrome doesn't let extensions claim Ctrl+Tab directly, but you can set it in a minute by pasting one snippet into DevTools on the shortcuts page. Step-by-step instructions: https://github.com/Hariprasad-b-s/mru-extension#use-ctrltab-one-time-setup

PRIVATE AND LIGHTWEIGHT
• No overlays, popups or pages: it works entirely in the background.
• No access to the pages you visit, no content scripts, no host permissions.
• No network requests, no analytics, no data collected.

Open source: https://github.com/Hariprasad-b-s/mru-extension
```

**Category:** Productivity → Tools (or Workflow & Planning)

**Language:** English

**Graphic assets:**

| Field | File |
| --- | --- |
| Store icon (128×128) | `icons/icon-128.png` |
| Screenshot (1280×800) | `store/screenshot-1280x800.png` |
| Small promo tile (440×280) | `store/promo-small-440x280.png` |

**Homepage / support URL:** https://github.com/Hariprasad-b-s/mru-extension

## Privacy tab

**Single purpose description:**

```
Switch between browser tabs in most-recently-used order with a keyboard shortcut.
```

**Permission justification, `storage`:**

```
Saves whether the extension is switched on, and the order the user recently used their tabs in (as numeric tab IDs only), so both survive the background service worker being restarted. Nothing is sent anywhere.
```

**Host permissions:** none requested.

**Remote code:** No, I am not using remote code.

**Data usage:** tick none of the data types (it collects none), then tick all three certifications:
- I do not sell or transfer user data to third parties, outside of the approved use cases.
- I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
- I do not use or transfer user data to determine creditworthiness or for lending purposes.

**Privacy policy URL:** https://github.com/Hariprasad-b-s/mru-extension/blob/main/PRIVACY.md
