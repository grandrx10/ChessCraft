// Pure game rules shared by the client (highlighting) and the API (validation).
// Board: r 0..7 top→bottom, c 0..7. Seat 0 starts at the bottom (r 7), seat 1 at the top (r 0).

export const COST = { pawn: 1, knight: 3, bishop: 3, rook: 5, queen: 9, coin: 3, garrison: 3 };
export const SPAWNABLE = ['pawn', 'knight', 'bishop', 'rook', 'queen', 'coin', 'garrison'];
export const COOLDOWN = 3000;
export const INCOME_MS = 5000;
export const VISION = 4;
export const SPAWN_RADIUS = 2;
export const SLIDE = 4;
export const START_POINTS = 9;

const ORTH = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const KNIGHT = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];

export const dist = (a, b) => Math.max(Math.abs(a.r - b.r), Math.abs(a.c - b.c));
export const inBounds = (r, c) => r >= 0 && r < 8 && c >= 0 && c < 8;
export const forward = (seat) => (seat === 0 ? -1 : 1);
export const backRank = (seat) => (seat === 0 ? 7 : 0);
export const lastRank = (seat) => (seat === 0 ? 0 : 7);

function grid(pieces) {
  const g = new Map();
  for (const p of pieces) g.set(p.r * 8 + p.c, p);
  return g;
}

export const pieceAt = (pieces, r, c) => pieces.find((p) => p.r === r && p.c === c);

// Squares piece p may move to (pseudo-legal; check never restricts moves).
export function moves(p, pieces) {
  const g = grid(pieces);
  const out = [];
  const add = (r, c) => {
    if (!inBounds(r, c)) return false;
    const q = g.get(r * 8 + c);
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

  switch (p.type) {
    case 'rook': slide(ORTH); break;
    case 'bishop': slide(DIAG); break;
    case 'queen': slide([...ORTH, ...DIAG]); break;
    case 'king':
    case 'coin': step([...ORTH, ...DIAG]); break;
    case 'knight': step(KNIGHT); break;
    case 'pawn': {
      const f = forward(p.owner);
      const r1 = p.r + f;
      if (inBounds(r1, p.c) && !g.get(r1 * 8 + p.c)) {
        out.push({ r: r1, c: p.c });
        const r2 = r1 + f;
        if (p.dbl && inBounds(r2, p.c) && !g.get(r2 * 8 + p.c)) out.push({ r: r2, c: p.c });
      }
      for (const dc of [-1, 1]) {
        const q = inBounds(r1, p.c + dc) && g.get(r1 * 8 + p.c + dc);
        if (q && q.owner !== p.owner) out.push({ r: r1, c: p.c + dc });
      }
      break;
    }
    default: break; // garrison: stationary
  }
  return out;
}

// 64-length boolean array of squares the seat can see.
export function visibility(pieces, seat) {
  const own = pieces.filter((p) => p.owner === seat);
  const vis = new Array(64).fill(false);
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) vis[r * 8 + c] = own.some((p) => dist(p, { r, c }) <= VISION);
  }
  return vis;
}

export function spawnSquares(pieces, seat, type) {
  const anchors = pieces.filter((p) => p.owner === seat && (p.type === 'king' || p.type === 'garrison'));
  const g = grid(pieces);
  const out = [];
  for (let r = 0; r < 8; r++) {
    for (let c = 0; c < 8; c++) {
      if (g.get(r * 8 + c)) continue;
      if (type === 'pawn' && r === lastRank(seat)) continue;
      if (anchors.some((a) => dist(a, { r, c }) <= SPAWN_RADIUS)) out.push({ r, c });
    }
  }
  return out;
}

export function inCheck(pieces, seat) {
  const king = pieces.find((p) => p.owner === seat && p.type === 'king');
  if (!king) return false;
  return pieces.some((p) => p.owner !== seat && moves(p, pieces).some((m) => m.r === king.r && m.c === king.c));
}

// Income sources: king + coins, 1 point per INCOME_MS each.
export const incomeRate = (pieces, seat) =>
  pieces.filter((p) => p.owner === seat && (p.type === 'king' || p.type === 'coin')).length;

export const pointsAt = (econ, rate, now) => econ.p + (Math.max(0, now - econ.t) / INCOME_MS) * rate;
