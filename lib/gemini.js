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
