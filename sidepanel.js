const $ = (id) => document.getElementById(id);
const logEl = $("log");

// Panel này thuộc về tab nào: lấy từ URL (sidepanel.html?tabId=123) do background gán khi bấm icon
const PANEL_TAB_ID =
  Number(new URLSearchParams(location.search).get("tabId")) || null;

function addLog(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += t + "  " + msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

// Chỉ hiện log do content script của đúng tab này gửi lên
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg.type !== "LOG") return;
  if (PANEL_TAB_ID && sender.tab && sender.tab.id !== PANEL_TAB_ID) return;
  addLog(msg.msg);
});

function joinKey(base, key) {
  base = (base || "").trim();
  key = (key || "").trim();
  if (!key) return base;
  return (
    base +
    (base.indexOf("?") === -1 ? "?" : "&") +
    "apikey=" +
    encodeURIComponent(key)
  );
}

function readCfg() {
  return {
    prov: $("prov").value.trim(),
    limit: parseInt($("limit").value, 10),
    delay: parseInt($("delay").value, 10) || 1000,
    batch: parseInt($("batch").value, 10) || 20,
    gatewayUrl: joinKey($("gatewayUrl").value, $("apikey").value),
    topic: $("topic").value.trim(),
  };
}

// Lấy đúng tab của panel này (không phụ thuộc tab nào đang được xem)
async function ttdnTab() {
  let tab = null;
  try {
    if (PANEL_TAB_ID) {
      tab = await chrome.tabs.get(PANEL_TAB_ID);
    } else {
      [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    }
  } catch {
    addLog("The tab of this panel has been closed.");
    return null;
  }
  if (!tab || !/^https:\/\/thongtindoanhnghiep\.co\//.test(tab.url || "")) {
    addLog(
      "This tab is not on thongtindoanhnghiep.co. Open the site in this tab and try again.",
    );
    return null;
  }
  return tab;
}

$("btnStart").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  if (!$("apikey").value.trim()) {
    addLog("Enter the API Key first.");
    return;
  }
  const cfg = readCfg();
  if (!cfg.prov || !cfg.gatewayUrl || !cfg.topic) {
    addLog("Missing province / gateway / topic.");
    return;
  }
  addLog("Start: " + cfg.prov);
  chrome.tabs
    .sendMessage(tab.id, { type: "START", cfg })
    .catch(() =>
      addLog(
        "Cannot send command. Reload the thongtindoanhnghiep.co tab and try again.",
      ),
    );
};

$("btnStop").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: "STOP" }).catch(() => {});
  addLog("Stop command sent.");
};

$("btnReset").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  const prov = $("prov").value.trim();
  chrome.tabs.sendMessage(tab.id, { type: "RESET_PROV", prov }).catch(() => {});
};
