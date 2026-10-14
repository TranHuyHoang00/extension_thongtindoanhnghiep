const $ = (id) => document.getElementById(id);
const logEl = $("log");

function addLog(msg) {
  const t = new Date().toLocaleTimeString();
  logEl.textContent += t + "  " + msg + "\n";
  logEl.scrollTop = logEl.scrollHeight;
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "LOG") addLog(msg.msg);
});

function joinKey(base, key) {
  base = (base || "").trim();
  key = (key || "").trim();
  if (!key) return base;
  return base + (base.indexOf("?") === -1 ? "?" : "&") + "apikey=" + encodeURIComponent(key);
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

async function ttdnTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab || !/^https:\/\/thongtindoanhnghiep\.co\//.test(tab.url || "")) {
    addLog("Open thongtindoanhnghiep.co and keep it as the active tab.");
    return null;
  }
  return tab;
}

$("btnStart").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  if (!$("apikey").value.trim()) { addLog("Enter the API Key first."); return; }
  const cfg = readCfg();
  if (!cfg.prov || !cfg.gatewayUrl || !cfg.topic) { addLog("Missing province / gateway / topic."); return; }
  addLog("Start: " + cfg.prov);
  chrome.tabs.sendMessage(tab.id, { type: "START", cfg }).catch(() =>
    addLog("Cannot send command. Reload the thongtindoanhnghiep.co tab and try again."));
};

$("btnStop").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  chrome.tabs.sendMessage(tab.id, { type: "STOP" });
  addLog("Stop command sent.");
};

$("btnReset").onclick = async () => {
  const tab = await ttdnTab();
  if (!tab) return;
  const prov = $("prov").value.trim();
  chrome.tabs.sendMessage(tab.id, { type: "RESET_PROV", prov });
};
