"use strict";
importScripts("rules.js");

const values = {P:100,L:300,N:320,S:450,G:550,B:850,R:1000,K:0};

function evaluate(position, owner) {
  let score = 0;
  for (const piece of position.board.values()) {
    const value = piece.promoted
      ? (piece.kind === "B" || piece.kind === "R" ? values[piece.kind] + 250 : 550)
      : values[piece.kind];
    score += piece.owner === owner ? value : -value;
  }
  for (const side of ["b","w"]) {
    for (const kind of Object.keys(values)) {
      score += (side === owner ? 1 : -1) * values[kind] * (position.hands[side][kind] || 0);
    }
  }
  return score;
}

self.onmessage = ({data}) => {
  try {
    const position = Position.fromSfen(data.sfen);
    const owner = position.turn;
    const depth = data.depth === 2 ? 2 : 1;
    const candidates = position.legalMoves().map(move => {
      const after = position.clone();
      after.applyUsi(move);
      let score = evaluate(after, owner);
      let reply = null;
      if (depth === 2) {
        for (const response of after.legalMoves()) {
          const leaf = after.clone();
          leaf.applyUsi(response);
          const value = evaluate(leaf, owner);
          if (reply === null || value < score) { score = value; reply = response; }
        }
        if (reply === null) score = 30000;
      }
      return {depth, score:{kind:"cp", value:score}, pv:reply ? [move, reply] : [move]};
    });
    candidates.sort((a,b) => b.score.value - a.score.value || a.pv[0].localeCompare(b.pv[0]));
    const list = candidates.slice(0,data.count).map((candidate,i) => ({...candidate,multipv:i+1}));
    self.postMessage({best:list.length ? list[0].pv[0] : "resign",list});
  } catch (error) {
    self.postMessage({error:error.message});
  }
};
