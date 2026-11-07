"use strict";
/* やねうら王 (WebAssembly) を Web Worker 内で動かし、USIを中継する。
   評価関数ファイル（つようら王11mini: nn.bin / progress.bin）は
   エンジンの仮想ファイルシステムへ書き込んでから isready する。
   v4: 起動の各段階をページへログ送信し、失敗箇所を特定できるようにした。 */
let mod = null;
let waiters = [];

const T0 = Date.now();
function log(step) {
  try { self.postMessage({ type: "log", step: "[+" + ((Date.now() - T0) / 1000).toFixed(1) + "s] " + step }); } catch {}
}
function fail(stage, err) {
  const detail = err && (err.stack || err.message) ? String(err.stack || err.message) : String(err);
  try { self.postMessage({ type: "error", message: stage + ": " + detail.slice(0, 600) }); } catch {}
}

self.addEventListener("error", (e) => {
  log("global-error: " + (e.message || "不明") + " @ " + (e.filename || "") + ":" + (e.lineno || ""));
});
self.addEventListener("unhandledrejection", (e) => {
  log("unhandledrejection: " + String((e.reason && (e.reason.stack || e.reason.message)) || e.reason).slice(0, 400));
});

function checkWaiters(line) {
  const done = waiters.filter(w => line.startsWith(w.prefix));
  waiters = waiters.filter(w => !line.startsWith(w.prefix));
  for (const w of done) w.resolve(line);
}
function waitFor(prefix, timeoutMs) {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(prefix + " が " + timeoutMs + "ms 以内に返りませんでした")), timeoutMs);
    waiters.push({ prefix, resolve: (v) => { clearTimeout(t); resolve(v); } });
  });
}

async function init(variant) {
  // 評価関数は構造（ネットワークサイズ）がエンジンのビルドに固定されるため、
  // mini / micro は別ビルドのエンジン一式をフォルダごと切り替える。
  const dir = variant === "micro" ? "micro-" : "mini-";
  const factoryName = variant === "micro" ? "YaneuraOu_TsuyouMicro" : "YaneuraOu_TsuyouMini";
  log("w0: worker起動。評価関数=" + variant + " / 分離=" + self.crossOriginIsolated + " / SAB=" + (typeof SharedArrayBuffer !== "undefined"));
  try { importScripts(dir + "yaneuraou.js"); }
  catch (e) { fail("w1 importScripts", e); return; }
  log("w1: エンジン本体JS 読込OK（factory型=" + typeof self[factoryName] + "）");

  let nnBuf, progBuf;
  try {
    [nnBuf, progBuf] = await Promise.all([
      fetch(dir + "nn.bin").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }),
      fetch(dir + "progress.bin").then(r => { if (!r.ok) throw new Error("HTTP " + r.status); return r.arrayBuffer(); }),
    ]);
  } catch (e) { fail("w2 評価関数fetch", e); return; }
  log("w2: 評価関数 取得OK（nn=" + nnBuf.byteLength + "B / progress=" + progBuf.byteLength + "B）");

  try {
    mod = await self[factoryName]({
      locateFile: (path) => dir + path,
      // 探索スレッド（pthread）側が読み直す本体スクリプトは、既定では
      // このラッパー自身のURLになってしまい起動に失敗する。実体を明示する。
      mainScriptUrlOrBlob: new URL(dir + "yaneuraou.js", self.location.href).href,
      print: (line) => log("engine-out: " + line),
      printErr: (line) => log("engine-err: " + line),
      onAbort: (what) => log("engine-abort: " + String(what).slice(0, 300)),
    });
  } catch (e) { fail("w3 エンジン初期化", e); return; }
  log("w3: エンジン初期化OK");

  try {
    mod.FS.writeFile("/nn.bin", new Uint8Array(nnBuf));
    mod.FS.writeFile("/progress.bin", new Uint8Array(progBuf));
    mod.addMessageListener(line => {
      if (!line.startsWith("info ")) log("line: " + line.slice(0, 200));
      checkWaiters(line);
      self.postMessage({ type: "line", line });
    });
  } catch (e) { fail("w4 仮想FS書込", e); return; }
  log("w4: 仮想FSへ評価関数を配置OK");

  // エンジン本体の起動登録（wasm_keep_alive）は非同期で、未登録の間
  // usi_command は「後で再送」を返し続け、再送間隔は指数的に伸びる。
  // そのため、少し待ってから送り始め、応答があるまで定期的に再送する。
  try {
    await new Promise(r => setTimeout(r, 3000));
    log("w5: usi送信（最大90秒、10秒ごとに再送）");
    const usiReady = waitFor("usiok", 90000);
    mod.postMessage("usi");
    const usiTimer = setInterval(() => { log("w5r: usi再送"); mod.postMessage("usi"); }, 10000);
    try { await usiReady; } finally { clearInterval(usiTimer); }
    log("w5ok: usiok 受信");
    mod.postMessage("setoption name EvalDir value .");
    mod.postMessage("setoption name EvalFile value nn.bin");
    mod.postMessage("setoption name Threads value 1");
    mod.postMessage("setoption name USI_Hash value 32");
    mod.postMessage("setoption name BookFile value no_book"); mod.postMessage("setoption name FV_SCALE value 24");
    log("w6: isready送信（最大90秒、15秒ごとに再送）");
    const engineReady = waitFor("readyok", 90000);
    mod.postMessage("isready");
    const readyTimer = setInterval(() => { log("w6r: isready再送"); mod.postMessage("isready"); }, 15000);
    try { await engineReady; } finally { clearInterval(readyTimer); }
  } catch (e) { fail("w5/6 USIハンドシェイク", e); return; }
  log("w7: readyok 受信");
  mod.postMessage("usinewgame"); self.postMessage({ type: "ready" });
}

self.onmessage = async (e) => {
  const d = e.data || {};
  if (d.type === "init") {
    try { await init(d.variant); }
    catch (err) { fail("init全般", err); }
  } else if (d.type === "command") {
    if (mod) mod.postMessage(d.line);
  }
};
log("w-1: workerスクリプト評価完了");


