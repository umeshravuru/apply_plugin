import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  getProfile, setProfile, mergeProfile,
  getSettings, setSettings, normalizeLabel,
  clearLegacyRecordingSession,
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

describe('clearLegacyRecordingSession', () => {
  beforeEach(() => { mockChromeStorage(); });

  it('removes the legacy recordingSession key if present', async () => {
    await chrome.storage.local.set({ recordingSession: { active: true } });
    await clearLegacyRecordingSession();
    const out = await chrome.storage.local.get('recordingSession');
    expect(out).toEqual({});
  });

  it('is a no-op when nothing is stored', async () => {
    await expect(clearLegacyRecordingSession()).resolves.toBeUndefined();
  });
});
