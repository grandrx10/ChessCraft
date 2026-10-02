// Server-authoritative game mutations. Pure functions over a plain game object.
import {
  COST, START_POINTS, INCOME_MS,
  moves, spawnSquares, incomeRate, visibility, backRank, makePiece, resolveMove, validPieceId,
} from '../../shared/game.js';

export class RuleError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

// Client clocks run up to ~one-way latency ahead of the server's view of an action.
const COOLDOWN_SLACK = 250;

const list = (g) => Object.values(g.pieces);

export function newGame(players, now, rand = Math.random) {
  const pieces = {};
  players.forEach((_, seat) => {
    const id = `k${seat}`;
    pieces[id] = { id, type: 'king', owner: seat, r: backRank(seat), c: rand() < 0.5 ? 0 : 7, readyAt: now, mv: 0 };
  });
  return {
    players: players.map((p) => p.uid),
    names: players.map((p) => p.name),
    pieces,
    econ: players.map(() => ({ p: START_POINTS, t: now })),
    status: 'playing',
    winner: null,
    startedAt: now,
  };
}

// Bank accrued income for every seat at the current piece set.
function settle(g, now) {
  const ps = list(g);
  g.econ.forEach((e, seat) => {
    e.p += (Math.max(0, now - e.t) / INCOME_MS) * incomeRate(ps, seat);
    e.t = now;
  });
}

export function spawn(g, seat, { id, type, r, c }, now) {
  if (g.status !== 'playing') throw new RuleError('over');
  if (!(type in COST)) throw new RuleError('type');
  if (!validPieceId(id) || g.pieces[id]) throw new RuleError('id');
  settle(g, now);
  if (g.econ[seat].p < COST[type]) throw new RuleError('points');
  if (!spawnSquares(list(g), seat, type).some((s) => s.r === r && s.c === c)) throw new RuleError('square');
  g.econ[seat].p -= COST[type];
  g.pieces[id] = makePiece(id, type, seat, r, c, now);
}

export function move(g, seat, { pieceId, r, c }, now) {
  if (g.status !== 'playing') throw new RuleError('over');
  const p = g.pieces[pieceId];
  if (!p || p.owner !== seat) throw new RuleError('piece');
  if (now < p.readyAt - COOLDOWN_SLACK) throw new RuleError('cooldown');
  const ps = list(g);
  if (!moves(p, ps).some((m) => m.r === r && m.c === c)) throw new RuleError('illegal');
  settle(g, now);
  const { moved, target } = resolveMove(ps, p, r, c, now);
  if (target) {
    delete g.pieces[target.id];
    if (target.type === 'king') { g.status = 'ended'; g.winner = seat; }
  }
  g.pieces[p.id] = moved;
}

// What one seat is allowed to see. Everything is revealed once the game ends.
export function viewFor(g, seat) {
  const ps = list(g);
  const vis = visibility(ps, seat);
  const shown = g.status === 'ended' ? ps : ps.filter((p) => p.owner === seat || vis[p.r * 8 + p.c]);
  return {
    seat,
    names: g.names,
    pieces: shown,
    econ: g.econ[seat],
    rate: incomeRate(ps, seat),
    status: g.status,
    winner: g.winner,
  };
}
