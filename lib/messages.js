// Message types exchanged between popup, background, and content script.
// All cross-context messages MUST use these constants.

export const MSG = {
  // popup → content
  CAPTURE_NOW: 'capture:now',
  FILL_START: 'fill:start',

  // content → popup (responses to the above)
  // (responses are just { ok, data, error })

  // content → background
  GEMINI_MATCH: 'gemini:match',

  // popup → background / background → popup
  GEMINI_TEST: 'gemini:test',
};
