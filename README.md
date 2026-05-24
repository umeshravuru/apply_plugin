# Apply Plugin

Record once, auto-fill job applications. Chrome extension, Manifest V3, no backend, free to run (uses your own Gemini API key).

## Install (developer mode)

1. Clone this repo.
2. Run `npm install` once (only needed if you want to run tests).
3. Open `chrome://extensions/`.
4. Toggle **Developer mode** on (top-right).
5. Click **Load unpacked** and pick the project root (`apply_plugin/`).
6. The Apply Plugin icon appears in your toolbar.

## Setup

1. Get a free Gemini API key: <https://aistudio.google.com/apikey>.
2. Click the Apply Plugin icon → **Settings** → paste the key → **Save**.
3. (Optional) Click **Test connection** to verify the key works.

## Usage

### Record your details (one-time)

1. Open a job application page (any site with form fields).
2. Click the Apply Plugin icon → **Start Recording**.
3. Fill the form by hand as usual.
4. Click the icon → **Stop Recording**. Your entries are saved to your profile.

Repeat on a couple of different application sites to fill out your profile.

### Auto-fill a new application

1. Open a new job application page.
2. Click the Apply Plugin icon → **Fill This Page**.
3. The extension reads the form, asks Gemini to match your saved values, and fills it.
4. If anything is missing, a panel appears in the bottom-right asking for the missing values. Fill them and click **Save & fill** — they're added to your profile for next time.
5. Upload your resume yourself (the extension never touches file inputs).

### Manage your profile

- Click the icon → **Profile** to view, edit, or delete saved entries.
- **Export JSON** to back up; **Import JSON** to restore.

## Running tests

```bash
npm test
```

## Manual test checklist (after install)

- [ ] Open Settings, paste API key, click **Test connection** → "Connection OK."
- [ ] On a Greenhouse demo (or any simple form), click **Start Recording**, fill a few fields, click **Stop Recording** → success message, fields visible under **Profile**.
- [ ] On a fresh form, click **Fill This Page** → fields are filled.
- [ ] On a form with a dropdown your profile doesn't perfectly match (e.g., "United States" vs "US"), verify the dropdown still picks the right option.
- [ ] On a form with a field your profile has never seen → missing-field panel appears. Fill it, click **Save & fill** → page fills, **Profile** now contains the new label.
- [ ] Disable Wi-Fi, click **Fill This Page** → error message appears, page is untouched.
- [ ] In **Profile**, edit a value → next **Fill** uses the new value.

## Privacy

- API key and profile are stored only in `chrome.storage.local` on this browser profile.
- The Gemini call sends your profile (labels + values) and the form's field labels + dropdown options. It does NOT send any values you've already typed into the page.
- No analytics. No remote backend.
