let STOP = false;

const META = {
  author_id: "6071def4536dcfba68a69b160dfcecc9",
  owner_id: "6071def4536dcfba68a69b160dfcecc9",
  owner_name: "Thông Tin Doanh Nghiệp",
  author_name: "Thông Tin Doanh Nghiệp",
  tenant_ids: ["9c70933aff6b2a6d08c687a6cbb6b765"],
  source_type: "",
  crawler_system: "extension-crawler",
  channel_name: "business",
};

// Đổi mọi giá trị null (kể cả nằm sâu trong object/mảng con) thành "".
// Các giá trị khác giữ nguyên: 0, false, "" vẫn là 0, false, "".
function nullToEmpty(v) {
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.map(nullToEmpty);
  if (typeof v === "object") {
    const out = {};
    for (const k of Object.keys(v)) out[k] = nullToEmpty(v[k]);
    return out;
  }
  return v;
}

function wrap(info) {
  const now = Date.now();
  const solr = info && info.SolrID ? info.SolrID : "";
  return nullToEmpty({
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
    author_name: META.author_name,
  });
}

function log(msg) {
  chrome.runtime.sendMessage({ type: "LOG", msg }).catch(() => {});
  console.log("[TTDN]", msg);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ===================== Cấu hình chống chặn =====================
const BLOCK_RETRY_MS = 20000; // bị chặn: chờ 20 giây rồi thử lại tại chỗ
const RETRIES_BEFORE_RELOAD = 1; // thử lại tại chỗ bao nhiêu lần trước khi tự F5 trang
const MAX_RELOADS = 10; // tự F5 tối đa 10 lần liên tiếp mà không tiến thêm được công ty nào
const RESUME_DELAY_MS = 3000; // trang tải lại xong, chờ 3 giây rồi mới chạy tiếp
const PAGE_SIZE = 100; // số công ty mỗi trang danh sách (tham số r)

let RUNNING = false;

class StopError extends Error {}
class BlockedError extends Error {}

const bg = (msg) => chrome.runtime.sendMessage(msg);

// Trang hiện tại là trang kiểm tra của Cloudflare (chưa giải xong)?
function isChallengePage() {
  const title = document.title || "";
  if (
    /just a moment|attention required|checking your browser|một chút/i.test(
      title,
    )
  )
    return true;
  return !!document.querySelector(
    "#challenge-form, #challenge-running, #cf-challenge-running, .cf-browser-verification",
  );
}

// Chờ nhưng vẫn phản hồi nút Stop ngay (kiểm tra mỗi giây)
async function waitOrStop(ms) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (STOP) throw new StopError("stopped");
    await sleep(Math.min(1000, end - Date.now()));
  }
}

// ===================== Tiến độ: theo từng công ty đã gửi =====================
// Lưu { page, idx }: đã xong trọn `page` trang, và đã gửi `idx` công ty đầu của trang kế tiếp.
// (Bản cũ lưu một con số = số trang đã xong; vẫn đọc được.)
// Chỉ lưu số trang/vị trí, không lưu cấu hình hay API key.
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
    t.onsuccess = () => {
      const v = t.result;
      if (typeof v === "number") return ok({ page: v, idx: 0 });
      if (v && typeof v.page === "number")
        return ok({ page: v.page, idx: v.idx || 0 });
      ok({ page: 0, idx: 0 });
    };
    t.onerror = () => ok({ page: 0, idx: 0 });
  });
}

async function _saveProgress(prov, page, idx = 0) {
  const d = await _db();
  return new Promise((ok) => {
    const t = d.transaction("prog", "readwrite");
    t.objectStore("prog").put({ page, idx }, prov);
    t.oncomplete = () => ok();
  });
}

