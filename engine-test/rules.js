
"use strict";
/* ================= 将棋コア（Windows版 shogi_core.py の移植） ================= */
const RANK_LETTER = "abcdefghi";              // rank1=a
const LETTER_TO_RANK = {}; for (let i=0;i<9;i++) LETTER_TO_RANK[RANK_LETTER[i]] = i+1;
const RANK_FROM_LETTER = LETTER_TO_RANK;
const RANK_KANJI = ["","一","二","三","四","五","六","七","八","九"];
const RANK_FROM_KANJI = {}; RANK_KANJI.forEach((k,i)=>{ if(k) RANK_FROM_KANJI[k]=i; });
const KANJI = {P:"歩",L:"香",N:"桂",S:"銀",G:"金",B:"角",R:"飛",K:"玉"};
const PROMOTED_KANJI = {P:"と",L:"成香",N:"成桂",S:"成銀",B:"馬",R:"龍"};
const HAND_ORDER = ["R","B","G","S","N","L","P"];
const PROMOTABLE = ["P","L","N","S","B","R"];
const STARTPOS_SFEN = "lnsgkgsnl/1r5b1/ppppppppp/9/9/9/PPPPPPPPP/1B5R1/LNSGKGSNL b - 1";
const FULLWIDTH_DIGITS = {"１":"1","２":"2","３":"3","４":"4","５":"5","６":"6","７":"7","８":"8","９":"9"};

function pieceKanji(p){ return p.promoted ? PROMOTED_KANJI[p.kind] : KANJI[p.kind]; }
function forward(owner){ return owner === "b" ? -1 : 1; }
function inPromoZone(owner, rank){ return owner === "b" ? rank <= 3 : rank >= 7; }
function deadRanks(owner, kind){
  if (kind === "P" || kind === "L") return owner === "b" ? [1] : [9];
  if (kind === "N") return owner === "b" ? [1,2] : [8,9];
  return [];
}
const key = (f,r) => f + "," + r;

