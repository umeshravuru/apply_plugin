# Apply Plugin Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Manifest V3 Chrome extension that records values entered on job application pages, then fills new application pages from a stored profile, using Gemini free tier for semantic label matching and dropdown option selection.

**Architecture:** Vanilla JS, no build step. Popup → background service worker → content script. Background owns Gemini API calls; content script does DOM scan / record / fill; popup is the UI. Storage is `chrome.storage.local`.

**Tech Stack:** Chrome Extensions Manifest V3, vanilla ES modules, `chrome.storage.local`, Gemini 2.5 Flash REST API, Vitest + jsdom for unit tests.

**Spec:** `docs/superpowers/specs/2026-05-24-apply-plugin-design.md`

---

## Project Layout

Final structure after all tasks:

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
    storage.js
    gemini.js
    fields.js
    messages.js
  icons/
    16.png
    48.png
    128.png
  tests/
    fields.test.js
    gemini.test.js
  package.json
  vitest.config.js
  README.md
```

Each `lib/*.js` file is a single-purpose module. `background.js`, `popup/popup.js`, `content/content.js` are orchestrators that import from `lib/`.

---

## Task 1: Set up project scaffolding and test runner

**Files:**
- Create: `package.json`
- Create: `vitest.config.js`
- Create: `.gitignore`

**Why this first:** We need `npm test` working before TDD on the library modules.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "apply-plugin",
  "version": "0.1.0",
  "description": "Chrome extension that records and auto-fills job application forms.",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "devDependencies": {
    "vitest": "^1.6.0",
    "jsdom": "^24.0.0"
  }
}
```

- [ ] **Step 2: Create `vitest.config.js`**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Create `.gitignore`**

```
node_modules/
.DS_Store
*.log
dist/
```

- [ ] **Step 4: Install deps**

Run: `npm install`
Expected: completes successfully, creates `node_modules/` and `package-lock.json`.

- [ ] **Step 5: Verify test runner works**

Run: `npm test`
Expected: Vitest runs, reports "No test files found" (exit code 1) — confirms it's installed and configured. We'll add tests next.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json vitest.config.js .gitignore
git commit -m "Scaffold project with Vitest"
```

---

## Task 2: Shared message-type constants

**Files:**
- Create: `lib/messages.js`

**Why:** Both popup, background, and content script send messages. Centralizing the type strings prevents typos and keeps surfaces in sync.

- [ ] **Step 1: Create `lib/messages.js`**

```js
// Message types exchanged between popup, background, and content script.
// All cross-context messages MUST use these constants.

export const MSG = {
  // popup → content
  RECORD_START: 'record:start',
  RECORD_STOP: 'record:stop',
  FILL_START: 'fill:start',

  // content → popup (responses to the above)
  // (responses are just { ok, data, error })

  // content → background
  GEMINI_MATCH: 'gemini:match',

  // popup → background / background → popup
  GEMINI_TEST: 'gemini:test',

  // popup → content (after missing-field panel submit)
  FILL_LEARNED: 'fill:learned',
};
```

- [ ] **Step 2: Commit**

```bash
git add lib/messages.js
git commit -m "Add shared message-type constants"
```

---

## Task 3: Storage wrapper — profile + settings

**Files:**
- Create: `lib/storage.js`
- Create: `tests/storage.test.js`

**Why:** Profile and settings persistence is foundational. Wrap `chrome.storage.local` so tests can mock it.

- [ ] **Step 1: Write the failing tests**

Create `tests/storage.test.js`:

```js
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProfile, setProfile, mergeProfile,
  getSettings, setSettings, normalizeLabel,
} from '../lib/storage.js';

function mockChromeStorage() {
  const data = {};
  globalThis.chrome = {
    storage: {
      local: {
        get: vi.fn(async (keys) => {
          const out = {};
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
            if (k in data) out[k] = data[k];
          });
          return out;
        }),
        set: vi.fn(async (obj) => { Object.assign(data, obj); }),
      },
    },
  };
  return data;
}

describe('normalizeLabel', () => {
  it('trims and collapses whitespace', () => {
    expect(normalizeLabel('  First   Name  ')).toBe('First Name');
  });
  it('strips trailing * and :', () => {
    expect(normalizeLabel('Email *')).toBe('Email');
    expect(normalizeLabel('Phone:')).toBe('Phone');
  });
  it('strips (required) suffix', () => {
    expect(normalizeLabel('Name (required)')).toBe('Name');
  });
  it('preserves internal capitalization', () => {
    expect(normalizeLabel('LinkedIn URL')).toBe('LinkedIn URL');
  });
});

describe('profile storage', () => {
  beforeEach(() => { mockChromeStorage(); });

  it('returns empty object when no profile saved', async () => {
    expect(await getProfile()).toEqual({});
  });

  it('saves and retrieves profile', async () => {
    await setProfile({ Email: 'a@b.com' });
    expect(await getProfile()).toEqual({ Email: 'a@b.com' });
  });

  it('merges new labels into existing profile', async () => {
    await setProfile({ Email: 'a@b.com' });
    await mergeProfile({ Phone: '555-1212' });
    expect(await getProfile()).toEqual({ Email: 'a@b.com', Phone: '555-1212' });
  });

  it('merge overwrites existing labels with new non-empty values', async () => {
    await setProfile({ Email: 'old@x.com' });
    await mergeProfile({ Email: 'new@x.com' });
    expect((await getProfile()).Email).toBe('new@x.com');
  });

  it('merge ignores empty/whitespace values (no clobbering)', async () => {
    await setProfile({ Email: 'a@b.com' });
    await mergeProfile({ Email: '   ' });
    expect((await getProfile()).Email).toBe('a@b.com');
  });

  it('merge normalizes label keys before storing', async () => {
    await mergeProfile({ '  First  Name *  ': 'Umesh' });
    const p = await getProfile();
    expect(p['First Name']).toBe('Umesh');
  });
});

describe('settings storage', () => {
  beforeEach(() => { mockChromeStorage(); });

  it('returns defaults when no settings saved', async () => {
    expect(await getSettings()).toEqual({ apiKey: '', model: 'gemini-2.5-flash' });
  });

  it('saves and retrieves settings', async () => {
    await setSettings({ apiKey: 'AIza123', model: 'gemini-2.5-flash' });
    expect(await getSettings()).toEqual({ apiKey: 'AIza123', model: 'gemini-2.5-flash' });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../lib/storage.js` not found.

- [ ] **Step 3: Implement `lib/storage.js`**

```js
const PROFILE_KEY = 'profile';
const SETTINGS_KEY = 'settings';
const DEFAULT_SETTINGS = { apiKey: '', model: 'gemini-2.5-flash' };

export function normalizeLabel(raw) {
  if (raw == null) return '';
  let s = String(raw).replace(/\s+/g, ' ').trim();
  s = s.replace(/\s*\(required\)\s*$/i, '');
  s = s.replace(/[*:]+\s*$/g, '');
  return s.trim();
}

export async function getProfile() {
  const out = await chrome.storage.local.get(PROFILE_KEY);
  return out[PROFILE_KEY] ?? {};
}

export async function setProfile(profile) {
  await chrome.storage.local.set({ [PROFILE_KEY]: profile });
}

export async function mergeProfile(updates) {
  const existing = await getProfile();
  for (const [rawKey, rawVal] of Object.entries(updates)) {
    const key = normalizeLabel(rawKey);
    if (!key) continue;
    const val = typeof rawVal === 'string' ? rawVal : String(rawVal ?? '');
    if (val.trim() === '') continue;
    existing[key] = val;
  }
  await setProfile(existing);
}

export async function getSettings() {
  const out = await chrome.storage.local.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(out[SETTINGS_KEY] ?? {}) };
}

export async function setSettings(settings) {
  await chrome.storage.local.set({ [SETTINGS_KEY]: settings });
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all 11 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/storage.js tests/storage.test.js
git commit -m "Add storage wrapper for profile and settings"
```

---

## Task 4: Field detection + label resolution

**Files:**
- Create: `lib/fields.js`
- Create: `tests/fields.test.js`

**Why:** Both record and fill flows need to scan the DOM for fillable fields and resolve a human-readable label per field. This logic is testable in jsdom, so unit-test it before wiring it into the content script.

This module exposes:
- `scanFields(root)` → array of `{el, id, type, label, options?}`
- `resolveLabel(el)` → string (used by scan; exported for testability)
- `applyFill(el, value)` → fills one element, dispatching `input`/`change` events
- `isFillable(el)` → boolean

- [ ] **Step 1: Write the failing tests**

Create `tests/fields.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { scanFields, resolveLabel, isFillable, applyFill } from '../lib/fields.js';

function setHtml(html) {
  document.body.innerHTML = html;
}

describe('isFillable', () => {
  beforeEach(() => setHtml(''));

  it('accepts text inputs', () => {
    setHtml('<input id="x" type="text">');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('accepts textareas', () => {
    setHtml('<textarea id="x"></textarea>');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('accepts selects', () => {
    setHtml('<select id="x"><option>a</option></select>');
    expect(isFillable(document.getElementById('x'))).toBe(true);
  });
  it('rejects file inputs', () => {
    setHtml('<input id="x" type="file">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects password inputs', () => {
    setHtml('<input id="x" type="password">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects hidden inputs', () => {
    setHtml('<input id="x" type="hidden">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects submit/button inputs', () => {
    setHtml('<input id="x" type="submit">');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
  it('rejects elements inside [data-apply-plugin-skip]', () => {
    setHtml('<div data-apply-plugin-skip><input id="x" type="text"></div>');
    expect(isFillable(document.getElementById('x'))).toBe(false);
  });
});

describe('resolveLabel', () => {
  beforeEach(() => setHtml(''));

  it('uses <label for> when available', () => {
    setHtml('<label for="x">First Name</label><input id="x" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('First Name');
  });

  it('uses wrapping <label> when no for', () => {
    setHtml('<label>Email <input id="x" type="email"></label>');
    expect(resolveLabel(document.getElementById('x'))).toBe('Email');
  });

  it('uses aria-labelledby', () => {
    setHtml('<span id="lbl">Phone</span><input id="x" aria-labelledby="lbl" type="tel">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Phone');
  });

  it('uses aria-label', () => {
    setHtml('<input id="x" aria-label="LinkedIn URL" type="url">');
    expect(resolveLabel(document.getElementById('x'))).toBe('LinkedIn URL');
  });

  it('uses placeholder when no label/aria', () => {
    setHtml('<input id="x" placeholder="Your name" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Your name');
  });

  it('uses nearest preceding text in the same row when no label/aria/placeholder', () => {
    setHtml('<div class="row">Country of residence <input id="x" type="text"></div>');
    expect(resolveLabel(document.getElementById('x'))).toBe('Country of residence');
  });

  it('falls back to prettified name attribute', () => {
    setHtml('<input id="x" name="firstName" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('First Name');
  });

  it('returns empty string if nothing resolves', () => {
    setHtml('<input id="x" type="text">');
    expect(resolveLabel(document.getElementById('x'))).toBe('');
  });

  it('normalizes the resolved label', () => {
    setHtml('<label for="x">Email *</label><input id="x" type="email">');
    expect(resolveLabel(document.getElementById('x'))).toBe('Email');
  });
});

describe('scanFields', () => {
  beforeEach(() => setHtml(''));

  it('returns fields with id, type, label', () => {
    setHtml(`
      <label for="a">First Name</label><input id="a" type="text">
      <label for="b">Email</label><input id="b" type="email">
    `);
    const fields = scanFields(document.body);
    expect(fields.length).toBe(2);
    expect(fields[0].label).toBe('First Name');
    expect(fields[0].type).toBe('text');
    expect(fields[0].id).toMatch(/^apf-/);
    expect(fields[1].label).toBe('Email');
  });

  it('includes options for selects', () => {
    setHtml(`
      <label for="c">Country</label>
      <select id="c">
        <option value="us">United States</option>
        <option value="ca">Canada</option>
      </select>
    `);
    const [field] = scanFields(document.body);
    expect(field.type).toBe('select');
    expect(field.options).toEqual([
      { value: 'us', text: 'United States' },
      { value: 'ca', text: 'Canada' },
    ]);
  });

  it('groups radio buttons by name with options', () => {
    setHtml(`
      <label>Authorized to work?</label>
      <label><input type="radio" name="auth" value="yes"> Yes</label>
      <label><input type="radio" name="auth" value="no"> No</label>
    `);
    const fields = scanFields(document.body);
    const radioGroup = fields.find((f) => f.type === 'radio');
    expect(radioGroup).toBeDefined();
    expect(radioGroup.options).toEqual([
      { value: 'yes', text: 'Yes' },
      { value: 'no', text: 'No' },
    ]);
  });

  it('skips fields with no resolvable label', () => {
    setHtml('<input id="x" type="text">');
    expect(scanFields(document.body)).toEqual([]);
  });

  it('skips file/password/hidden/submit inputs', () => {
    setHtml(`
      <label for="a">Resume</label><input id="a" type="file">
      <label for="b">Password</label><input id="b" type="password">
    `);
    expect(scanFields(document.body)).toEqual([]);
  });

  it('assigns unique transient ids', () => {
    setHtml(`
      <label for="a">One</label><input id="a" type="text">
      <label for="b">Two</label><input id="b" type="text">
    `);
    const fields = scanFields(document.body);
    const ids = fields.map((f) => f.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('applyFill', () => {
  beforeEach(() => setHtml(''));

  it('fills text inputs and dispatches input + change', () => {
    setHtml('<input id="x" type="text">');
    const el = document.getElementById('x');
    let inputFired = false, changeFired = false;
    el.addEventListener('input', () => { inputFired = true; });
    el.addEventListener('change', () => { changeFired = true; });
    applyFill(el, 'Hello');
    expect(el.value).toBe('Hello');
    expect(inputFired).toBe(true);
    expect(changeFired).toBe(true);
  });

  it('fills textareas', () => {
    setHtml('<textarea id="x"></textarea>');
    const el = document.getElementById('x');
    applyFill(el, 'Long text');
    expect(el.value).toBe('Long text');
  });

  it('fills selects by value and dispatches change', () => {
    setHtml('<select id="x"><option value="us">United States</option><option value="ca">Canada</option></select>');
    const el = document.getElementById('x');
    let changed = false;
    el.addEventListener('change', () => { changed = true; });
    applyFill(el, 'ca');
    expect(el.value).toBe('ca');
    expect(changed).toBe(true);
  });

  it('checks the matching radio in a group', () => {
    setHtml('<input type="radio" name="g" value="yes"><input type="radio" name="g" value="no">');
    // applyFill receives the group representative (first radio) and the value.
    const first = document.querySelector('input[name="g"][value="yes"]');
    applyFill(first, 'no');
    expect(document.querySelector('input[name="g"][value="no"]').checked).toBe(true);
    expect(document.querySelector('input[name="g"][value="yes"]').checked).toBe(false);
  });

  it('checks a standalone checkbox when value is truthy', () => {
    setHtml('<input id="x" type="checkbox">');
    const el = document.getElementById('x');
    applyFill(el, 'yes');
    expect(el.checked).toBe(true);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../lib/fields.js` not found.

- [ ] **Step 3: Implement `lib/fields.js`**

```js
import { normalizeLabel } from './storage.js';

const TEXT_INPUT_TYPES = new Set(['text', 'email', 'tel', 'url', 'number', 'date', 'search']);

export function isFillable(el) {
  if (!el || !el.tagName) return false;
  if (el.closest('[data-apply-plugin-skip]')) return false;
  const tag = el.tagName.toLowerCase();
  if (tag === 'textarea' || tag === 'select') return true;
  if (tag !== 'input') return false;
  const type = (el.type || 'text').toLowerCase();
  if (type === 'radio' || type === 'checkbox') return true;
  return TEXT_INPUT_TYPES.has(type);
}

function prettify(name) {
  if (!name) return '';
  return name
    .replace(/[_\-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function resolveLabel(el) {
  if (!el) return '';
  // 1. <label for="id">
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl && lbl.textContent.trim()) return normalizeLabel(lbl.textContent);
  }
  // 2. wrapping <label>
  const wrap = el.closest('label');
  if (wrap) {
    // text content minus the input itself
    const clone = wrap.cloneNode(true);
    clone.querySelectorAll('input, textarea, select').forEach((n) => n.remove());
    const text = clone.textContent.trim();
    if (text) return normalizeLabel(text);
  }
  // 3. aria-labelledby
  const ariaLbl = el.getAttribute('aria-labelledby');
  if (ariaLbl) {
    const target = el.ownerDocument.getElementById(ariaLbl);
    if (target && target.textContent.trim()) return normalizeLabel(target.textContent);
  }
  // 4. aria-label
  const aria = el.getAttribute('aria-label');
  if (aria && aria.trim()) return normalizeLabel(aria);
  // 5. placeholder
  const ph = el.getAttribute('placeholder');
  if (ph && ph.trim()) return normalizeLabel(ph);
  // 6. nearest preceding text in the same block ancestor
  const nearby = nearestPrecedingText(el);
  if (nearby) return normalizeLabel(nearby);
  // 7. name attribute prettified
  const name = el.getAttribute('name');
  if (name && name.trim()) return normalizeLabel(prettify(name));
  return '';
}

function nearestPrecedingText(el) {
  // Walk up to the closest block-ish ancestor (div, p, fieldset, td, li, tr).
  let container = el.parentElement;
  while (container && !['DIV', 'P', 'FIELDSET', 'TD', 'LI', 'TR', 'SECTION'].includes(container.tagName)) {
    container = container.parentElement;
  }
  if (!container) return '';
  // Collect text nodes that precede the element in document order within the container.
  const walker = container.ownerDocument.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  const collected = [];
  let node;
  while ((node = walker.nextNode())) {
    const cmp = node.compareDocumentPosition(el);
    // el follows the text node
    if (cmp & Node.DOCUMENT_POSITION_FOLLOWING) {
      const t = node.textContent.trim();
      if (t) collected.push(t);
    } else {
      break;
    }
  }
  // Take the last preceding text fragment (closest in document order).
  return collected.length ? collected[collected.length - 1] : '';
}

function selectOptions(selectEl) {
  return Array.from(selectEl.options).map((o) => ({
    value: o.value,
    text: (o.textContent || '').trim(),
  }));
}

function radioGroupOptions(doc, name) {
  const radios = doc.querySelectorAll(`input[type="radio"][name="${CSS.escape(name)}"]`);
  return Array.from(radios).map((r) => {
    // option text: associated label or sibling text
    let text = '';
    if (r.id) {
      const lbl = doc.querySelector(`label[for="${CSS.escape(r.id)}"]`);
      if (lbl) text = lbl.textContent.trim();
    }
    if (!text) {
      const wrap = r.closest('label');
      if (wrap) {
        const clone = wrap.cloneNode(true);
        clone.querySelectorAll('input').forEach((n) => n.remove());
        text = clone.textContent.trim();
      }
    }
    return { value: r.value, text: text || r.value };
  });
}

export function scanFields(root) {
  const doc = root.ownerDocument || document;
  const all = root.querySelectorAll('input, textarea, select');
  const fields = [];
  const seenRadioGroups = new Set();
  let counter = 0;

  for (const el of all) {
    if (!isFillable(el)) continue;
    const tag = el.tagName.toLowerCase();
    const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;

    if (type === 'radio') {
      const name = el.name;
      if (!name || seenRadioGroups.has(name)) continue;
      seenRadioGroups.add(name);
      // label: try to find a grouping label (legend, preceding heading) or use name
      // We look for a fieldset > legend, otherwise resolveLabel on this radio.
      const fieldset = el.closest('fieldset');
      let label = '';
      if (fieldset) {
        const legend = fieldset.querySelector('legend');
        if (legend && legend.textContent.trim()) label = normalizeLabel(legend.textContent);
      }
      if (!label) label = resolveLabel(el);
      if (!label) continue;
      fields.push({
        el,
        id: `apf-${++counter}`,
        type: 'radio',
        label,
        options: radioGroupOptions(doc, name),
      });
      continue;
    }

    const label = resolveLabel(el);
    if (!label) continue;

    const field = { el, id: `apf-${++counter}`, type, label };
    if (type === 'select' || tag === 'select') {
      field.type = 'select';
      field.options = selectOptions(el);
    } else if (type === 'checkbox') {
      field.type = 'checkbox';
    } else if (tag === 'textarea') {
      field.type = 'textarea';
    } else {
      field.type = 'text';
    }
    fields.push(field);
  }
  return fields;
}

function fire(el, evt) {
  el.dispatchEvent(new Event(evt, { bubbles: true }));
}

export function applyFill(el, value) {
  const tag = el.tagName.toLowerCase();
  const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;

  if (type === 'radio') {
    const radios = el.ownerDocument.querySelectorAll(
      `input[type="radio"][name="${CSS.escape(el.name)}"]`
    );
    for (const r of radios) {
      const match = r.value === value;
      if (match !== r.checked) {
        r.checked = match;
        if (match) fire(r, 'change');
      }
    }
    return;
  }
  if (type === 'checkbox') {
    const truthy = ['yes', 'true', '1', 'on', 'checked'].includes(String(value).toLowerCase());
    if (el.checked !== truthy) {
      el.checked = truthy;
      fire(el, 'change');
    }
    return;
  }
  // text, textarea, select
  el.value = value;
  fire(el, 'input');
  fire(el, 'change');
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all field tests pass (plus the storage tests from before).

- [ ] **Step 5: Commit**

```bash
git add lib/fields.js tests/fields.test.js
git commit -m "Add field scanner, label resolver, and fill executor"
```

---

## Task 5: Gemini client — prompt construction + response parsing

**Files:**
- Create: `lib/gemini.js`
- Create: `tests/gemini.test.js`

**Why:** The Gemini call is the brittle bit. Unit-test prompt assembly and response parsing so we don't need live API calls to know it works.

The module exposes:
- `buildPrompt(profile, fields)` → `{ systemInstruction, contents }` (Gemini REST body fragments)
- `parseResponse(rawText)` → `{ fills: [{id, value}], missing: [id] }`
- `matchFields({ profile, fields, apiKey, model, fetchImpl })` → calls Gemini, returns parsed result
- `testConnection({ apiKey, model, fetchImpl })` → throws on failure

- [ ] **Step 1: Write the failing tests**

Create `tests/gemini.test.js`:

```js
import { describe, it, expect, vi } from 'vitest';
import { buildPrompt, parseResponse, matchFields, testConnection } from '../lib/gemini.js';

describe('buildPrompt', () => {
  it('includes profile and fields in the user content as JSON', () => {
    const out = buildPrompt(
      { 'First Name': 'Umesh' },
      [{ id: 'apf-1', label: 'First Name', type: 'text' }]
    );
    const text = out.contents[0].parts[0].text;
    expect(text).toContain('"First Name"');
    expect(text).toContain('"apf-1"');
  });

  it('declares the JSON response schema in system instruction', () => {
    const out = buildPrompt({}, []);
    expect(out.systemInstruction.parts[0].text).toMatch(/fills/);
    expect(out.systemInstruction.parts[0].text).toMatch(/missing/);
  });
});

describe('parseResponse', () => {
  it('parses a clean JSON response', () => {
    const raw = JSON.stringify({
      fills: [{ id: 'apf-1', value: 'Umesh' }],
      missing: ['apf-2'],
    });
    expect(parseResponse(raw)).toEqual({
      fills: [{ id: 'apf-1', value: 'Umesh' }],
      missing: ['apf-2'],
    });
  });

  it('strips code fences if present', () => {
    const raw = '```json\n{"fills":[],"missing":[]}\n```';
    expect(parseResponse(raw)).toEqual({ fills: [], missing: [] });
  });

  it('returns empty result on malformed JSON', () => {
    expect(parseResponse('not json at all')).toEqual({ fills: [], missing: [] });
  });

  it('defaults missing fields/missing keys to []', () => {
    expect(parseResponse('{}')).toEqual({ fills: [], missing: [] });
  });

  it('filters out fill entries without id or value', () => {
    const raw = JSON.stringify({ fills: [{ id: 'apf-1' }, { value: 'x' }, { id: 'apf-2', value: 'y' }] });
    expect(parseResponse(raw).fills).toEqual([{ id: 'apf-2', value: 'y' }]);
  });
});

describe('matchFields', () => {
  it('calls the Gemini REST endpoint with the API key and returns parsed fills', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        candidates: [{ content: { parts: [{ text: '{"fills":[{"id":"apf-1","value":"Umesh"}],"missing":[]}' }] } }],
      }),
    }));
    const result = await matchFields({
      profile: { 'First Name': 'Umesh' },
      fields: [{ id: 'apf-1', label: 'First Name', type: 'text' }],
      apiKey: 'AIza123',
      model: 'gemini-2.5-flash',
      fetchImpl,
    });
    expect(result.fills).toEqual([{ id: 'apf-1', value: 'Umesh' }]);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toContain('gemini-2.5-flash');
    expect(url).toContain('key=AIza123');
    expect(init.method).toBe('POST');
    const body = JSON.parse(init.body);
    expect(body.generationConfig.responseMimeType).toBe('application/json');
    expect(body.generationConfig.temperature).toBe(0);
  });

  it('throws on non-ok HTTP response', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: false,
      status: 429,
      text: async () => 'Rate limited',
    }));
    await expect(matchFields({
      profile: {}, fields: [], apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl,
    })).rejects.toThrow(/429/);
  });
});

describe('testConnection', () => {
  it('returns ok:true on success', async () => {
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      json: async () => ({ candidates: [{ content: { parts: [{ text: '{}' }] } }] }),
    }));
    const result = await testConnection({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl });
    expect(result).toEqual({ ok: true });
  });

  it('throws on http error', async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 401, text: async () => 'bad key' }));
    await expect(testConnection({ apiKey: 'k', model: 'gemini-2.5-flash', fetchImpl })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — module `../lib/gemini.js` not found.

- [ ] **Step 3: Implement `lib/gemini.js`**

```js
const SYSTEM_INSTRUCTION = `You are filling a job application form. You receive a user profile (a flat object of label->value pairs) and a list of form fields. For each field, return the value to fill, or omit it from "fills" and add its id to "missing" if no profile entry confidently matches.

Rules:
- For "text"/"textarea": return the profile value as-is if a label maps clearly.
- For "select"/"radio": return the EXACT "value" string of the option whose "text" best matches the profile value (case-insensitive, abbreviation-aware: "United States" matches "US"/"USA"; "5 years" matches "5"). Never invent option values.
- For "checkbox": return "yes" to check, omit to leave unchecked. Use profile values like "Yes"/"No"/"true"/"false" to decide.
- Match labels semantically, not literally ("Years of experience in Python" matches profile key "Python experience").
- If a profile value is empty or no key confidently matches, mark the field missing.
- Return strict JSON: {"fills":[{"id":"...","value":"..."}],"missing":["...",...]}.
- No prose, no markdown, JSON only.`;

export function buildPrompt(profile, fields) {
  const userText = JSON.stringify({ profile, fields }, null, 2);
  return {
    systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
    contents: [{ role: 'user', parts: [{ text: userText }] }],
  };
}

export function parseResponse(rawText) {
  const empty = { fills: [], missing: [] };
  if (!rawText) return empty;
  let text = rawText.trim();
  // Strip ```json ... ``` fences if present.
  const fence = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fence) text = fence[1].trim();
  let parsed;
  try { parsed = JSON.parse(text); } catch { return empty; }
  if (!parsed || typeof parsed !== 'object') return empty;
  const fills = Array.isArray(parsed.fills)
    ? parsed.fills.filter((f) => f && typeof f.id === 'string' && typeof f.value === 'string')
    : [];
  const missing = Array.isArray(parsed.missing)
    ? parsed.missing.filter((m) => typeof m === 'string')
    : [];
  return { fills, missing };
}

function endpoint(model, apiKey) {
  return `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
}

function extractText(geminiJson) {
  return geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
}

export async function matchFields({ profile, fields, apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Gemini API key not set');
  const prompt = buildPrompt(profile, fields);
  const body = {
    ...prompt,
    generationConfig: {
      temperature: 0,
      responseMimeType: 'application/json',
    },
  };
  const res = await fetchImpl(endpoint(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }
  const json = await res.json();
  const text = extractText(json);
  return parseResponse(text);
}

export async function testConnection({ apiKey, model, fetchImpl = fetch }) {
  if (!apiKey) throw new Error('Gemini API key not set');
  const body = {
    contents: [{ role: 'user', parts: [{ text: 'Respond with {}' }] }],
    generationConfig: { temperature: 0, responseMimeType: 'application/json', maxOutputTokens: 8 },
  };
  const res = await fetchImpl(endpoint(model, apiKey), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Gemini API ${res.status}: ${errText}`);
  }
  return { ok: true };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: all gemini tests pass (plus the previously-added storage and fields tests).

- [ ] **Step 5: Commit**

```bash
git add lib/gemini.js tests/gemini.test.js
git commit -m "Add Gemini client with prompt and response handling"
```

---

## Task 6: Background service worker

**Files:**
- Create: `background.js`

**Why:** Background owns Gemini calls. It listens for `gemini:match` and `gemini:test` messages and routes to `lib/gemini.js`.

Service workers in MV3 can use ES modules when `"type":"module"` is set on the background entry.

- [ ] **Step 1: Implement `background.js`**

```js
import { MSG } from './lib/messages.js';
import { getSettings } from './lib/storage.js';
import { matchFields, testConnection } from './lib/gemini.js';

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;

  if (msg.type === MSG.GEMINI_MATCH) {
    (async () => {
      try {
        const { apiKey, model } = await getSettings();
        const result = await matchFields({
          profile: msg.profile,
          fields: msg.fields,
          apiKey,
          model,
        });
        sendResponse({ ok: true, data: result });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true; // keep the message channel open for async response
  }

  if (msg.type === MSG.GEMINI_TEST) {
    (async () => {
      try {
        const { apiKey, model } = await getSettings();
        await testConnection({ apiKey, model });
        sendResponse({ ok: true });
      } catch (err) {
        sendResponse({ ok: false, error: String(err.message || err) });
      }
    })();
    return true;
  }

  return false;
});
```

- [ ] **Step 2: Commit**

```bash
git add background.js
git commit -m "Add background service worker for Gemini calls"
```

---

## Task 7: Content script — record and fill

**Files:**
- Create: `content/content.js`
- Create: `content/content.css`

**Why:** This is the in-page agent. It scans, records, fills, and shows the missing-field panel.

- [ ] **Step 1: Implement `content/content.js`**

```js
import { MSG } from '../lib/messages.js';
import { mergeProfile, getProfile } from '../lib/storage.js';
import { scanFields, applyFill } from '../lib/fields.js';

const state = {
  recording: false,
  recordBuffer: new Map(), // label → value
  recordCleanup: null,     // function to remove listeners
  lastScan: [],            // last fill scan (so we can re-apply after missing-field submit)
};

function startRecording() {
  if (state.recording) return { ok: true, alreadyRecording: true };
  state.recording = true;
  state.recordBuffer.clear();
  const fields = scanFields(document.body);
  const handlers = [];
  for (const f of fields) {
    const handler = () => {
      let val = '';
      if (f.type === 'radio') {
        const checked = document.querySelector(
          `input[type="radio"][name="${CSS.escape(f.el.name)}"]:checked`
        );
        if (checked) val = checked.value;
      } else if (f.type === 'checkbox') {
        val = f.el.checked ? 'Yes' : 'No';
      } else {
        val = f.el.value;
      }
      if (val !== '') state.recordBuffer.set(f.label, val);
    };
    f.el.addEventListener('change', handler, true);
    f.el.addEventListener('blur', handler, true);
    // for radio groups, also listen on other radios with same name
    if (f.type === 'radio') {
      const radios = document.querySelectorAll(
        `input[type="radio"][name="${CSS.escape(f.el.name)}"]`
      );
      radios.forEach((r) => {
        r.addEventListener('change', handler, true);
        handlers.push([r, 'change', handler]);
      });
    } else {
      handlers.push([f.el, 'change', handler]);
      handlers.push([f.el, 'blur', handler]);
    }
  }
  state.recordCleanup = () => {
    handlers.forEach(([el, ev, h]) => el.removeEventListener(ev, h, true));
  };
  return { ok: true, fieldCount: fields.length };
}

function stopRecording() {
  if (!state.recording) return { ok: true, captured: {} };
  state.recording = false;
  if (state.recordCleanup) state.recordCleanup();
  state.recordCleanup = null;
  const captured = Object.fromEntries(state.recordBuffer);
  state.recordBuffer.clear();
  return { ok: true, captured };
}

async function startFill() {
  const fields = scanFields(document.body);
  state.lastScan = fields;
  if (fields.length === 0) return { ok: true, fills: [], missing: [], filled: 0 };

  const profile = await getProfile();
  if (Object.keys(profile).length === 0) {
    return { ok: false, error: 'Profile is empty — record a page first.' };
  }

  // Strip DOM refs before sending across runtime boundary.
  const fieldManifest = fields.map((f) => ({
    id: f.id, label: f.label, type: f.type, options: f.options,
  }));

  const response = await chrome.runtime.sendMessage({
    type: MSG.GEMINI_MATCH, profile, fields: fieldManifest,
  });

  if (!response || !response.ok) {
    return { ok: false, error: response?.error ?? 'No response from background' };
  }
  const { fills, missing } = response.data;
  applyFills(fields, fills);
  const missingDetails = missing.map((id) => {
    const f = fields.find((x) => x.id === id);
    return f ? { id, label: f.label, type: f.type, options: f.options } : null;
  }).filter(Boolean);
  if (missingDetails.length > 0) showMissingPanel(missingDetails);
  return { ok: true, filled: fills.length, missing: missingDetails.map((m) => m.label) };
}

function applyFills(fields, fills) {
  const byId = new Map(fields.map((f) => [f.id, f]));
  for (const { id, value } of fills) {
    const field = byId.get(id);
    if (!field) continue;
    try { applyFill(field.el, value); } catch (e) { console.warn('apply-plugin: fill failed', field.label, e); }
  }
}

function showMissingPanel(missing) {
  const existing = document.getElementById('apply-plugin-panel');
  if (existing) existing.remove();

  const panel = document.createElement('div');
  panel.id = 'apply-plugin-panel';
  panel.setAttribute('data-apply-plugin-skip', '');
  panel.innerHTML = `
    <div class="apf-panel-header">
      <strong>Apply Plugin — missing fields</strong>
      <button type="button" class="apf-close" aria-label="Close">&times;</button>
    </div>
    <p class="apf-hint">Fill these once. They'll be saved to your profile for next time.</p>
    <form class="apf-form"></form>
    <div class="apf-actions">
      <button type="submit" form="apf-missing-form" class="apf-save">Save &amp; fill</button>
    </div>
  `;
  const form = panel.querySelector('.apf-form');
  form.id = 'apf-missing-form';
  for (const m of missing) {
    const row = document.createElement('label');
    row.className = 'apf-row';
    row.innerHTML = `<span>${escapeHtml(m.label)}</span>`;
    let input;
    if (m.type === 'select' || m.type === 'radio') {
      input = document.createElement('select');
      input.innerHTML = `<option value="">— pick one —</option>` +
        (m.options || []).map((o) => `<option value="${escapeAttr(o.value)}">${escapeHtml(o.text)}</option>`).join('');
    } else if (m.type === 'checkbox') {
      input = document.createElement('select');
      input.innerHTML = '<option value="">—</option><option value="Yes">Yes</option><option value="No">No</option>';
    } else if (m.type === 'textarea') {
      input = document.createElement('textarea');
    } else {
      input = document.createElement('input');
      input.type = 'text';
    }
    input.name = m.id;
    input.dataset.label = m.label;
    row.appendChild(input);
    form.appendChild(row);
  }

  panel.querySelector('.apf-close').addEventListener('click', () => panel.remove());
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const updates = {};
    const fillById = [];
    for (const input of form.querySelectorAll('input, select, textarea')) {
      const val = input.value.trim();
      if (!val) continue;
      updates[input.dataset.label] = val;
      fillById.push({ id: input.name, value: val });
    }
    if (Object.keys(updates).length > 0) {
      await mergeProfile(updates);
      applyFills(state.lastScan, fillById);
    }
    panel.remove();
  });

  document.body.appendChild(panel);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  switch (msg.type) {
    case MSG.RECORD_START:
      sendResponse(startRecording());
      return false;
    case MSG.RECORD_STOP:
      sendResponse(stopRecording());
      return false;
    case MSG.FILL_START:
      startFill().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
      return true;
    default:
      return false;
  }
});
```

- [ ] **Step 2: Implement `content/content.css`**

```css
#apply-plugin-panel {
  position: fixed;
  bottom: 16px;
  right: 16px;
  width: 360px;
  max-height: 70vh;
  overflow-y: auto;
  background: #ffffff;
  color: #111111;
  border: 1px solid #d0d0d0;
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  z-index: 2147483646;
  padding: 12px 14px;
}
#apply-plugin-panel .apf-panel-header {
  display: flex; align-items: center; justify-content: space-between;
  margin-bottom: 6px;
}
#apply-plugin-panel .apf-close {
  background: none; border: none; font-size: 18px; cursor: pointer; padding: 0 4px;
}
#apply-plugin-panel .apf-hint { margin: 0 0 10px; color: #555; }
#apply-plugin-panel .apf-row {
  display: block; margin-bottom: 8px;
}
#apply-plugin-panel .apf-row span {
  display: block; font-weight: 600; margin-bottom: 4px;
}
#apply-plugin-panel input,
#apply-plugin-panel select,
#apply-plugin-panel textarea {
  width: 100%; box-sizing: border-box; padding: 6px 8px;
  border: 1px solid #c8c8c8; border-radius: 4px; font: inherit;
}
#apply-plugin-panel textarea { min-height: 60px; }
#apply-plugin-panel .apf-actions { margin-top: 8px; text-align: right; }
#apply-plugin-panel .apf-save {
  background: #2563eb; color: #fff; border: none; border-radius: 4px;
  padding: 6px 12px; font-weight: 600; cursor: pointer;
}
#apply-plugin-panel .apf-save:hover { background: #1d4ed8; }
```

- [ ] **Step 3: Commit**

```bash
git add content/content.js content/content.css
git commit -m "Add content script for record, fill, and missing-field panel"
```

---

## Task 8: Popup UI

**Files:**
- Create: `popup/popup.html`
- Create: `popup/popup.css`
- Create: `popup/popup.js`

**Why:** The user-facing surface. Three views: main (Record/Fill), Manage Profile, Settings.

- [ ] **Step 1: Implement `popup/popup.html`**

```html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Apply Plugin</title>
  <link rel="stylesheet" href="popup.css">
</head>
<body>
  <header>
    <h1>Apply Plugin</h1>
    <nav>
      <button data-view="main" class="active">Main</button>
      <button data-view="profile">Profile</button>
      <button data-view="settings">Settings</button>
    </nav>
  </header>

  <section id="view-main" class="view active">
    <button id="btn-record" class="primary">Start Recording</button>
    <button id="btn-fill" class="primary">Fill This Page</button>
    <p id="main-status" class="status"></p>
  </section>

  <section id="view-profile" class="view">
    <h2>Saved Profile</h2>
    <div id="profile-list"></div>
    <div class="row">
      <button id="btn-export">Export JSON</button>
      <button id="btn-import">Import JSON</button>
      <input type="file" id="import-file" accept="application/json" hidden>
    </div>
    <p id="profile-status" class="status"></p>
  </section>

  <section id="view-settings" class="view">
    <h2>Settings</h2>
    <label>
      Gemini API key
      <input type="password" id="api-key" placeholder="AIza...">
    </label>
    <label>
      Model
      <select id="model">
        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
        <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
      </select>
    </label>
    <div class="row">
      <button id="btn-save-settings" class="primary">Save</button>
      <button id="btn-test">Test connection</button>
    </div>
    <p id="settings-status" class="status"></p>
    <p class="hint">Get a free key at <span class="link">aistudio.google.com/apikey</span>. Stored locally; never sent anywhere except Google's Gemini API.</p>
  </section>

  <script type="module" src="popup.js"></script>
</body>
</html>
```

- [ ] **Step 2: Implement `popup/popup.css`**

```css
* { box-sizing: border-box; }
body {
  margin: 0; padding: 12px;
  width: 360px;
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
  font-size: 13px;
  color: #111;
}
header h1 { margin: 0 0 8px; font-size: 16px; }
nav { display: flex; gap: 4px; border-bottom: 1px solid #ddd; margin-bottom: 10px; }
nav button {
  background: none; border: none; padding: 6px 10px; cursor: pointer;
  border-bottom: 2px solid transparent; font: inherit;
}
nav button.active { border-bottom-color: #2563eb; font-weight: 600; }
.view { display: none; }
.view.active { display: block; }
button {
  font: inherit; padding: 6px 10px; border-radius: 4px; cursor: pointer;
  border: 1px solid #c8c8c8; background: #f6f6f6;
}
button.primary { background: #2563eb; color: #fff; border-color: #2563eb; font-weight: 600; }
button.primary:hover { background: #1d4ed8; }
#view-main button { display: block; width: 100%; margin-bottom: 8px; padding: 10px; }
.status { margin: 8px 0 0; min-height: 18px; color: #333; }
.status.error { color: #b91c1c; }
.status.ok { color: #047857; }
label { display: block; margin-bottom: 10px; }
label input, label select {
  display: block; width: 100%; margin-top: 4px; padding: 6px 8px;
  border: 1px solid #c8c8c8; border-radius: 4px; font: inherit;
}
.row { display: flex; gap: 8px; }
.hint { color: #555; font-size: 12px; }
.link { font-family: ui-monospace, monospace; }
#profile-list { max-height: 240px; overflow-y: auto; border: 1px solid #eee; border-radius: 4px; padding: 6px; margin-bottom: 8px; }
.profile-row { display: flex; gap: 6px; margin-bottom: 4px; align-items: center; }
.profile-row .label { flex: 1; font-weight: 600; }
.profile-row .value { flex: 2; }
.profile-row input { padding: 3px 6px; border: 1px solid #ddd; border-radius: 3px; width: 100%; font: inherit; }
.profile-row .del { background: none; border: none; cursor: pointer; color: #b91c1c; font-size: 14px; }
```

- [ ] **Step 3: Implement `popup/popup.js`**

```js
import { MSG } from '../lib/messages.js';
import {
  getProfile, setProfile, mergeProfile, getSettings, setSettings,
} from '../lib/storage.js';

async function activeTabId() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab?.id;
}

async function sendToTab(message) {
  const tabId = await activeTabId();
  if (tabId == null) throw new Error('No active tab');
  return chrome.tabs.sendMessage(tabId, message);
}

function setStatus(elId, text, kind = '') {
  const el = document.getElementById(elId);
  el.textContent = text;
  el.className = `status ${kind}`.trim();
}

// --- view switching ---
document.querySelectorAll('nav button').forEach((btn) => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('nav button').forEach((b) => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.view').forEach((v) => v.classList.remove('active'));
    document.getElementById(`view-${btn.dataset.view}`).classList.add('active');
    if (btn.dataset.view === 'profile') renderProfile();
    if (btn.dataset.view === 'settings') renderSettings();
  });
});

// --- main view ---
let recording = false;
const btnRecord = document.getElementById('btn-record');
const btnFill = document.getElementById('btn-fill');

btnRecord.addEventListener('click', async () => {
  try {
    if (!recording) {
      const res = await sendToTab({ type: MSG.RECORD_START });
      if (!res?.ok) throw new Error(res?.error || 'Could not start');
      recording = true;
      btnRecord.textContent = 'Stop Recording';
      setStatus('main-status', `Recording ${res.fieldCount} fields…`, 'ok');
    } else {
      const res = await sendToTab({ type: MSG.RECORD_STOP });
      if (!res?.ok) throw new Error(res?.error || 'Could not stop');
      const captured = res.captured || {};
      await mergeProfile(captured);
      recording = false;
      btnRecord.textContent = 'Start Recording';
      setStatus('main-status', `Saved ${Object.keys(captured).length} fields.`, 'ok');
    }
  } catch (e) {
    setStatus('main-status', e.message || String(e), 'error');
  }
});

btnFill.addEventListener('click', async () => {
  setStatus('main-status', 'Filling…');
  try {
    const settings = await getSettings();
    if (!settings.apiKey) {
      setStatus('main-status', 'Set your Gemini API key in Settings.', 'error');
      return;
    }
    const profile = await getProfile();
    if (Object.keys(profile).length === 0) {
      setStatus('main-status', 'Profile is empty — record a page first.', 'error');
      return;
    }
    const res = await sendToTab({ type: MSG.FILL_START });
    if (!res?.ok) throw new Error(res?.error || 'Fill failed');
    const msg = `Filled ${res.filled} field(s).` +
      (res.missing && res.missing.length ? ` Missing: ${res.missing.join(', ')}` : '');
    setStatus('main-status', msg, 'ok');
  } catch (e) {
    setStatus('main-status', e.message || String(e), 'error');
  }
});

// --- profile view ---
async function renderProfile() {
  const profile = await getProfile();
  const container = document.getElementById('profile-list');
  container.innerHTML = '';
  const entries = Object.entries(profile);
  if (entries.length === 0) {
    container.innerHTML = '<p class="hint">No profile entries yet. Record a job application page on the Main tab.</p>';
    return;
  }
  for (const [label, value] of entries) {
    const row = document.createElement('div');
    row.className = 'profile-row';
    row.innerHTML = `
      <div class="label">${escapeHtml(label)}</div>
      <div class="value"><input type="text" value="${escapeAttr(value)}"></div>
      <button class="del" title="Delete">&times;</button>
    `;
    const input = row.querySelector('input');
    input.addEventListener('change', async () => {
      const p = await getProfile();
      if (input.value.trim() === '') return; // ignore blanks
      p[label] = input.value;
      await setProfile(p);
      setStatus('profile-status', `Updated "${label}".`, 'ok');
    });
    row.querySelector('.del').addEventListener('click', async () => {
      const p = await getProfile();
      delete p[label];
      await setProfile(p);
      renderProfile();
      setStatus('profile-status', `Deleted "${label}".`, 'ok');
    });
    container.appendChild(row);
  }
}

document.getElementById('btn-export').addEventListener('click', async () => {
  const profile = await getProfile();
  const blob = new Blob([JSON.stringify(profile, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'apply-plugin-profile.json';
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('btn-import').addEventListener('click', () => {
  document.getElementById('import-file').click();
});
document.getElementById('import-file').addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid format');
    await mergeProfile(data);
    setStatus('profile-status', `Imported ${Object.keys(data).length} entries.`, 'ok');
    renderProfile();
  } catch (err) {
    setStatus('profile-status', `Import failed: ${err.message}`, 'error');
  }
  e.target.value = '';
});

// --- settings view ---
async function renderSettings() {
  const s = await getSettings();
  document.getElementById('api-key').value = s.apiKey;
  document.getElementById('model').value = s.model;
}
document.getElementById('btn-save-settings').addEventListener('click', async () => {
  const apiKey = document.getElementById('api-key').value.trim();
  const model = document.getElementById('model').value;
  await setSettings({ apiKey, model });
  setStatus('settings-status', 'Saved.', 'ok');
});
document.getElementById('btn-test').addEventListener('click', async () => {
  setStatus('settings-status', 'Testing…');
  try {
    const res = await chrome.runtime.sendMessage({ type: MSG.GEMINI_TEST });
    if (res?.ok) setStatus('settings-status', 'Connection OK.', 'ok');
    else throw new Error(res?.error || 'Failed');
  } catch (e) {
    setStatus('settings-status', e.message || String(e), 'error');
  }
});

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function escapeAttr(s) { return escapeHtml(s); }
```

- [ ] **Step 4: Commit**

```bash
git add popup/popup.html popup/popup.css popup/popup.js
git commit -m "Add popup UI with main, profile, and settings views"
```

---

## Task 9: Manifest and placeholder icons

**Files:**
- Create: `manifest.json`
- Create: `icons/16.png`, `icons/48.png`, `icons/128.png`

**Why:** This is what makes the extension loadable in Chrome.

- [ ] **Step 1: Create `manifest.json`**

```json
{
  "manifest_version": 3,
  "name": "Apply Plugin",
  "version": "0.1.0",
  "description": "Record once, auto-fill job applications.",
  "permissions": ["storage", "activeTab"],
  "host_permissions": ["https://generativelanguage.googleapis.com/*"],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "popup/popup.html",
    "default_title": "Apply Plugin",
    "default_icon": {
      "16": "icons/16.png",
      "48": "icons/48.png",
      "128": "icons/128.png"
    }
  },
  "icons": {
    "16": "icons/16.png",
    "48": "icons/48.png",
    "128": "icons/128.png"
  },
  "content_scripts": [{
    "matches": ["http://*/*", "https://*/*"],
    "js": ["content/content.js"],
    "css": ["content/content.css"],
    "type": "module",
    "run_at": "document_idle"
  }]
}
```

> Note: MV3 content scripts cannot directly use `type: "module"` in the manifest field. We need to handle this — see Step 2.

- [ ] **Step 2: Bundle content script and background as ES modules**

The challenge: MV3 content scripts loaded via the manifest do NOT support `import` statements. We have two clean options:
- (a) Inline all `lib/` imports manually into `content/content.js` and `background.js` (no build step, but duplication).
- (b) Use Chrome's `chrome.runtime.getURL` + dynamic `import()` from a bootstrap script.

We use **option (a) via a small concat step at install time** — actually, simpler: we **rewrite the manifest to load content as a regular script and use a bootstrap**:

Replace the `content_scripts` entry above with one that points at a **bootstrap** file that uses `import()`:

Update `manifest.json`'s `content_scripts`:

```json
  "content_scripts": [{
    "matches": ["http://*/*", "https://*/*"],
    "js": ["content/bootstrap.js"],
    "css": ["content/content.css"],
    "run_at": "document_idle"
  }],
  "web_accessible_resources": [{
    "resources": ["content/content.js", "lib/*.js"],
    "matches": ["http://*/*", "https://*/*"]
  }]
