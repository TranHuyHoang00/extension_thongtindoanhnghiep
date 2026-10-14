# Thong Tin Doanh Nghiep Extractor (Chrome extension)

Extract company data from thongtindoanhnghiep.co (via API, inside a tab that passed Cloudflare)
and send directly to the Kafka gateway. Background service worker does the POST, so no CORS.

## Install
1. chrome://extensions/
2. Enable Developer mode
3. Load unpacked -> choose this folder (extension_thongtindoanhnghiep)
4. Click the extension icon to open the Side Panel

## Use
1. Open https://thongtindoanhnghiep.co and pass Cloudflare (open /api/city, see JSON)
2. Keep that tab active, open the Side Panel
3. Fill: province slug (e.g. bac-can), limit (-1 = all), delay (ms), batch, Gateway URL, Topic
4. Start. Watch the log.
   - Stop: Stop button
   - Continue after stop/403: Start again (skips already-sent, saved in IndexedDB)
   - Redo a province from scratch: Reset

## Files
manifest.json    extension config, permissions, hosts
background.js    receive batch -> POST gateway (no CORS)
content.js       runs in the TTDN tab: fetch raw, batch, save progress (IndexedDB)
sidepanel.*      UI, Start/Stop, log