class Position {
  constructor(){ this.board = new Map(); this.hands = {b:{}, w:{}}; this.turn = "b"; this.moveNumber = 1; }
  static startpos(){ return Position.fromSfen(STARTPOS_SFEN); }
  static fromSfen(sfen){
    const parts = sfen.trim().split(/\s+/);
    if (parts.length !== 4) throw new Error("SFENは4要素が必要です");
    const [boardPart, turn, handsPart, moveNo] = parts;
    if (turn !== "b" && turn !== "w") throw new Error("SFENの手番が不正です");
    const pos = new Position();
    pos.turn = turn; pos.moveNumber = parseInt(moveNo, 10);
    if (Number.isNaN(pos.moveNumber)) throw new Error("SFENの手数が不正です");
    const rows = boardPart.split("/");
    if (rows.length !== 9) throw new Error("SFENの盤面は9段が必要です");
    rows.forEach((row, ri) => {
      const rank = ri + 1; let file = 9, i = 0;
      while (i < row.length) {
        let ch = row[i];
        if (/\d/.test(ch)) { file -= parseInt(ch,10); i++; continue; }
        let promoted = false;
        if (ch === "+") { promoted = true; i++; ch = row[i]; }
        const kind = ch.toUpperCase();
        if (!"PLNSGBRK".includes(kind)) throw new Error("SFENの駒文字が不正です: " + ch);
        const owner = ch === kind ? "b" : "w";
        pos.board.set(key(file, rank), {owner, kind, promoted});
        file--; i++;
      }
      if (file !== 0) throw new Error("SFENの段の幅が9になっていません: " + row);
    });
    if (handsPart !== "-") {
      let i = 0;
      while (i < handsPart.length) {
        let count = 1;
        if (/\d/.test(handsPart[i])) {
          let j = i; while (j < handsPart.length && /\d/.test(handsPart[j])) j++;
          count = parseInt(handsPart.slice(i,j),10); i = j;
        }
        const ch = handsPart[i], kind = ch.toUpperCase();
        if (!"PLNSGBR".includes(kind)) throw new Error("SFENの持ち駒が不正です");
        const owner = ch === kind ? "b" : "w";
        pos.hands[owner][kind] = (pos.hands[owner][kind]||0) + count;
        i++;
      }
    }
    return pos;
  }
  toSfen(){
    const rows = [];
    for (let rank=1; rank<=9; rank++) {
      let row = "", empty = 0;
      for (let file=9; file>=1; file--) {
        const p = this.board.get(key(file,rank));
        if (!p) { empty++; continue; }
        if (empty) { row += empty; empty = 0; }
        row += (p.promoted ? "+" : "") + (p.owner === "b" ? p.kind : p.kind.toLowerCase());
      }
      if (empty) row += empty;
      rows.push(row);
    }
    let hs = "";
    for (const owner of ["b","w"]) for (const kind of HAND_ORDER) {
      const n = this.hands[owner][kind]||0;
      if (n) hs += (n>1 ? n : "") + (owner === "b" ? kind : kind.toLowerCase());
    }
    return rows.join("/") + " " + this.turn + " " + (hs || "-") + " " + this.moveNumber;
  }
  clone(){
    const p = new Position();
    p.board = new Map([...this.board].map(([k,v]) => [k, {...v}]));
    p.hands = {b:{...this.hands.b}, w:{...this.hands.w}};
    p.turn = this.turn; p.moveNumber = this.moveNumber;
    return p;
  }
  movementOk(piece, src, dst){
    const df = dst[0]-src[0], dr = dst[1]-src[1], f = forward(piece.owner);
    let kind = piece.kind;
    if (piece.promoted && ["P","L","N","S"].includes(kind)) kind = "G";
    switch (kind) {
      case "P": return df === 0 && dr === f;
      case "L": return df === 0 && dr * f > 0;
      case "N": return Math.abs(df) === 1 && dr === 2 * f;
      case "S": return [[0,f],[1,f],[-1,f],[1,-f],[-1,-f]].some(([a,b]) => a===df && b===dr);
      case "G": return [[0,f],[1,f],[-1,f],[1,0],[-1,0],[0,-f]].some(([a,b]) => a===df && b===dr);
      case "K": return Math.max(Math.abs(df),Math.abs(dr)) === 1 && !(df===0 && dr===0);
      case "B": { const base = Math.abs(df) === Math.abs(dr) && df !== 0;
                  return piece.promoted ? (base || Math.max(Math.abs(df),Math.abs(dr)) === 1) : base; }
      case "R": { const base = (df === 0) !== (dr === 0);
                  return piece.promoted ? (base || (Math.abs(df)===1 && Math.abs(dr)===1)) : base; }
    }
    return false;
  }
  pathBlocked(piece, src, dst){
    const df = dst[0]-src[0], dr = dst[1]-src[1];
    const dist = Math.max(Math.abs(df), Math.abs(dr));
    let sliding = ["L","B","R"].includes(piece.kind) &&
      !(piece.promoted && dist === 1 && ["B","R"].includes(piece.kind));
    if (piece.promoted && ["P","L","N","S"].includes(piece.kind)) sliding = false;
    if (!sliding || dist <= 1) return false;
    const sf = df === 0 ? 0 : Math.sign(df), sr = dr === 0 ? 0 : Math.sign(dr);
    for (let i=1;i<dist;i++) if (this.board.has(key(src[0]+sf*i, src[1]+sr*i))) return true;
    return false;
  }
  canMoveTo(piece, src, dst){
    const t = this.board.get(key(dst[0],dst[1]));
    if (t && t.owner === piece.owner) return false;
    return this.movementOk(piece, src, dst) && !this.pathBlocked(piece, src, dst);
  }
  /* USIを検証して適用する。失敗したら Error（理由つき）。 */
  applyUsi(usi){
    usi = (usi||"").trim();
    if (!usi) throw new Error("指し手が空です");
    if (usi.includes("*")) this._applyDrop(usi); else this._applyBoardMove(usi);
    this.turn = this.turn === "b" ? "w" : "b";
    this.moveNumber += 1;
  }
  _parseSquare(fc, rc){
    if (!"123456789".includes(fc) || !(rc in LETTER_TO_RANK))
      throw new Error("マスの指定が不正です: " + fc + rc);
    return [parseInt(fc,10), LETTER_TO_RANK[rc]];
  }
  _applyDrop(usi){
    if (usi.length !== 4 || usi[1] !== "*") throw new Error("打ち駒の表記が不正です: " + usi);
    const kind = usi[0].toUpperCase();
    if (!PROMOTABLE.includes(kind) && kind !== "G") throw new Error("打てない駒です: " + usi);
    const dest = this._parseSquare(usi[2], usi[3]);
    if (this.board.has(key(dest[0],dest[1]))) throw new Error("駒のあるマスには打てません: " + usi);
    if ((this.hands[this.turn][kind]||0) <= 0) throw new Error("持ち駒に " + kind + " がありません: " + usi);
    if (deadRanks(this.turn, kind).includes(dest[1])) throw new Error("行き場のない駒は打てません: " + usi);
    if (kind === "P") {
      for (const [k2,p] of this.board) {
        const f = parseInt(k2.split(",")[0],10);
        if (f === dest[0] && p.owner === this.turn && p.kind === "P" && !p.promoted)
          throw new Error("二歩は打てません: " + usi);
      }
    }
    this.hands[this.turn][kind] -= 1;
    if (this.hands[this.turn][kind] === 0) delete this.hands[this.turn][kind];
    this.board.set(key(dest[0],dest[1]), {owner:this.turn, kind, promoted:false});
  }
  _applyBoardMove(usi){
    const promote = usi.endsWith("+");
    const core = promote ? usi.slice(0,-1) : usi;
    if (core.length !== 4) throw new Error("指し手の表記が不正です: " + usi);
    const src = this._parseSquare(core[0], core[1]);
    const dst = this._parseSquare(core[2], core[3]);
    const piece = this.board.get(key(src[0],src[1]));
    if (!piece) throw new Error("移動元のマスに駒がありません: " + usi);
    if (piece.owner !== this.turn) throw new Error("相手の駒は動かせません: " + usi);
    const target = this.board.get(key(dst[0],dst[1]));
    if (target && target.owner === this.turn) throw new Error("自分の駒のあるマスには動けません: " + usi);
    if (!this.movementOk(piece, src, dst)) throw new Error("その駒はその動きができません: " + usi);
    if (this.pathBlocked(piece, src, dst)) throw new Error("途中の駒に遮られています: " + usi);
    const canPromote = !piece.promoted && PROMOTABLE.includes(piece.kind) &&
      (inPromoZone(piece.owner, src[1]) || inPromoZone(piece.owner, dst[1]));
    if (promote && !canPromote) throw new Error("その手では成れません: " + usi);
    if (!promote && !piece.promoted &&
        deadRanks(piece.owner, piece.kind).includes(dst[1]))
      throw new Error("行き場がなくなる手は成る必要があります: " + usi);
    this.board.delete(key(src[0],src[1]));
    if (target) {
      const ck = target.kind;
      this.hands[this.turn][ck] = (this.hands[this.turn][ck]||0) + 1;
    }
    this.board.set(key(dst[0],dst[1]), {owner:piece.owner, kind:piece.kind,
                                         promoted: piece.promoted || promote});
  }
  /* 擬似合法手（自玉の安全は見ない） */
  pseudoMoves(){
    const out = [];
    for (const [k2, piece] of this.board) {
      if (piece.owner !== this.turn) continue;
      const [sf, sr] = k2.split(",").map(Number);
      for (let tf=1; tf<=9; tf++) for (let tr=1; tr<=9; tr++) {
        if (!this.canMoveTo(piece, [sf,sr], [tf,tr])) continue;
        const base = sf + RANK_LETTER[sr-1] + tf + RANK_LETTER[tr-1];
        const canP = !piece.promoted && PROMOTABLE.includes(piece.kind) &&
          (inPromoZone(piece.owner, sr) || inPromoZone(piece.owner, tr));
        const forced = !piece.promoted && deadRanks(piece.owner, piece.kind).includes(tr);
        if (canP) { out.push(base + "+"); if (!forced) out.push(base); }
        else out.push(base);
      }
    }
    for (const kind of HAND_ORDER) {
      if ((this.hands[this.turn][kind]||0) <= 0) continue;
      for (let tf=1; tf<=9; tf++) for (let tr=1; tr<=9; tr++) {
        if (this.board.has(key(tf,tr))) continue;
        if (deadRanks(this.turn, kind).includes(tr)) continue;
        if (kind === "P") {
          let nifu = false;
          for (const [k2,p] of this.board) {
            const f = parseInt(k2.split(",")[0],10);
            if (f === tf && p.owner === this.turn && p.kind === "P" && !p.promoted) { nifu = true; break; }
          }
          if (nifu) continue;
        }
        out.push(kind + "*" + tf + RANK_LETTER[tr-1]);
      }
    }
    return out;
  }
  kingSquare(owner){
    for (const [k2,p] of this.board)
      if (p.kind === "K" && p.owner === owner) return k2.split(",").map(Number);
    return null;
  }
  isAttacked(sq, byOwner){
    for (const [k2,p] of this.board) {
      if (p.owner !== byOwner) continue;
      const src = k2.split(",").map(Number);
      if (this.movementOk(p, src, sq) && !this.pathBlocked(p, src, sq)) return true;
    }
    return false;
  }
  inCheck(owner){ const k = this.kingSquare(owner); return k ? this.isAttacked(k, owner === "b" ? "w" : "b") : false; }
  legalMoves(){
    return this.pseudoMoves().filter(usi => {
      const c = this.clone();
      try { c.applyUsi(usi); } catch { return false; }
      return !c.inCheck(this.turn);
    });
  }
}
function gameResult(pos){
  if (pos.legalMoves().length > 0) return null;
  return pos.turn === "b" ? "w" : "b";   // 手番側に手がなければ負け
}
function moveDestination(usi){
  if (!usi) return null;
  if (usi.includes("*")) return [parseInt(usi[2],10), LETTER_TO_RANK[usi[3]]];
  if (usi.length >= 4) return [parseInt(usi[2],10), LETTER_TO_RANK[usi[3]]];
  return null;
}
