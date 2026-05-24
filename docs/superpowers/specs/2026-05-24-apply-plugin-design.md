# Apply Plugin — Design Spec

**Date:** 2026-05-24
**Owner:** Umesh Ravuru

## Problem

Filling the same personal/professional details into job application forms over and over is painful. Need a Chrome extension that records the values once and auto-fills them on subsequent applications, including dropdowns. No paid services.

## Goals

- One-click recording of values entered on a job application page.
- One-click filling of a job application page from a saved profile.
- Handle dropdowns (single-select `<select>`, radio groups) by picking the best-matching option, not just exact strings.
- Prompt for any field the profile doesn't yet know, and remember the answer.
- Resume / file uploads stay manual — never touched by the extension.
- Zero hosting cost. No paid APIs.

## Non-Goals

- Multi-page auto-advance (user clicks Fill on each step).
- Per-site selector memory (no site-specific tuning).
- Cross-device sync (single browser profile only; JSON export/import is a follow-up if needed).
- File-upload automation.
- Multi-select / tag-input fields beyond what natural events can drive (typeaheads are best-effort).

## High-Level Architecture

Manifest V3 Chrome extension, vanilla JS, no build step.

```
+---------------------+        +-------------------------+
|  Popup (popup.html) |  <-->  |  Background SW          |
|  - Record/Stop      |  msg   |  - Gemini API calls     |
|  - Fill             |        |  - Holds API key access |
|  - Manage profile   |        |  - storage <-> popup    |
|  - Settings         |        +-----------+-------------+
+----------+----------+                    |
           | chrome.runtime msg            | chrome.tabs.sendMessage
           v                               v
+---------------------+        +-------------------------+
|  chrome.storage     |        |  Content Script         |
|  .local             |        |  - Field scanner        |
|  - profile          |        |  - Record listeners     |
|  - settings         |        |  - Fill executor        |
+---------------------+        |  - Missing-field UI     |
                               +-------------------------+
                                    (runs on every page)
```

### Components

1. **Popup** (`popup.html`, `popup.js`, `popup.css`)
   Toolbar UI. Buttons: Start/Stop Recording, Fill This Page, Manage Profile, Settings. Shows current mode (idle / recording).

2. **Background Service Worker** (`background.js`)
   Owns Gemini calls. The popup and content script never touch the API key directly; they ask background to do matching for them. Why: keeps the key out of page context and centralizes rate-limit/error handling.

3. **Content Script** (`content.js`, `content.css`)
   Injected on all `http(s)` pages. Idle by default. Activated via messages from the popup. Three responsibilities:
   - Scan the page for fillable fields.
   - In Record mode, attach listeners and capture values as the user types.
   - In Fill mode, apply values returned by Gemini, then surface any unfilled fields.

4. **Storage Layer** (`storage.js`)
   Thin wrapper over `chrome.storage.local`. Two keys:
   - `profile` — `{ [label: string]: string }` map of generic labels to values.
   - `settings` — `{ apiKey: string, model: string }`.

5. **Gemini Client** (`gemini.js`, used inside background)
   Single function: given a profile and a list of fields with their labels and (for selects) options, return `{fieldId → valueToFill}`. Uses Gemini 2.x Flash via `generativelanguage.googleapis.com/v1beta` REST endpoint with the user's free-tier API key. JSON mode response.

## Data Model

### Profile (stored under `profile`)

A flat map. Keys are normalized labels; values are strings.

```json
{
  "First Name": "Umesh",
  "Last Name": "Ravuru",
  "Email": "umesh@example.com",
  "Phone": "555-123-4567",
  "Years of experience with Python": "5",
  "Work authorization": "US Citizen",
  "Country": "United States",
  "LinkedIn URL": "https://linkedin.com/in/...",
  "Willing to relocate": "Yes"
}
```

Label normalization rule: trim whitespace, collapse internal whitespace to single spaces, strip trailing `*` / `:` / `(required)`. Preserve original capitalization. No site-specific selectors are ever stored.

### Settings (stored under `settings`)

```json
{
  "apiKey": "AIza...",
  "model": "gemini-2.5-flash"
}
```

## Field Detection

The content script scans for these elements inside `<form>` and outside (some sites skip form tags):

- `<input>` of types: `text`, `email`, `tel`, `url`, `number`, `date`, `radio`, `checkbox`
- `<textarea>`
- `<select>` (single and multi)
- ARIA combobox patterns (`role="combobox"`) — best-effort

