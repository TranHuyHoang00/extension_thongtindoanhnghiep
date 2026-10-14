// Service worker: receive batch from content script -> POST to Kafka gateway (no CORS).

chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});

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
