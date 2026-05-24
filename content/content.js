import { MSG } from '../lib/messages.js';
import { mergeProfile, getProfile, clearLegacyRecordingSession } from '../lib/storage.js';
import { scanFields, applyFill } from '../lib/fields.js';

const state = {
  lastScan: [],            // last fill scan (for re-applying after missing-field panel submit)
};

function readCurrentValue(f) {
  if (f.type === 'radio') {
    const checked = document.querySelector(
      `input[type="radio"][name="${CSS.escape(f.el.name)}"]:checked`
    );
    return checked ? checked.value : '';
  }
  if (f.type === 'checkbox') {
    return f.el.checked ? 'Yes' : 'No';
  }
  return f.el.value || '';
}

// Snapshot every visible form field that currently has a value and merge
// the result into the saved profile. Stateless — every click is a fresh
// read of whatever is on the page right now.
async function captureNow() {
  const fields = scanFields(document.body);
  const captured = {};
  for (const f of fields) {
    const val = readCurrentValue(f);
    if (val !== '') captured[f.label] = val;
  }
  const savedCount = Object.keys(captured).length;
  if (savedCount > 0) await mergeProfile(captured);
  return { ok: true, captured, savedCount, scannedCount: fields.length };
}

// One-time cleanup of any leftover session key from earlier versions.
clearLegacyRecordingSession().catch(() => {});

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

function handleAsync(fn, sendResponse) {
  fn().then(sendResponse).catch((e) => sendResponse({ ok: false, error: String(e.message || e) }));
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return false;
  switch (msg.type) {
    case MSG.CAPTURE_NOW:
      handleAsync(captureNow, sendResponse);
      return true;
    case MSG.FILL_START:
      handleAsync(startFill, sendResponse);
      return true;
    default:
      return false;
  }
});
