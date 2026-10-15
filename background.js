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

// ---------- Ghi nhớ lượt chạy để tự chạy tiếp sau khi trang tải lại ----------
// Lưu trong chrome.storage.session: chỉ nằm trong RAM, tự xoá khi tắt Chrome hoặc reload extension.
// Mỗi tab một khoá run:<tabId> = { cfg, reloads, startedAt }
const runKey = (tabId) => "run:" + tabId;

async function getRun(tabId) {
  const k = runKey(tabId);
  return (await chrome.storage.session.get(k))[k] || null;
}

async function handleRun(msg, tabId) {
  switch (msg.type) {
    case "RUN_SAVE":
      await chrome.storage.session.set({
        [runKey(tabId)]: { cfg: msg.cfg, reloads: 0, startedAt: Date.now() },
      });
      return { ok: true };
    case "RUN_GET":
      return { ok: true, run: await getRun(tabId) };
    case "RUN_CLEAR":
      await chrome.storage.session.remove(runKey(tabId));
      return { ok: true };
    case "RUN_OK": {
      // Gửi được dữ liệu → reset bộ đếm số lần tự F5
      const run = await getRun(tabId);
      if (run && run.reloads)
        await chrome.storage.session.set({
          [runKey(tabId)]: { ...run, reloads: 0 },
        });
      return { ok: true };
    }
    case "RUN_RELOAD": {
      const run = await getRun(tabId);
      if (!run) return { ok: false };
      const reloads = (run.reloads || 0) + 1;
      if (reloads > (msg.max || 10)) return { ok: false, reloads };
      await chrome.storage.session.set({
        [runKey(tabId)]: { ...run, reloads },
      });
      return { ok: true, reloads };
    }
  }
  return null;
}

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session.remove(runKey(tabId)).catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "SEND_KAFKA") {
    sendKafka(msg.cfg, msg.items)
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
  if (msg.type && msg.type.startsWith("RUN_") && sender.tab) {
    handleRun(msg, sender.tab.id)
      .then((r) => sendResponse(r))
      .catch((e) => sendResponse({ ok: false, error: e.message }));
    return true;
  }
});