Explicitly skipped: `<input type="file">`, `<input type="password">`, `<input type="hidden">`, `<input type="submit">`, `<input type="button">`, anything inside an element marked `data-apply-plugin-skip`.

### Label resolution (in order, first hit wins)

1. `<label for="id">` text content.
2. Wrapping `<label>` text content.
3. `aria-labelledby` target element text.
4. `aria-label` attribute.
5. `placeholder` attribute.
6. Nearest preceding text node within the same row/container (heuristic: walk up to closest block ancestor, take last text before the input).
7. `name` attribute, prettified (camelCase → "Camel Case").

If none yield text, the field is logged but excluded from record/fill.

### Field IDs

The content script assigns each scanned field a transient ID (`apf-<n>`) for the duration of one fill operation. IDs are not persisted.

## Record Flow

1. User clicks "Start Recording" in popup. Popup sends `{action: "record:start"}` to the active tab's content script.
2. Content script scans the page, then attaches `change` and `blur` listeners to every fillable field.
3. As the user types/selects, each change is captured in an in-memory map `{label → value}` (last-write-wins per label).
4. User clicks "Stop Recording". Popup sends `{action: "record:stop"}`. Content script returns the captured map.
5. Popup merges the captured map into the stored profile (new labels added, existing labels updated only if value changed). Shows a brief confirmation: "Saved N fields."

