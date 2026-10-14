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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function _db() {
  return new Promise((ok, err) => {
    const r = indexedDB.open("ttdn_ext", 2);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains("prog")) db.createObjectStore("prog");
    };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => err(r.error);
  });
}

async function _getProgress(prov) {
  const d = await _db();
  return new Promise((ok) => {
    const t = d.transaction("prog", "readonly").objectStore("prog").get(prov);
    t.onsuccess = () => ok(typeof t.result === "number" ? t.result : 0);
    t.onerror = () => ok(0);
  });
}

async function _saveProgress(prov, page) {
  const d = await _db();
  return new Promise((ok) => {
    const t = d.transaction("prog", "readwrite");
    t.objectStore("prog").put(page, prov);
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

  const donePages = await _getProgress(prov);
  const startPage = donePages + 1;
  if (donePages > 0) log("[" + prov + "] resume from page " + startPage);

  let pages = -1;
  let want = 0;
  let sentRun = 0;

  for (let p = startPage; pages === -1 || p <= pages; p++) {
    if (STOP) { log("STOPPED - " + prov + " before page " + p + "."); return; }

    let pageData;
    try { pageData = await apiGet("/api/company?l=" + prov + "&p=" + p + "&r=100"); }
    catch (e) { log("403 on list page " + p + " - " + prov + ". F5 to pass Cloudflare, then Start again."); return; }

    if (pages === -1) {
      const total = (pageData.Option && pageData.Option.TotalRow) || 0;
      want = all ? total : Math.min(limit, total);
      pages = Math.ceil(want / 100);
      log("[" + prov + "] total " + total + ", pages " + pages);
      if (startPage > pages) { log("[" + prov + "] already complete."); return; }
    }

    let msts = (pageData.LtsItems || []).map((x) => x.MaSoThue).filter(Boolean);
    if (!all) {
      const remain = want - (p - 1) * 100;
      if (remain <= 0) break;
      if (msts.length > remain) msts = msts.slice(0, remain);
    }

    let buffer = [];
    for (let i = 0; i < msts.length; i++) {
      if (STOP) { log("STOPPED - " + prov + " mid page " + p + " (page will redo)."); return; }
      let c;
      try { c = await apiGet("/api/company/" + msts[i]); }
      catch (e) { log("403 - " + prov + " page " + p + " (page will redo). F5 then Start again."); return; }
      buffer.push(wrap(c));
      if (buffer.length >= cfg.batch) {
        try { await pushKafka(cfg, buffer); } catch (e) { log("Gateway error: " + e.message + ". Stop."); return; }
        sentRun += buffer.length;
        buffer = [];
      }
      await sleep(delay);
    }
    if (buffer.length) {
      try { await pushKafka(cfg, buffer); } catch (e) { log("Gateway error: " + e.message + ". Stop."); return; }
      sentRun += buffer.length;
      buffer = [];
    }

    await _saveProgress(prov, p);
    log("[" + prov + "] page " + p + "/" + pages + " done | sent this run " + sentRun);
  }

  log("DONE " + prov + ": " + pages + " pages complete, sent this run " + sentRun + ".");
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START") { STOP = false; runProvince(msg.cfg); sendResponse({ ok: true }); }
  else if (msg.type === "STOP") { STOP = true; sendResponse({ ok: true }); }
  else if (msg.type === "RESET_PROV") {
    _saveProgress(msg.prov, 0).then(() => { log("Cleared progress: " + msg.prov); sendResponse({ ok: true }); });
    return true;
  }
});