// Toolbar icon opens the swipe feed in a new tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

const MAIN_ID = 'hemhjljcedomjkeidgiaekglfffaoidh';
// earlier installs of this app, loaded by folder path before the ID was pinned —
// their localStorage holds feeds and saves the pinned install can't read
const OLD_IDS = ['lbciiccadfdecphekggnlbcdpfdjkbab', 'mkpiijeldfbcfkpffoeddofjljckpmme'];

if (chrome.runtime.id === MAIN_ID) {
  // an old copy hands over a backup; the page merges it on its next open
  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    if (!OLD_IDS.includes(sender.id) || !msg || msg.type !== 'rs-transfer' || !msg.backup) return;
    chrome.storage.local.set({ pendingRestore: msg.backup }).then(() => {
      reply({ ok: true });
      chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
    }, e => reply({ ok: false, error: String(e) }));
    return true;   // the reply is sent asynchronously
  });
} else if (OLD_IDS.includes(chrome.runtime.id)) {
  // localStorage is only reachable from a page, so an old copy opens its page to hand over
  const open = () => chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
  chrome.runtime.onInstalled.addListener(open);
  chrome.runtime.onStartup.addListener(open);
}
