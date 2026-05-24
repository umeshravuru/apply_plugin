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
