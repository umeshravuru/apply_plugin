const PROFILE_KEY = 'profile';
const SETTINGS_KEY = 'settings';
const LEGACY_SESSION_KEY = 'recordingSession'; // removed; cleared on boot if present
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

// Remove the leftover record-session key from previous versions of the
// extension. Safe to call repeatedly; no-op when nothing is stored.
export async function clearLegacyRecordingSession() {
  await chrome.storage.local.remove(LEGACY_SESSION_KEY);
}
