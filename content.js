// Runs in thongtindoanhnghiep.co tab (passed Cloudflare).
// Fetch raw via same-origin API (uses page cookies), batch, ask background to send Kafka.
// Progress saved in IndexedDB: 403/stop does not lose data, re-run continues.

let STOP = false;

const META = {
  author_id: "6071def4536dcfba68a69b160dfcecc9",
  owner_id: "6071def4536dcfba68a69b160dfcecc9",
  owner_name: "Thông Tin Doanh Nghiệp",
  author_name: "Thông Tin Doanh Nghiệp",
  tenant_ids: ["9c70933aff6b2a6d08c687a6cbb6b765"],
  source_type: "",
  crawler_system: "extension-crawler",
  channel_name: "business"
};

function wrap(info) {
  const now = Date.now();
  const solr = info && info.SolrID ? info.SolrID : "";
  return {
    url: solr ? "https://thongtindoanhnghiep.co" + solr : "",
    author_id: META.author_id,
    source_type: META.source_type,
    owner_name: META.owner_name,
    tenant_ids: META.tenant_ids,
    inserted_time: now,
    owner_id: META.owner_id,
    created_time: now,
    flag_crawl_created_time: 0,
    entry_rowkey: info && info.MaSoThue ? info.MaSoThue : "",
    crawler_system: META.crawler_system,
    information: info,
    channel_name: META.channel_name,
    author_name: META.author_name
  };
}

function log(msg) {
  chrome.runtime.sendMessage({ type: "LOG", msg }).catch(() => {});
  console.log("[TTDN]", msg);
}

function _db() {
  return new Promise((ok, err) => {
    const r = indexedDB.open("ttdn_ext", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("done");
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
}
async function _getDone(prov) {
  const d = await _db();
  return new Promise((ok) => {
    const t = d.transaction("done", "readonly").objectStore("done").get(prov);
    t.onsuccess = () => ok(new Set(t.result || []));
    t.onerror = () => ok(new Set());
  });
}
async function _saveDone(prov, set) {
  const d = await _db();
  return new Promise((ok) => {
    const t = d.transaction("done", "readwrite");
    t.objectStore("done").put([...set], prov);
    t.oncomplete = () => ok();
  });
}

async function apiGet(url) {
  const res = await fetch(url, { credentials: "include" });
  if (res.status === 403) throw new Error("CF_403");
  return res.json();
}

async function pushKafka(cfg, items) {
  const r = await chrome.runtime.sendMessage({ type: "SEND_KAFKA", cfg, items });
  if (!r || !r.ok) throw new Error("GATEWAY: " + (r && r.error));
}

async function runProvince(cfg) {
  const { prov, limit, delay } = cfg;
  const all = !limit || limit < 0;
  log("===== " + prov + " (" + (all ? "ALL" : limit) + ") -> topic " + cfg.topic + " =====");

  const done = await _getDone(prov);
  log("[" + prov + "] already sent: " + done.size);

  let data;
  try { data = await apiGet("/api/company?l=" + prov + "&p=1&r=100"); }
  catch (e) { log("403 on page 1. Open the site to pass Cloudflare, then run again."); return; }
  const total = (data.Option && data.Option.TotalRow) || 0;
  const want = all ? total : Math.min(limit, total);
  const pages = Math.ceil(want / 100);

  let mst = (data.LtsItems || []).map((x) => x.MaSoThue).filter(Boolean);
  for (let p = 2; p <= pages; p++) {
    if (STOP) { log("STOPPED (listing)."); return; }
    try {
      data = await apiGet("/api/company?l=" + prov + "&p=" + p + "&r=100");
      mst = mst.concat((data.LtsItems || []).map((x) => x.MaSoThue).filter(Boolean));
    } catch (e) { log("403 on list page " + p + ". Verify then run again."); return; }
    await new Promise((r) => setTimeout(r, delay));
  }
  mst = [...new Set(mst)].slice(0, want);
  const todo = mst.filter((m) => !done.has(m));
  log("[" + prov + "] " + mst.length + " MST, remaining " + todo.length);

  let buffer = [];
  let sent = done.size;

  async function flush() {
    if (!buffer.length) return;
    await pushKafka(cfg, buffer);
    buffer.forEach((x) => done.add(x.entry_rowkey));
    await _saveDone(prov, done);
    sent += buffer.length;
    buffer = [];
  }

  for (let i = 0; i < todo.length; i++) {
    if (STOP) { try { await flush(); } catch (e) {} log("STOPPED - " + prov + " | sent " + sent + "/" + mst.length); return; }
    let c;
    try { c = await apiGet("/api/company/" + todo[i]); }
    catch (e) { try { await flush(); } catch (_) {} log("403 - " + prov + " | sent " + sent + "/" + mst.length + " | verify then run again."); return; }
    buffer.push(wrap(c));
    if (buffer.length >= cfg.batch) {
      try { await flush(); } catch (e) { log("Gateway error: " + e.message + ". Stop."); return; }
      log("[" + prov + "] sent " + sent + "/" + mst.length);
    }
    await new Promise((r) => setTimeout(r, delay));
  }
  try { await flush(); } catch (e) { log("Gateway error: " + e.message); return; }
  log("DONE " + prov + ": sent " + sent + " companies.");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START") { STOP = false; runProvince(msg.cfg); sendResponse({ ok: true }); }
  else if (msg.type === "STOP") { STOP = true; sendResponse({ ok: true }); }
  else if (msg.type === "RESET_PROV") {
    _saveDone(msg.prov, new Set()).then(() => { log("Cleared progress: " + msg.prov); sendResponse({ ok: true }); });
    return true;
  }
});
