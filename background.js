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
    case "RUN_BEAT":
      // Nhịp tim: đã được ghi nhận bằng touch() trong onMessage
      return { ok: true };
  }
  return null;
}

// ---------- [MỚI] Watchdog: tab đang chạy mà im lặng quá lâu → tự F5 ----------
// Dùng khi proxy chết: F5 ra trang lỗi của Chrome, content script không chạy được
// nên không tự F5 tiếp. Background vẫn sống nên F5 hộ cho đến khi vào lại được.
// Cũng dùng khi kẹt ở trang kiểm tra Cloudflare quá lâu.
const WATCH_MS = 3 * 60 * 1000; // 3 phút không có tín hiệu thì F5
const beatKey = (tabId) => "beat:" + tabId;
const lastWrite = new Map(); // hạn chế ghi storage quá dày

async function touch(tabId) {
  const now = Date.now();
  if (now - (lastWrite.get(tabId) || 0) < 15000) return; // tối đa 15s ghi 1 lần
  lastWrite.set(tabId, now);
  await chrome.storage.session.set({ [beatKey(tabId)]: now });
}

chrome.alarms.create("watchdog", { periodInMinutes: 1 });

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "watchdog") return;
  const all = await chrome.storage.session.get(null);
  for (const k of Object.keys(all)) {
    if (!k.startsWith("run:")) continue; // chỉ canh tab đang có lượt chạy
    const tabId = Number(k.slice(4));
    const last = all[beatKey(tabId)] || all[k].startedAt || 0;
    if (Date.now() - last < WATCH_MS) continue;

    try {
      await chrome.tabs.reload(tabId);
      console.log("[Watchdog] Tab " + tabId + " im lặng quá lâu → F5");
    } catch {
      // tab không còn → xoá lượt chạy
      await chrome.storage.session.remove([k, beatKey(tabId)]);
      continue;
    }
    lastWrite.set(tabId, Date.now());
    await chrome.storage.session.set({ [beatKey(tabId)]: Date.now() });
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  chrome.storage.session
    .remove([runKey(tabId), beatKey(tabId)])
    .catch(() => {});
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  // [MỚI] Mọi tin từ tab (LOG, RUN_BEAT, RUN_OK, SEND_KAFKA...) đều tính là "còn sống"
  if (sender.tab) touch(sender.tab.id).catch(() => {});

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
