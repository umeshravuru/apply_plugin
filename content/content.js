import { MSG } from '../lib/messages.js';
import {
  mergeProfile, getProfile,
  getRecordingSession, setRecordingSession, clearRecordingSession,
} from '../lib/storage.js';
import { scanFields, applyFill } from '../lib/fields.js';

// In-memory mirror of the persisted session. The source of truth is
// chrome.storage.local — see lib/storage.js getRecordingSession.
const state = {
  recordCleanup: null,     // function to remove listeners (in-memory only)
  buffer: new Map(),       // label → value (mirrors session.buffer)
  saveTimer: null,         // debounce timer id for storage writes
  lastScan: [],            // last fill scan (so we can re-apply after missing-field submit)
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

function scheduleBufferSave() {
  if (state.saveTimer != null) clearTimeout(state.saveTimer);
  state.saveTimer = setTimeout(async () => {
    state.saveTimer = null;
    const session = await getRecordingSession();
    if (!session.active) {
      console.log('[apply-plugin/content] scheduleBufferSave: session not active, skipping save');
      return;
    }
    session.buffer = Object.fromEntries(state.buffer);
    await setRecordingSession(session);
    console.log('[apply-plugin/content] scheduleBufferSave: persisted', Object.keys(session.buffer).length, 'fields');
  }, 300);
}

function attachListeners() {
  const fields = scanFields(document.body);
  const handlers = [];
  for (const f of fields) {
    const handler = () => {
      const val = readCurrentValue(f);
      if (val !== '') {
        state.buffer.set(f.label, val);
        scheduleBufferSave();
      }
    };
    // Listen on change, blur, AND input. Some React/Vue ATSes only emit
    // synthetic input events; some custom widgets only emit blur.
    f.el.addEventListener('change', handler, true);
    f.el.addEventListener('blur', handler, true);
    f.el.addEventListener('input', handler, true);
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
      handlers.push([f.el, 'input', handler]);
    }
  }
  state.recordCleanup = () => {
    handlers.forEach(([el, ev, h]) => el.removeEventListener(ev, h, true));
  };
  return fields.length;
}

async function startRecording() {
  console.log('[apply-plugin/content] startRecording called', { origin: location.origin });
  const session = await getRecordingSession();
  console.log('[apply-plugin/content] startRecording: existing session', session);
  if (session.active && session.origin === location.origin) {
    state.buffer = new Map(Object.entries(session.buffer));
    if (!state.recordCleanup) attachListeners();
    console.log('[apply-plugin/content] startRecording: re-armed existing session');
    return { ok: true, alreadyRecording: true, fieldCount: state.buffer.size };
  }
  state.buffer.clear();
  await setRecordingSession({
    active: true,
    origin: location.origin,
    buffer: {},
    startedAt: Date.now(),
  });
  const verify = await getRecordingSession();
  console.log('[apply-plugin/content] startRecording: wrote session, readback=', verify);
  const fieldCount = attachListeners();
  console.log('[apply-plugin/content] startRecording: attached listeners on', fieldCount, 'fields');
  return { ok: true, fieldCount };
}

async function stopRecording() {
  // Read whatever the persisted session has, plus any in-memory buffer not yet flushed.
  const session = await getRecordingSession();
  if (!session.active) {
    // Nothing to do, but still clear any in-memory listeners.
    if (state.recordCleanup) { state.recordCleanup(); state.recordCleanup = null; }
    return { ok: true, captured: {}, savedCount: 0 };
  }

  if (state.recordCleanup) { state.recordCleanup(); state.recordCleanup = null; }
  if (state.saveTimer != null) { clearTimeout(state.saveTimer); state.saveTimer = null; }

  // Final flush: re-read every currently-visible field directly from the DOM
  // in case blur/change never fired on the last-touched one.
  const merged = new Map(Object.entries(session.buffer));
  for (const [k, v] of state.buffer) merged.set(k, v);
  const fields = scanFields(document.body);
  for (const f of fields) {
    const val = readCurrentValue(f);
    if (val !== '') merged.set(f.label, val);
  }

  const captured = Object.fromEntries(merged);
  state.buffer.clear();
  await mergeProfile(captured);
  await clearRecordingSession();
  return { ok: true, captured, savedCount: Object.keys(captured).length };
}

async function recordStatus() {
  const session = await getRecordingSession();
  const sameOrigin = session.active && session.origin === location.origin;
  return {
    ok: true,
    recording: session.active,
    sameOrigin,
    origin: session.origin,
    bufferedCount: Object.keys(session.buffer).length + state.buffer.size,
  };
}

// On page load (or extension reload + page refresh), if a session is active
// for this origin, re-attach listeners with the saved buffer so recording
// transparently continues across navigations.
(async () => {
  try {
    console.log('[apply-plugin/content] content script booted on', location.href);
    const session = await getRecordingSession();
    console.log('[apply-plugin/content] boot: existing session', session);
    if (session.active && session.origin === location.origin) {
      state.buffer = new Map(Object.entries(session.buffer));
      attachListeners();
      console.log('[apply-plugin/content] boot: rehydrated session with', state.buffer.size, 'fields');
    }
  } catch (e) {
    console.warn('[apply-plugin/content] failed to rehydrate recording session', e);
  }
})();

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
    case MSG.RECORD_START:
      handleAsync(startRecording, sendResponse);
      return true;
    case MSG.RECORD_STOP:
      handleAsync(stopRecording, sendResponse);
      return true;
    case MSG.RECORD_STATUS:
      handleAsync(recordStatus, sendResponse);
      return true;
    case MSG.FILL_START:
      handleAsync(startFill, sendResponse);
      return true;
    default:
      return false;
  }
});
