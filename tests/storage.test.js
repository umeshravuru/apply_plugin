import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProfile, setProfile, mergeProfile,
  getSettings, setSettings, normalizeLabel,
  getRecordingSession, setRecordingSession, clearRecordingSession,
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
        remove: vi.fn(async (keys) => {
          (Array.isArray(keys) ? keys : [keys]).forEach((k) => { delete data[k]; });
        }),
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

describe('recording session storage', () => {
  beforeEach(() => { mockChromeStorage(); });

  it('returns inactive defaults when no session saved', async () => {
    expect(await getRecordingSession()).toEqual({
      active: false, origin: '', buffer: {}, startedAt: 0,
    });
  });

  it('saves and retrieves a session', async () => {
    const s = { active: true, origin: 'https://x.com', buffer: { Email: 'a@b' }, startedAt: 12345 };
    await setRecordingSession(s);
    expect(await getRecordingSession()).toEqual(s);
  });

  it('coerces malformed stored sessions to safe defaults', async () => {
    // Simulate something else writing junk under the key.
    await chrome.storage.local.set({ recordingSession: { active: 'yes', buffer: 'broken' } });
    const s = await getRecordingSession();
    expect(s.active).toBe(true); // truthy coerces
    expect(s.buffer).toEqual({}); // non-object buffer falls back
    expect(s.origin).toBe('');
    expect(s.startedAt).toBe(0);
  });

  it('clearRecordingSession removes the key', async () => {
    await setRecordingSession({ active: true, origin: 'x', buffer: { a: 'b' }, startedAt: 1 });
    await clearRecordingSession();
    expect(await getRecordingSession()).toEqual({
      active: false, origin: '', buffer: {}, startedAt: 0,
    });
  });
});
