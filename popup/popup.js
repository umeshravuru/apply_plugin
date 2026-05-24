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