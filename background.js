// Service worker: receive batch from content script -> POST to Kafka gateway (no CORS).

// ---------- Side panel: chỉ hiện ở tab đã bấm icon ----------
// Tắt panel mặc định → tab chưa bấm icon thì không có panel.
// Phải tắt "bấm icon tự mở panel" thì action.onClicked mới được gọi.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});
chrome.sidePanel.setOptions({ enabled: false }).catch(() => {});

// Bấm icon → bật panel riêng cho tab này rồi mở.
// Không await giữa hai lệnh: sidePanel.open phải chạy ngay trong thao tác bấm.
chrome.action.onClicked.addListener((tab) => {
  chrome.sidePanel.setOptions({
    tabId: tab.id,
    path: `sidepanel.html?tabId=${tab.id}`,
    enabled: true,
  });
  chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
});

// ---------- Gửi Kafka ----------
async function sendKafka(cfg, items) {
  const res = await fetch(cfg.gatewayUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      topic: cfg.topic,
      message: JSON.stringify(items),
    }),
  });
  const text = await res.text().catch(() => "");
  if (!res.ok) throw new Error("HTTP " + res.status + " " + text.slice(0, 200));
  return text;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SEND_KAFKA") {
    sendKafka(msg.cfg, msg.items)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
