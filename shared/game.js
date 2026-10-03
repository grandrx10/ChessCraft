// Pure game rules shared by the client (highlighting) and the API (validation).
// Board: r 0..size-1 top→bottom, c 0..size-1. `rules` = { mode: '1v1' | 'FFA', size }.
// 1v1: seat 0 starts at the bottom, seat 1 at the top; pawns move forward and promote.
// FFA: kings start spread around the edge; pawns have no direction (step orthogonally, capture diagonally).

export const MODES = { '1v1': { max: 2 }, FFA: { max: 8 } };
export const MIN_PLAYERS = 2;
export const boardSize = (mode, players) => (mode === 'FFA' ? 6 + players : 8);

const BASE_COST = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, coin: 3, garrison: 3 };
export const costOf = (type, mode) => (type === 'pawn' && mode === 'FFA' ? 2 : BASE_COST[type]);
export const SPAWNABLE = Object.keys(BASE_COST);

export const COOLDOWN = 7000;
export const KING_INCOME_MS = 10000;
export const COIN_INCOME_MS = 12000;
export const VISION = 4;
export const SPAWN_RADIUS = 2;
export const SLIDE = 4;
export const START_POINTS = 9;

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

export const dist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
const inBounds = (size, r, c) => r >= 0 && r < size && c >= 0 && c < size;

// 1v1 pawn direction helpers.
export const forward = (seat) => (seat === 0 ? -1 : 1);
export const backRank = (seat, size) => (seat === 0 ? size - 1 : 0);
export const lastRank = (seat, size) => (seat === 0 ? 0 : size - 1);

export const pieceAt = (pieces, r, c) => pieces.find((p) => p.r === r && p.c === c);

// Squares piece p may move to (pseudo-legal; check never restricts moves).
export function moves(p, pieces, { mode, size }) {
  const occ = new Map();
  for (const q of pieces) occ.set(q.r * size + q.c, q);
  const at = (r, c) => occ.get(r * size + c);
  const out = [];
  const add = (r, c) => {
    if (!inBounds(size, r, c)) return false;
    const q = at(r, c);
    if (!q) { out.push({ r, c }); return true; }
    if (q.owner !== p.owner) out.push({ r, c });
    return false;
  };
  const slide = (dirs) => {
    for (const [dr, dc] of dirs) {
      for (let i = 1; i <= SLIDE; i++) if (!add(p.r + dr * i, p.c + dc * i)) break;
    }
  };
  const step = (dirs) => { for (const [dr, dc] of dirs) add(p.r + dr, p.c + dc); };
  const stepEmpty = (dirs) => {
    for (const [dr, dc] of dirs) {
      const r = p.r + dr, c = p.c + dc;
      if (inBounds(size, r, c) && !at(r, c)) out.push({ r, c });
    }
  };
  const captureOnly = (dirs) => {
    for (const [dr, dc] of dirs) {
      const r = p.r + dr, c = p.c + dc;
      const q = inBounds(size, r, c) && at(r, c);
      if (q && q.owner !== p.owner) out.push({ r, c });
    }
  };

  switch (p.type) {
    case 'rook': slide(ORTH); break;
    case 'bishop': slide(DIAG); break;
    case 'queen': slide([...ORTH, ...DIAG]); break;
    case 'king': step([...ORTH, ...DIAG]); break;
    case 'coin': stepEmpty([...ORTH, ...DIAG]); break; // moves like a king, never captures
    case 'knight': step(KNIGHT); break;
    case 'pawn':
      if (mode === 'FFA') { stepEmpty(ORTH); captureOnly(DIAG); break; }
      {
        const f = forward(p.owner);
        const r1 = p.r + f;
        if (inBounds(size, r1, p.c) && !at(r1, p.c)) {
          out.push({ r: r1, c: p.c });
          const r2 = r1 + f;
          if (p.dbl && inBounds(size, r2, p.c) && !at(r2, p.c)) out.push({ r: r2, c: p.c });
        }
        captureOnly([[f, -1], [f, 1]]);
      }
      break;
    case 'superpawn': stepEmpty(ORTH); captureOnly(DIAG); break;
    default: break; // garrison: stationary
  }
  return out;
}

// size*size boolean array of squares the seat can see.
export function visibility(pieces, seat, size) {
  const own = pieces.filter((p) => p.owner === seat);
  const vis = new Array(size * size).fill(false);
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) vis[r * size + c] = own.some((p) => dist(p, { r, c }) <= VISION);
  }
  return vis;
}

