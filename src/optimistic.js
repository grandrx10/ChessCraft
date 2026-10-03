// Optimistic actions: applied locally on top of the server view until the server
// confirms them (they show up in a snapshot) or rejects them (they're dropped = rollback).
import { costOf, pieceAt, resolveMove, makePiece, pointsAt, incomeRate } from '../shared/game.js';

export function newPieceId() {
  const bytes = crypto.getRandomValues(new Uint8Array(5));
  return `c${Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')}`;
}

// True once the action is reflected in (or made moot by) the given pieces.
export function settled(pieces, a) {
  if (a.kind === 'spawn') return pieces.some((p) => p.id === a.pieceId);
  const p = pieces.find((x) => x.id === a.pieceId);
  return !p || (p.mv || 0) >= a.mv;
}

export const rulesOfView = (view) => ({ mode: view.mode || '1v1', size: view.size || 8 });

export function applyPending(view, pending) {
  const rules = rulesOfView(view);
  let { pieces, econ } = view;
  for (const a of pending) {
    if (settled(pieces, a)) continue;
    if (a.kind === 'move') {
      const p = pieces.find((x) => x.id === a.pieceId);
      const { moved, target } = resolveMove(pieces, p, a.r, a.c, a.at, rules);
      pieces = pieces.filter((x) => x !== p && x !== target).concat(moved);
    } else {
      if (pieceAt(pieces, a.r, a.c)) continue;
      const t = Math.max(econ.t, a.at);
      econ = { p: pointsAt(econ, incomeRate(pieces, view.seat), t) - costOf(a.type, rules.mode), t };
      pieces = pieces.concat(makePiece(a.pieceId, a.type, view.seat, a.r, a.c, a.at, rules));
    }
  }
  return { ...view, pieces, econ, rate: incomeRate(pieces, view.seat) };
}
