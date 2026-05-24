const PROFILE_KEY = 'profile';
const SETTINGS_KEY = 'settings';
const SESSION_KEY = 'recordingSession';
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

// Recording session — survives content-script restarts and page navigations.
// Shape: { active: boolean, origin: string, buffer: { [label]: value }, startedAt: number }
export async function getRecordingSession() {
  const out = await chrome.storage.local.get(SESSION_KEY);
  const s = out[SESSION_KEY];
  if (!s || typeof s !== 'object') return { active: false, origin: '', buffer: {}, startedAt: 0 };
  return {
    active: !!s.active,
    origin: typeof s.origin === 'string' ? s.origin : '',
    buffer: (s.buffer && typeof s.buffer === 'object') ? s.buffer : {},
    startedAt: typeof s.startedAt === 'number' ? s.startedAt : 0,
  };
}

export async function setRecordingSession(session) {
  await chrome.storage.local.set({ [SESSION_KEY]: session });
}

export async function clearRecordingSession() {
  await chrome.storage.local.remove(SESSION_KEY);
}