// ===================== Gọi API =====================
// Bị chặn / giới hạn tạm thời (403, 429, 5xx, trả về HTML thay vì JSON, lỗi mạng):
//   chờ 20 giây thử lại tại chỗ; vẫn bị → BlockedError (runProvince sẽ tự F5 trang).
// Lỗi khác (ví dụ 404) → Error, dừng hẳn.
async function apiGet(url) {
  for (let attempt = 0; ; attempt++) {
    if (STOP) throw new StopError("stopped");
    let reason;
    try {
      const res = await fetch(url, { credentials: "include" });
      if (res.ok) {
        const text = await res.text();
        try {
          return JSON.parse(text);
        } catch {
          reason = "response is not JSON (Cloudflare challenge?)";
        }
      } else if (
        res.status === 403 ||
        res.status === 429 ||
        res.status >= 500
      ) {
        reason = "HTTP " + res.status;
      } else {
        throw new Error("HTTP " + res.status + " at " + url);
      }
    } catch (e) {
      if (e.message.startsWith("HTTP ")) throw e;
      reason = "network error: " + e.message;
    }

    if (attempt >= RETRIES_BEFORE_RELOAD) throw new BlockedError(reason);
    log(
      "Blocked (" +
        reason +
        "). Retry in " +
        BLOCK_RETRY_MS / 1000 +
        "s: " +
        url,
    );
    await waitOrStop(BLOCK_RETRY_MS);
  }
}

async function pushKafka(cfg, items) {
  const r = await bg({ type: "SEND_KAFKA", cfg, items });
  if (!r || !r.ok) throw new Error("GATEWAY: " + (r && r.error));
}

// Xử lý lỗi chung: Stop → dừng; bị chặn → tự F5 rồi tự chạy tiếp; lỗi khác → dừng hẳn
async function handleError(e, where) {
  if (e instanceof StopError) {
    log("STOPPED - " + where + ".");
    await bg({ type: "RUN_CLEAR" }).catch(() => {});
    return;
  }
  if (e instanceof BlockedError) {
    const r = await bg({ type: "RUN_RELOAD", max: MAX_RELOADS }).catch(
      () => null,
    );
    if (!r || !r.ok) {
      log(
        "Blocked (" +
          e.message +
          ") - " +
          where +
          ". Reloaded " +
          MAX_RELOADS +
          " times without progress. Stop, press Start to try again.",
      );
      await bg({ type: "RUN_CLEAR" }).catch(() => {});
      return;
    }
    log(
      "Blocked (" +
        e.message +
        ") - " +
        where +
        ". Reloading page to pass Cloudflare (" +
        r.reloads +
        "/" +
        MAX_RELOADS +
        "), will resume automatically.",
    );
    await sleep(500);
    location.reload();
    return;
  }
  log(
    "Error - " + where + ": " + e.message + ". Stop, press Start to continue.",
  );
  await bg({ type: "RUN_CLEAR" }).catch(() => {});
}

// ===================== Chạy một tỉnh =====================
async function runProvince(cfg) {
  RUNNING = true;
  try {
    await _runProvince(cfg);
  } finally {
    RUNNING = false;
  }
}

