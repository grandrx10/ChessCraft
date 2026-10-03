// Server-authoritative game mutations. Pure functions over a plain game object.
import {
  START_POINTS, costOf, boardSize, perimeterStarts,
  moves, spawnSquares, incomeRate, visibility, backRank, makePiece, resolveMove, validPieceId,
} from '../../shared/game.js';

export class RuleError extends Error {
  constructor(msg) { super(msg); this.status = 400; }
}

// Client clocks run up to ~one-way latency ahead of the server's view of an action.
const COOLDOWN_SLACK = 250;

const list = (g) => Object.values(g.pieces);
export const rulesOf = (g) => ({ mode: g.mode || '1v1', size: g.size || 8 });

export function newGame(players, now, mode = '1v1', rand = Math.random) {
  const n = players.length;
  const size = boardSize(mode, n);
  let starts;
  if (mode === 'FFA') {
    // Shuffle who gets which slot so seating isn't join order.
    const slots = perimeterStarts(n, size, rand);
    for (let i = slots.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [slots[i], slots[j]] = [slots[j], slots[i]];
    }
    starts = slots;
  } else {
    starts = players.map((_, seat) => ({
      r: backRank(seat, size), c: rand() < 0.5 ? 0 : size - 1, home: seat === 0 ? 0 : 2,
    }));
  }
  const pieces = {};
  starts.forEach(({ r, c }, seat) => {
    const id = `k${seat}`;
    pieces[id] = { id, type: 'king', owner: seat, r, c, readyAt: now, mv: 0 };
  });
  return {
    mode,
    size,
    players: players.map((p) => p.uid),
    names: players.map((p) => p.name),
    homes: starts.map((s) => s.home),
    alive: players.map(() => true),
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
    e.p += Math.max(0, now - e.t) * incomeRate(ps, seat);
    e.t = now;
  });
}

function checkActive(g, seat) {
  if (g.status !== 'playing') throw new RuleError('over');
  if (g.alive && !g.alive[seat]) throw new RuleError('out');
}

export function spawn(g, seat, { id, type, r, c }, now) {
  checkActive(g, seat);
  const rules = rulesOf(g);
  const cost = costOf(type, rules.mode);
  if (!cost) throw new RuleError('type');
  if (!validPieceId(id) || g.pieces[id]) throw new RuleError('id');
  settle(g, now);
  if (g.econ[seat].p < cost) throw new RuleError('points');
  if (!spawnSquares(list(g), seat, type, rules).some((s) => s.r === r && s.c === c)) throw new RuleError('square');
  g.econ[seat].p -= cost;
  g.pieces[id] = makePiece(id, type, seat, r, c, now, rules);
}

export function move(g, seat, { pieceId, r, c }, now) {
  checkActive(g, seat);
  const rules = rulesOf(g);
  const p = g.pieces[pieceId];
  if (!p || p.owner !== seat) throw new RuleError('piece');
  if (now < p.readyAt - COOLDOWN_SLACK) throw new RuleError('cooldown');
  const ps = list(g);
  if (!moves(p, ps, rules).some((m) => m.r === r && m.c === c)) throw new RuleError('illegal');
  settle(g, now);
  const { moved, target } = resolveMove(ps, p, r, c, now, rules);
  if (target) delete g.pieces[target.id];
  g.pieces[p.id] = moved;
  if (target?.type === 'king') eliminate(g, target.owner);
}

// A captured king removes its owner and all their pieces; the last king standing wins.
function eliminate(g, seat) {
  if (!g.alive) g.alive = g.players.map(() => true);
  g.alive[seat] = false;
  for (const p of list(g)) if (p.owner === seat) delete g.pieces[p.id];
  const left = g.alive.flatMap((a, s) => (a ? [s] : []));
  if (left.length <= 1) {
    g.status = 'ended';
    g.winner = left[0] ?? null;
  }
}

// What one seat is allowed to see. Eliminated players and finished games see everything.
export function viewFor(g, seat) {
  const ps = list(g);
  const { mode, size } = rulesOf(g);
  const alive = g.alive || g.players.map(() => true);
  const all = g.status === 'ended' || !alive[seat];
  const vis = all ? null : visibility(ps, seat, size);
  return {
    seat,
    mode,
    size,
    home: (g.homes || [0, 2])[seat],
    names: g.names,
    alive,
    pieces: all ? ps : ps.filter((p) => p.owner === seat || vis[p.r * size + p.c]),
    econ: g.econ[seat],
    rate: incomeRate(ps, seat),
    status: g.status,
    winner: g.winner,
    ver: g.ver || 0,
  };
}
