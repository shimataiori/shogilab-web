"use strict";
const engineChoices = {simple:"簡易AI",mini:"つようら王11mini",micro:"つようら王11micro"};
const choice = document.getElementById("engineChoice");
const isolationNotice = document.getElementById("isolationNotice");
const testScope = /\/engine-test\/$/.test(location.pathname);
const diagnostics = document.createElement("details");
const diagnosticTitle = document.createElement("summary");
diagnosticTitle.textContent = "起動の診断";
const diagnosticText = document.createElement("pre");
diagnosticText.style.whiteSpace = "pre-wrap";
diagnostics.append(diagnosticTitle, diagnosticText);
isolationNotice.after(diagnostics);
const diagnosticLines = [];
function diagnostic(message) {
  diagnosticLines.push(message);
  diagnosticText.textContent = diagnosticLines.slice(-20).join("\n");
}
function showStartupError(message) {
  diagnostic(message);
  diagnostics.open = true;
  isolationNotice.textContent = message;
}
diagnostic("ページ分離: " + (crossOriginIsolated ? "有効" : "無効"));
diagnostic("共有メモリー: " + (typeof SharedArrayBuffer === "function" ? "利用可" : "利用不可"));

// Limit the worker to the test directory, away from the production app.
if (testScope && navigator.serviceWorker) {
  const reloadForIsolation = () => {
    if (crossOriginIsolated || !navigator.serviceWorker.controller) return;
    const url = new URL(location.href);
    if (url.searchParams.get("isolated") === "2") {
      showStartupError("配信設定は読み込まれましたが、このタブで共有メモリーを使えません。");
      return;
    }
    url.searchParams.set("isolated", "2");
    location.replace(url);
  };
  navigator.serviceWorker.addEventListener("controllerchange", reloadForIsolation);
  navigator.serviceWorker.register("./isolate-sw.js?v=2", {scope:"./",updateViaCache:"none"}).then(async () => {
    diagnostic("配信設定を登録");
    await navigator.serviceWorker.ready;
    diagnostic("配信設定が有効");
    reloadForIsolation();
  }).catch(error => showStartupError("配信設定の登録に失敗しました。 " + error.message));
} else if (!navigator.serviceWorker) {
  diagnostic("Service Workerを利用できません");
}
const isolationReady = crossOriginIsolated && typeof SharedArrayBuffer === "function";
isolationNotice.textContent = isolationReady ? "やねうら王を起動できる配信設定です。" :
  "やねうら王にはブラウザの分離設定が必要です。準備後も表示が変わらない場合はページを再読み込みしてください。";

const wasmEngine = {
  worker:null,
  job:null,
  ready:false,
  close(){
    if (this.worker) this.worker.terminate();
    this.worker = null;
    this.ready = false;
  },
  fail(error){
    const job = this.job;
    this.job = null;
    if (job) {
      clearTimeout(job.timeout);
      if (!job.stopped && !/停止|切り替え/.test(error.message)) showStartupError(error.message);
      job.reject(error);
    }
    this.close();
  },
  run(sfen, count){
    if (!isolationReady) {
      diagnostics.open = true;
      return Promise.reject(new Error("ブラウザの分離設定がまだ有効ではありません"));
    }
    if (this.job) return Promise.reject(new Error("探索中です"));
    return new Promise((resolve,reject) => {
      const job = {sfen,count,resolve,reject,startedAt:current,lines:new Map(),stopped:false};
      this.job = job;
      job.timeout = setTimeout(() => this.fail(new Error("エンジンの応答が時間内に届きませんでした")), 100000);
      if (this.ready) { this.search(); return; }
      setEngineStatus("やねうら王を準備中…");
      diagnostic(engineChoices[choice.value] + "の起動を開始");
      try {
        this.worker = new Worker("wasm-worker.js");
        this.worker.onmessage = ({data}) => this.message(data);
        this.worker.onerror = event => this.fail(new Error(event.message || "やねうら王を起動できませんでした"));
        this.worker.postMessage({type:"init",variant:choice.value});
      } catch (error) { this.fail(error); }
    });
  },
  send(line){this.worker.postMessage({type:"command",line});},
  search(){
    const job = this.job;
    if (!job) return;
    setEngineStatus(engineChoices[choice.value]);
    clearTimeout(job.timeout);
    job.timeout = setTimeout(() => this.fail(new Error("解析が時間内に終わりませんでした")), 18000);
    this.send("setoption name MultiPV value " + job.count);
    this.send("position sfen " + job.sfen);
    this.send("go movetime " + document.getElementById("wasmTime").value);
  },
  message(data){
    if (data.type === "log") { diagnostic(data.step); return; }
    if (data.type === "error") { this.fail(new Error(data.message)); return; }
    if (data.type === "ready") {this.ready = true; this.search(); return;}
    const job = this.job;
    if (!job || data.type !== "line") return;
    const line = data.line;
    if (line.startsWith("bestmove ")) {
      clearTimeout(job.timeout);
      this.job = null;
      if (job.stopped) job.reject(new Error("探索を停止しました"));
      else if (job.startedAt !== current) job.reject(new Error("局面が変わったため探索を終了しました"));
      else job.resolve({best:line.split(/\s+/)[1],list:[...job.lines.values()].sort((a,b)=>a.multipv-b.multipv)});
      return;
    }
    const pv = line.match(/\bpv\s+(.+)$/);
    const score = line.match(/\bscore\s+(cp|mate)\s+([+-]?\d+|[+-])(?:\s|$)/);
    if (!line.startsWith("info ") || !pv || !score) return;
    const multipv = Number((line.match(/\bmultipv\s+(\d+)/)||[])[1] || 1);
    const depth = Number((line.match(/\bdepth\s+(\d+)/)||[])[1] || 0);
    const value = score[2] === "+" ? 1 : score[2] === "-" ? -1 : Number(score[2]);
    if (!job.lines.has(multipv) || job.lines.get(multipv).depth <= depth)
      job.lines.set(multipv,{multipv,depth,score:{kind:score[1],value},pv:pv[1].trim().split(/\s+/)});
  },
  stop(){
    if (!this.job) return;
    if (!this.ready) { this.fail(new Error("エンジンの準備を停止しました")); return; }
    this.job.stopped = true;
    this.send("stop");
    clearTimeout(this.job.timeout);
    this.job.timeout = setTimeout(() => this.fail(new Error("探索を停止しました")), 2500);
  }
};

function setEngineStatus(message){document.getElementById("engineStatusText").textContent = message;}
const simpleSearch = engine.runSearch.bind(engine);
const simpleStop = engine.stopSearch.bind(engine);
engine.runSearch = (sfen,count) => choice.value === "simple" ? simpleSearch(sfen,count) : wasmEngine.run(sfen,count);
engine.stopSearch = () => { simpleStop(); wasmEngine.stop(); };
choice.addEventListener("change", () => {
  simpleStop();
  wasmEngine.fail(new Error("エンジンを切り替えました"));
  setEngineStatus(engineChoices[choice.value]);
  document.getElementById("simpleDepth").hidden = choice.value !== "simple";
  document.getElementById("wasmDuration").hidden = choice.value === "simple";
  renderCandidatesClear();
});
