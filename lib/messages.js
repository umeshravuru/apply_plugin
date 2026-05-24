// Message types exchanged between popup, background, and content script.
// All cross-context messages MUST use these constants.

export const MSG = {
  // popup → content
  RECORD_START: 'record:start',
  RECORD_STOP: 'record:stop',
  FILL_START: 'fill:start',

  // content → popup (responses to the above)
  // (responses are just { ok, data, error })

  // content → background
  GEMINI_MATCH: 'gemini:match',

  // popup → background / background → popup
  GEMINI_TEST: 'gemini:test',

  // popup → content (after missing-field panel submit)
  FILL_LEARNED: 'fill:learned',
};