async function _runProvince(cfg) {
  const { prov, limit, delay } = cfg;
  const all = !limit || limit < 0;
  log(
    "===== " +
      prov +
      " (" +
      (all ? "ALL" : limit) +
      ") -> topic " +
      cfg.topic +
      " =====",
  );

  const prog = await _getProgress(prov);
  const startPage = prog.page + 1;
  if (prog.page > 0 || prog.idx > 0) {
    log(
      "[" +
        prov +
        "] resume from page " +
        startPage +
        (prog.idx ? ", company #" + (prog.idx + 1) : ""),
    );
  }

  let pages = -1;
  let want = 0;
  let sentRun = 0;

  for (let p = startPage; pages === -1 || p <= pages; p++) {
    if (STOP) return handleError(new StopError(), prov + " before page " + p);

    let pageData;
    try {
      pageData = await apiGet(
        "/api/company?l=" + prov + "&p=" + p + "&r=" + PAGE_SIZE,
      );
    } catch (e) {
      return handleError(e, prov + " list page " + p);
    }

    if (pages === -1) {
      const total = (pageData.Option && pageData.Option.TotalRow) || 0;
      want = all ? total : Math.min(limit, total);
      pages = Math.ceil(want / PAGE_SIZE);
      log("[" + prov + "] total " + total + ", pages " + pages);
      if (startPage > pages) {
        log("[" + prov + "] already complete.");
        await bg({ type: "RUN_CLEAR" }).catch(() => {});
        return;
      }
    }

    let msts = (pageData.LtsItems || []).map((x) => x.MaSoThue).filter(Boolean);
    if (!all) {
      const remain = want - (p - 1) * PAGE_SIZE;
      if (remain <= 0) break;
      if (msts.length > remain) msts = msts.slice(0, remain);
    }

    // Trang đang làm dở từ trước: bỏ qua các công ty đã gửi
    const startIdx = p === startPage ? Math.min(prog.idx, msts.length) : 0;
    if (startIdx > 0)
      log(
        "[" +
          prov +
          "] page " +
          p +
          ": skip " +
          startIdx +
          " companies already sent",
      );

    let buffer = [];
    for (let i = startIdx; i < msts.length; i++) {
      if (STOP) return handleError(new StopError(), prov + " page " + p);
      let c;
      try {
        c = await apiGet("/api/company/" + msts[i]);
      } catch (e) {
        return handleError(e, prov + " page " + p);
      }
      buffer.push(wrap(c));
      if (buffer.length >= cfg.batch) {
        try {
          await pushKafka(cfg, buffer);
        } catch (e) {
          return handleError(e, "gateway, " + prov + " page " + p);
        }
        sentRun += buffer.length;
        buffer = [];
        await _saveProgress(prov, p - 1, i + 1); // đã gửi i+1 công ty đầu của trang p
        bg({ type: "RUN_OK" }).catch(() => {});
      }
      await sleep(delay);
    }
    if (buffer.length) {
      try {
        await pushKafka(cfg, buffer);
      } catch (e) {
        return handleError(e, "gateway, " + prov + " page " + p);
      }
      sentRun += buffer.length;
      buffer = [];
      bg({ type: "RUN_OK" }).catch(() => {});
    }

    await _saveProgress(prov, p, 0);
    log(
      "[" +
        prov +
        "] page " +
        p +
        "/" +
        pages +
        " done | sent this run " +
        sentRun,
    );
  }

  log(
    "DONE " +
      prov +
      ": " +
      pages +
      " pages complete, sent this run " +
      sentRun +
      ".",
  );
  await bg({ type: "RUN_CLEAR" }).catch(() => {});
}

// ===================== Lệnh từ side panel =====================
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === "START") {
    if (RUNNING) {
      log("Already running.");
      sendResponse({ ok: false });
      return;
    }
    STOP = false;
    // Ghi nhớ lượt chạy (trong RAM của extension) để tự chạy tiếp sau khi trang tải lại
    bg({ type: "RUN_SAVE", cfg: msg.cfg })
      .catch(() => {})
      .then(() => runProvince(msg.cfg));
    sendResponse({ ok: true });
  } else if (msg.type === "STOP") {
    STOP = true;
    bg({ type: "RUN_CLEAR" }).catch(() => {});
    sendResponse({ ok: true });
  } else if (msg.type === "RESET_PROV") {
    _saveProgress(msg.prov, 0, 0).then(() => {
      log("Cleared progress: " + msg.prov);
      sendResponse({ ok: true });
    });
    return true;
  }
});

// ===================== Tự chạy tiếp sau khi trang tải lại =====================
(async () => {
  const r = await bg({ type: "RUN_GET" }).catch(() => null);
  if (!r || !r.run) return;
  if (isChallengePage()) {
    log("Cloudflare check page detected, waiting for it to be solved...");
    return; // giải xong Cloudflare sẽ tải lại trang, content script chạy lại từ đầu
  }
  log(
    "Page reloaded, resuming " +
      r.run.cfg.prov +
      " in " +
      RESUME_DELAY_MS / 1000 +
      "s...",
  );
  await sleep(RESUME_DELAY_MS);
  if (STOP || RUNNING) return;
  const again = await bg({ type: "RUN_GET" }).catch(() => null); // có thể đã bấm Stop trong lúc chờ
  if (!again || !again.run) return;
  runProvince(again.run.cfg);
})();