Edge cases:
- Empty values are not recorded (don't overwrite existing profile entries with blanks).
- Password fields are never captured (already excluded from field scan).
- If the user navigates away mid-recording, content script saves the in-memory map to a temporary `chrome.storage.local` key on `beforeunload`, popup recovers it on next open.

## Fill Flow

1. User clicks "Fill This Page" in popup. Popup sends `{action: "fill:start"}` to content script.
2. Content script scans the page and builds a field manifest:
   ```json
   [
     {"id": "apf-1", "label": "First Name", "type": "text"},
     {"id": "apf-2", "label": "Country", "type": "select",
      "options": [{"value": "US", "text": "United States"}, ...]},
     {"id": "apf-3", "label": "Authorized to work in US?", "type": "radio",
      "options": [{"value": "yes", "text": "Yes"}, {"value": "no", "text": "No"}]}
   ]
   ```
3. Content script sends the manifest plus current profile to background via `chrome.runtime.sendMessage`.
4. Background calls Gemini with a single prompt (see Prompt Contract below). Gemini returns:
   ```json
   {
     "fills": [
       {"id": "apf-1", "value": "Umesh"},
       {"id": "apf-2", "value": "US"},
       {"id": "apf-3", "value": "yes"}
     ],
     "missing": ["apf-4", "apf-5"]
   }
   ```
   For selects/radios, `value` is the exact option `value` string from the manifest. For free-text fields, `value` is the string to type. `missing` lists fields Gemini couldn't confidently match from the profile.
5. Content script applies fills:
   - Text/textarea: set `.value`, dispatch `input` and `change` events (so React/Angular state updates).
   - Select: set `.value`, dispatch `change`.
   - Radio/checkbox: set `.checked = true` on the matching option, dispatch `change`.
6. For each field in `missing`, content script shows an inline missing-fields panel listing them. User fills them; on submit, panel sends `{action: "fill:learn", values: {label: value}}` to popup which writes them into the profile, and the content script fills the page with those values.

### Prompt Contract (background → Gemini)

System prompt (fixed):
> You are filling a job application form. You receive a user profile (a flat object of label→value pairs) and a list of form fields. For each field, return the value to fill, or omit it from `fills` and add its id to `missing` if no profile entry confidently matches.
>
> Rules:
> - For `text` / `textarea`: return the profile value as-is if a label maps clearly.
> - For `select` / `radio`: return the exact `value` of the option whose `text` best matches the profile value (case-insensitive, abbreviation-aware: "United States" matches "US"/"USA"; "5 years" matches "5"). Never invent option values.
> - Match labels semantically, not literally ("Years of experience in Python" matches profile key "Python experience").
> - If a profile value is empty or no key matches, mark the field missing.
> - Return strict JSON: `{"fills": [{"id","value"}], "missing": ["id", ...]}`.

User content:
```json
{
  "profile": { ... },
  "fields": [ ... manifest ... ]
}
```

Model: `gemini-2.5-flash`. Response MIME: `application/json`. Temperature: 0.

### Token & Rate-Limit Posture

One fill = one API call. A typical job application page has 10-40 fields; profile is small. Well within Gemini free tier (15 req/min, 1500 req/day on Flash as of writing). On 429, surface "Rate limit hit, wait a minute" in the popup; no retries.

## Missing-Field UX

When fill completes with `missing` non-empty, content script injects a fixed-position panel (bottom-right) listing each missing field's label with an input. Submit button writes them into the profile and fills the page. Close button skips (user fills manually).

Correcting a wrong fill (no special UI in v1): the user edits the value directly in the page input. If Record mode is then run again on the same page, the corrected value overwrites the prior profile entry (label is the same). An inline "edit this field's profile value" UI is deferred to v2.

## Settings & Profile Management

- **Settings**: API key input (password-masked), model dropdown (defaults to `gemini-2.5-flash`), "Test connection" button that hits a 1-token Gemini call and confirms. Stored in `chrome.storage.local` under `settings`.
- **Manage Profile**: Lists all `{label, value}` entries with edit/delete per row, plus "Export JSON" and "Import JSON" for manual backup.

## Error Handling

- No API key set: popup blocks Fill, shows "Set your Gemini API key in Settings."
- API call fails (network, 4xx, 5xx): popup shows the error; nothing is filled. Profile and storage are untouched.
- Gemini returns invalid JSON: popup shows "AI response unparseable — try again." (One retry, then surface.)
- Profile is empty on Fill: popup shows "Profile is empty — record a page first." Fill is not attempted.

## Privacy & Security

- API key and profile live only in `chrome.storage.local` (per-profile, per-machine).
- The Gemini call sends profile + field labels + dropdown options. Field values from the page (what's already typed) are not sent. Document this in the Settings page.
- No analytics, no telemetry, no remote backend.

## File Layout

```
apply_plugin/
  manifest.json
  background.js
  popup/
    popup.html
    popup.css
    popup.js
  content/
    content.js
    content.css
  lib/
    storage.js       (chrome.storage wrapper)
    gemini.js        (Gemini REST client; imported by background)
    fields.js        (scan + label resolution + fill executor; imported by content)
    messages.js      (message-type constants shared across surfaces)
  icons/
    16.png, 48.png, 128.png
  README.md
```

Each `lib/*.js` file is a single-purpose module under ~200 lines. `content.js` and `background.js` orchestrate; they don't contain low-level logic.

## Manifest Permissions

```json
{
  "manifest_version": 3,
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://generativelanguage.googleapis.com/*"],
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup/popup.html" },
  "content_scripts": [{
    "matches": ["http://*/*", "https://*/*"],
    "js": ["content/content.js"],
    "css": ["content/content.css"],
    "run_at": "document_idle"
  }]
}
```

`activeTab` is used so the popup only addresses messages to the currently focused tab when triggered. Content scripts are statically declared (no dynamic `chrome.scripting.executeScript`), so the `scripting` permission is not needed.

## Testing Strategy

Manual end-to-end is primary (this is a UI-heavy extension). Automated coverage where it pays off:

- **Unit tests** for `lib/fields.js` (label resolution given fixture HTML) and `lib/gemini.js` (prompt construction, response parsing) using Vitest + jsdom. Run with `npm test`.
- **No** unit tests for popup/background message plumbing — covered by manual flow checks.

**Manual test checklist** (documented in README):
1. Record on a known site (e.g., a Greenhouse demo form). Verify profile entries saved.
2. Fill on a fresh Greenhouse posting. Verify text + dropdowns fill correctly.
3. Fill on a Workday posting. Verify dropdown matching ("United States" ↔ "US").
4. Fill with one new field on the page. Verify missing-field panel appears and saves.
5. Disconnect network, try Fill. Verify error message, no partial state.
6. Open Manage Profile, edit a value, fill again. Verify new value used.

## Open Decisions (None blocking implementation)

- Icon assets — placeholder PNGs until real ones are designed.
- Whether to add JSON export/import in v1 or defer (currently planned for v1 since it's cheap insurance against losing the profile).

## Out of Scope (Explicitly Deferred)

- Resume upload automation.
- Cross-device sync (Chrome sync storage or remote).
- Auto-advancing through multi-step flows.
- Browser-side LLM (Ollama / Web LLM).
- Firefox/Safari ports.
