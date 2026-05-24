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
