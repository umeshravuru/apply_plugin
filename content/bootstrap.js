(async () => {
  const url = chrome.runtime.getURL('content/content.js');
  await import(url);
})();