```

And create `content/bootstrap.js`:

```js
(async () => {
  const url = chrome.runtime.getURL('content/content.js');
  await import(url);
})();
```

This keeps modules working without any build step.

- [ ] **Step 3: Create placeholder icons**

Run from the project root:

```bash
mkdir -p icons
# 1x1 transparent PNG placeholders (replace with real art later)
printf '\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\rIDATx\x9cc\x00\x01\x00\x00\x05\x00\x01\x0d\n-\xb4\x00\x00\x00\x00IEND\xaeB`\x82' > icons/16.png
cp icons/16.png icons/48.png
cp icons/16.png icons/128.png
```

Expected: three 1×1 PNGs exist. Chrome accepts these as valid icons; replace with real art later.

- [ ] **Step 4: Commit**

```bash
git add manifest.json content/bootstrap.js icons/
git commit -m "Add manifest, bootstrap loader, and placeholder icons"
```

---

## Task 10: README with install + usage + manual test checklist

**Files:**
- Create: `README.md`

**Why:** You need a checklist for the first end-to-end run, and the install steps for an unpacked extension are easy to forget.

- [ ] **Step 1: Create `README.md`**

```markdown
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
```

- [ ] **Step 2: Commit**

```bash
git add README.md
git commit -m "Add README with install, usage, and manual test checklist"
```

---

## Task 11: Final smoke check — full test suite

**Files:** none

- [ ] **Step 1: Run the full test suite**

Run: `npm test`
Expected: all tests pass across `tests/storage.test.js`, `tests/fields.test.js`, `tests/gemini.test.js`.

- [ ] **Step 2: Verify file layout**

Run: `find . -type f -not -path "./node_modules/*" -not -path "./.git/*" | sort`

Expected output includes:
```
./.gitignore
./README.md
./background.js
./content/bootstrap.js
./content/content.css
./content/content.js
./details.md
./docs/superpowers/specs/2026-05-24-apply-plugin-design.md
./docs/superpowers/plans/2026-05-24-apply-plugin.md
./icons/128.png
./icons/16.png
./icons/48.png
./lib/fields.js
./lib/gemini.js
./lib/messages.js
./lib/storage.js
./manifest.json
./package-lock.json
./package.json
./popup/popup.css
./popup/popup.html
./popup/popup.js
./tests/fields.test.js
./tests/gemini.test.js
./tests/storage.test.js
./vitest.config.js
```

- [ ] **Step 3: No commit needed** — verification only.

---

## Done criteria

After Task 11, the user can:

1. Run `npm test` and see all tests pass.
2. Load the unpacked extension at `chrome://extensions/`.
3. Set their Gemini key in Settings and click **Test connection** → success.
4. Record on one application form, then fill another, with dropdowns matching correctly and missing fields prompting via the panel.

Known follow-ups (deferred from spec; not in this plan): inline "edit profile value for this field" UI, multi-page auto-advance, cross-device sync, file-upload automation, real icon art.