export function spawnSquares(pieces, seat, type, { mode, size }) {
  const anchors = pieces.filter((p) => p.owner === seat && (p.type === 'king' || p.type === 'garrison'));
  const out = [];
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (pieceAt(pieces, r, c)) continue;
      if (type === 'pawn' && mode === '1v1' && r === lastRank(seat, size)) continue;
      if (anchors.some((a) => dist(a, { r, c }) <= SPAWN_RADIUS)) out.push({ r, c });
    }
  }
  return out;
}

export function inCheck(pieces, seat, rules) {
  const king = pieces.find((p) => p.owner === seat && p.type === 'king');
  if (!king) return false;
  return pieces.some((p) => p.owner !== seat && moves(p, pieces, rules).some((m) => m.r === king.r && m.c === king.c));
}

// Client-chosen piece ids, so optimistic spawns and confirmed spawns share an id.
export const validPieceId = (id) => typeof id === 'string' && /^c[a-z0-9]{8,12}$/.test(id);

export function makePiece(id, type, seat, r, c, now, { mode, size }) {
  const piece = { id, type, owner: seat, r, c, readyAt: now + COOLDOWN, mv: 0 };
  if (type === 'pawn' && mode === '1v1' && (r === backRank(seat, size) || r === backRank(seat, size) + forward(seat))) {
    piece.dbl = true;
  }
  return piece;
}

// Result of moving p to (r, c): the moved piece and whatever it captured.
export function resolveMove(pieces, p, r, c, now, { mode, size }) {
  const target = pieceAt(pieces, r, c);
  const moved = { ...p, r, c, readyAt: now + COOLDOWN, mv: (p.mv || 0) + 1 };
  delete moved.dbl;
  if (moved.type === 'pawn' && mode === '1v1' && r === lastRank(p.owner, size)) moved.type = 'superpawn';
  return { moved, target };
}

// Points per millisecond: each king 1 per KING_INCOME_MS, each coin 1 per COIN_INCOME_MS.
export function incomeRate(pieces, seat) {
  let rate = 0;
  for (const p of pieces) {
    if (p.owner !== seat) continue;
    if (p.type === 'king') rate += 1 / KING_INCOME_MS;
    else if (p.type === 'coin') rate += 1 / COIN_INCOME_MS;
  }
  return rate;
}

export const pointsAt = (econ, rate, now) => econ.p + Math.max(0, now - econ.t) * rate;

export const START_GAP = 5;

// FFA starts: kings anywhere on the board, every pair at least START_GAP apart (same metric as vision).
// Random placement with restarts; a fixed lattice is the fallback, which always fits (one king per
// START_GAP×START_GAP block, and the board has at least as many blocks as players).
export function randomStarts(n, size, rand = Math.random) {
  const cell = () => ({ r: Math.floor(rand() * size), c: Math.floor(rand() * size) });
  for (let attempt = 0; attempt < 200; attempt++) {
    const placed = [];
    for (let tries = 0; placed.length < n && tries < 500; tries++) {
      const p = cell();
      if (placed.every((q) => dist(p, q) >= START_GAP)) placed.push(p);
    }
    if (placed.length === n) return placed;
  }
  const lattice = [];
  for (let r = 0; r < size; r += START_GAP) for (let c = 0; c < size; c += START_GAP) lattice.push({ r, c });
  for (let i = lattice.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [lattice[i], lattice[j]] = [lattice[j], lattice[i]];
  }
  return lattice.slice(0, n);
}

// Maps a display cell (dr, dc) to a board cell for a viewer whose home edge is shown at the bottom.
export function toBoard(dr, dc, home, size) {
  const m = size - 1;
  switch (home) {
    case 1: return { r: dc, c: m - dr }; // left edge at the bottom
    case 2: return { r: m - dr, c: m - dc }; // top edge at the bottom
    case 3: return { r: m - dc, c: dr }; // right edge at the bottom
    default: return { r: dr, c: dc };
  }
}

export const FFA_COLORS = ['#e5484d', '#3b82f6', '#22c55e', '#facc15', '#a855f7', '#f97316', '#14b8a6', '#ec4899'];
// 'white' / 'black' use the stock piece art; anything else is a fill colour.
export const seatColor = (mode, seat) => (mode === 'FFA' ? FFA_COLORS[seat] : seat === 0 ? 'white' : 'black');
