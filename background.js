// Toolbar icon opens the swipe feed in a new tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});
