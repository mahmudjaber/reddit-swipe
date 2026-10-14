// Toolbar icon opens the swipe feed in a new tab.
chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: chrome.runtime.getURL('index.html') });
});

const MAIN_ID = 'hemhjljcedomjkeidgiaekglfffaoidh';
// earlier installs of this app, loaded by folder path before the ID was pinned —
// their localStorage holds feeds and saves the pinned install can't read
const OLD_IDS = ['lbciiccadfdecphekggnlbcdpfdjkbab', 'mkpiijeldfbcfkpffoeddofjljckpmme'];

// focus an open copy of our page instead of stacking another tab
async function showPage() {
  const url = chrome.runtime.getURL('index.html');
  const [ctx] = await chrome.runtime.getContexts({ contextTypes: ['TAB'], documentUrls: [url] });
  if (ctx && ctx.tabId !== -1) {
    await chrome.tabs.update(ctx.tabId, { active: true });
    if (ctx.windowId !== -1) await chrome.windows.update(ctx.windowId, { focused: true });
  } else {
    await chrome.tabs.create({ url });
  }
}

if (chrome.runtime.id === MAIN_ID) {
  // an old copy hands over a backup; the page merges it (takeOver in app.js).
  // One slot per sender, and a sender already merged is answered without a resend
  // unless it forces one — a repeat would bring back what the user deleted since
  chrome.runtime.onMessageExternal.addListener((msg, sender, reply) => {
    if (!OLD_IDS.includes(sender.id) || !msg || msg.type !== 'rs-transfer' || !msg.backup) return;
    (async () => {
      const { transferredFrom = {} } = await chrome.storage.local.get('transferredFrom');
      if (transferredFrom[sender.id] && !msg.force) return reply({ ok: true, dup: true, at: transferredFrom[sender.id] });
      await chrome.storage.local.set({ ['pending:' + sender.id]: msg.backup });
      reply({ ok: true });
      showPage().catch(() => {});
    })().catch(e => reply({ ok: false, error: String(e) }));
    return true;   // the reply is sent asynchronously
  });
} else if (OLD_IDS.includes(chrome.runtime.id)) {
  // localStorage is only reachable from a page, so an old copy opens its page to
  // hand over — until it has, and never just because Chrome itself updated
  const open = async details => {
    if (details && details.reason === 'chrome_update') return;
    const { handedOver } = await chrome.storage.local.get('handedOver');
    if (!handedOver) await showPage();
  };
  chrome.runtime.onInstalled.addListener(d => { open(d).catch(() => {}); });
  chrome.runtime.onStartup.addListener(() => { open().catch(() => {}); });
}
