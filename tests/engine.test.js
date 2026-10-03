import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn as rawSpawn, move, viewFor, rulesOf } from '../api/_lib/engine.js';
import {
  moves, inCheck, pointsAt, costOf, toBoard, randomStarts, boardSize, dist, START_GAP,
  COOLDOWN, KING_INCOME_MS, COIN_INCOME_MS,
} from '../shared/game.js';
import { applyPending, settled, newPieceId } from '../src/optimistic.js';

const players = (n) => Array.from({ length: n }, (_, i) => ({ uid: `u${i}`, name: `P${i}` }));
const fresh = () => newGame(players(2), 0, '1v1', () => 0); // both kings at c=0

let n = 0;
const nextId = () => `c${String(++n).padStart(10, '0')}`;
const spawn = (g, seat, a, now) => rawSpawn(g, seat, { id: nextId(), ...a }, now);
const find = (g, type) => Object.values(g.pieces).find((p) => p.type === type);
const has = (list, r, c) => list.some((m) => m.r === r && m.c === c);
const near = (a, b) => Math.abs(a - b) < 1e-9;

test('timings', () => {
  assert.equal(COOLDOWN, 7000);
  assert.equal(KING_INCOME_MS, 10000);
  assert.equal(COIN_INCOME_MS, 12000);
});

test('kings start in a back-rank corner (1v1)', () => {
  const g = fresh();
  assert.equal(g.size, 8);
  assert.deepEqual([g.pieces.k0.r, g.pieces.k0.c], [7, 0]);
  assert.deepEqual([g.pieces.k1.r, g.pieces.k1.c], [0, 0]);
});

test('spawn costs points, respects radius, starts on cooldown', () => {
  const g = fresh();
  spawn(g, 0, { type: 'rook', r: 5, c: 2 }, 0);
  assert.equal(g.econ[0].p, 4);
  const rook = find(g, 'rook');
  assert.equal(rook.readyAt, COOLDOWN);
  assert.throws(() => spawn(g, 0, { type: 'pawn', r: 4, c: 0 }, 0), /square/);
  assert.throws(() => spawn(g, 0, { type: 'queen', r: 6, c: 1 }, 0), /points/);
  assert.throws(() => move(g, 0, { pieceId: rook.id, r: 4, c: 2 }, 3000), /cooldown/);
  move(g, 0, { pieceId: rook.id, r: 4, c: 2 }, COOLDOWN);
  assert.equal(g.pieces[rook.id].mv, 1);
});

test('spawn ids must be well-formed and unique', () => {
  const g = fresh();
  assert.throws(() => rawSpawn(g, 0, { id: 'k1', type: 'pawn', r: 6, c: 1 }, 0), /id/);
  rawSpawn(g, 0, { id: 'cabcdef0123', type: 'pawn', r: 6, c: 1 }, 0);
  assert.throws(() => rawSpawn(g, 0, { id: 'cabcdef0123', type: 'pawn', r: 6, c: 2 }, 0), /id/);
});

test('income: king 1 per 10s, each coin 1 per 12s', () => {
  const g = fresh();
  spawn(g, 0, { type: 'coin', r: 6, c: 1 }, 0); // 9 - 3 = 6
  spawn(g, 0, { type: 'pawn', r: 6, c: 2 }, 60000); // +6 king +5 coin = 17, -1 => 16
  assert.ok(near(g.econ[0].p, 16));
  const v = viewFor(g, 0);
  assert.ok(near(pointsAt(v.econ, v.rate, 120000), 27));
});

test('coins move like a king but never capture', () => {
  const g = fresh();
  g.pieces.k1.r = 5; g.pieces.k1.c = 2;
  spawn(g, 0, { type: 'coin', r: 6, c: 1 }, 0);
  const coin = find(g, 'coin');
  const ms = moves(coin, Object.values(g.pieces), rulesOf(g));
  assert.ok(has(ms, 5, 1));
  assert.ok(!has(ms, 5, 2)); // enemy king: not capturable
  assert.ok(!inCheck(Object.values(g.pieces), 1, rulesOf(g)));
});

test('sliders capped at 4 squares; pawn double step only from back two ranks', () => {
  const g = fresh();
  spawn(g, 0, { type: 'rook', r: 7, c: 2 }, 0);
  const ms = moves(find(g, 'rook'), Object.values(g.pieces), rulesOf(g));
  assert.ok(has(ms, 3, 2));
  assert.ok(!has(ms, 2, 2));
  spawn(g, 0, { type: 'pawn', r: 6, c: 1 }, 0);
  const pawn = find(g, 'pawn');
  assert.ok(pawn.dbl);
  assert.ok(has(moves(pawn, Object.values(g.pieces), rulesOf(g)), 4, 1));
});

test('1v1 pawn promotes to superpawn on the last rank', () => {
  const g = fresh();
  g.pieces.k0.r = 2; g.pieces.k0.c = 4;
  g.econ[0].p = 20;
  spawn(g, 0, { type: 'pawn', r: 1, c: 4 }, 0);
  const pawn = find(g, 'pawn');
  assert.ok(!pawn.dbl);
  assert.throws(() => spawn(g, 0, { type: 'pawn', r: 0, c: 5 }, 0), /square/);
  move(g, 0, { pieceId: pawn.id, r: 0, c: 4 }, COOLDOWN);
  assert.equal(g.pieces[pawn.id].type, 'superpawn');
});

test('superpawn: one step orthogonally onto empty squares, captures one step diagonally', () => {
  const rules = { mode: '1v1', size: 8 };
  const sp = { id: 's', type: 'superpawn', owner: 0, r: 3, c: 3 };
  const pieces = [
    sp,
    { id: 'e1', type: 'rook', owner: 1, r: 2, c: 3 },
    { id: 'e2', type: 'rook', owner: 1, r: 4, c: 4 },
    { id: 'f1', type: 'rook', owner: 0, r: 2, c: 2 },
  ];
  assert.deepEqual(moves(sp, pieces, rules).map((m) => `${m.r}${m.c}`).sort(), ['32', '34', '43', '44']);
  pieces.push({ id: 'k', type: 'king', owner: 1, r: 2, c: 4 });
  assert.ok(inCheck(pieces, 1, rules));
});

test('fog hides distant enemies; capturing king ends 1v1', () => {
  const g = fresh();
  assert.equal(viewFor(g, 0).pieces.length, 1);
  g.pieces.k1.r = 4; g.pieces.k1.c = 4;
  g.econ[0].p = 20;
  spawn(g, 0, { type: 'queen', r: 6, c: 2 }, 0);
  const view = viewFor(g, 0);
  assert.equal(view.pieces.length, 3);
  assert.ok(inCheck(view.pieces, 1, rulesOf(g)));
  move(g, 0, { pieceId: find(g, 'queen').id, r: 4, c: 4 }, COOLDOWN);
  assert.equal(g.status, 'ended');
  assert.equal(g.winner, 0);
  assert.throws(() => spawn(g, 1, { type: 'pawn', r: 1, c: 1 }, COOLDOWN), /over/);
});

test('garrison extends spawn area and cannot move', () => {
  const g = fresh();
  spawn(g, 0, { type: 'garrison', r: 5, c: 2 }, 0);
  spawn(g, 0, { type: 'pawn', r: 3, c: 4 }, 0);
  assert.throws(() => move(g, 0, { pieceId: find(g, 'garrison').id, r: 4, c: 2 }, 9000), /illegal/);
});

// ---------- FFA ----------

test('FFA board grows by one per player beyond 2', () => {
  assert.equal(boardSize('1v1', 2), 8);
  assert.equal(boardSize('FFA', 2), 8);
  assert.equal(boardSize('FFA', 3), 9);
  assert.equal(boardSize('FFA', 8), 14);
  assert.equal(newGame(players(5), 0, 'FFA').size, 11);
});

const assertSpread = (s, k, size) => {
  assert.equal(s.length, k);
  for (const p of s) assert.ok(p.r >= 0 && p.c >= 0 && p.r < size && p.c < size);
  for (let i = 0; i < k; i++) {
    for (let j = i + 1; j < k; j++) assert.ok(dist(s[i], s[j]) >= START_GAP, `k=${k}`);
  }
};

test('FFA kings start at random squares, every pair at least 5 apart', () => {
  let interior = 0;
  for (let k = 2; k <= 8; k++) {
    const size = boardSize('FFA', k);
    for (let trial = 0; trial < 50; trial++) {
      const s = randomStarts(k, size);
      assertSpread(s, k, size);
      interior += s.filter((p) => p.r > 0 && p.c > 0 && p.r < size - 1 && p.c < size - 1).length;
    }
  }
  assert.ok(interior > 0, 'kings are not limited to the edge');
});

test('FFA start fallback still satisfies the gap when random placement keeps failing', () => {
  for (let k = 2; k <= 8; k++) {
    const size = boardSize('FFA', k);
    assertSpread(randomStarts(k, size, () => 0), k, size); // every random pick collides
  }
});

test('FFA orientation is the same for every player', () => {
  const g = newGame(players(6), 0, 'FFA');
  assert.ok(g.homes.every((h) => h === 0));
  assert.ok(g.players.every((_, s) => viewFor(g, s).home === 0));
  // 1v1 still flips the top player's view.
  assert.deepEqual(fresh().homes, [0, 2]);
});

test('rotation puts each player\'s home edge at the bottom', () => {
  const size = 10, m = size - 1;
  const bottomRow = (home) => Array.from({ length: size }, (_, dc) => toBoard(m, dc, home, size));
  assert.ok(bottomRow(0).every((p) => p.r === m));
  assert.ok(bottomRow(1).every((p) => p.c === 0));
  assert.ok(bottomRow(2).every((p) => p.r === 0));
  assert.ok(bottomRow(3).every((p) => p.c === m));
  // Bijective for every orientation.
  for (let h = 0; h < 4; h++) {
    const seen = new Set();
    for (let dr = 0; dr < size; dr++) for (let dc = 0; dc < size; dc++) {
      const { r, c } = toBoard(dr, dc, h, size);
      seen.add(r * size + c);
    }
    assert.equal(seen.size, size * size);
  }
});

test('FFA pawns cost 2, step orthogonally, capture diagonally, never promote', () => {
  assert.equal(costOf('pawn', 'FFA'), 2);
  assert.equal(costOf('pawn', '1v1'), 1);
  const g = newGame(players(3), 0, 'FFA');
  const rules = rulesOf(g);
  const king = g.pieces.k0;
  Object.assign(king, { r: 4, c: 4 });
  for (const k of ['k1', 'k2']) Object.assign(g.pieces[k], { r: 0, c: k === 'k1' ? 0 : 8 });
  spawn(g, 0, { type: 'pawn', r: 3, c: 4 }, 0);
  assert.ok(near(g.econ[0].p, 7));
  const pawn = find(g, 'pawn');
  g.pieces.e = { id: 'e', type: 'rook', owner: 1, r: 2, c: 5 };
  assert.deepEqual(moves(pawn, Object.values(g.pieces), rules).map((m) => `${m.r}${m.c}`).sort(), ['25', '24', '33', '35'].sort());
  assert.ok(!pawn.dbl);
  // Walking onto an edge doesn't promote.
  Object.assign(g.pieces[pawn.id], { r: 1, c: 4, readyAt: 0 });
  move(g, 0, { pieceId: pawn.id, r: 0, c: 4 }, 1);
  assert.equal(g.pieces[pawn.id].type, 'pawn');
});

test('FFA elimination removes the player\'s pieces; last king standing wins', () => {
  const g = newGame(players(3), 0, 'FFA');
  Object.assign(g.pieces.k0, { r: 4, c: 4, readyAt: 0 });
  Object.assign(g.pieces.k1, { r: 4, c: 5 });
  Object.assign(g.pieces.k2, { r: 0, c: 0, readyAt: 0 });
  g.pieces.x = { id: 'x', type: 'rook', owner: 1, r: 8, c: 8, mv: 0, readyAt: 0 };

  move(g, 0, { pieceId: 'k0', r: 4, c: 5 }, 1);
  assert.deepEqual(g.alive, [true, false, true]);
  assert.ok(!g.pieces.x, 'eliminated player\'s pieces are removed');
  assert.equal(g.status, 'playing');
  assert.throws(() => spawn(g, 1, { type: 'pawn', r: 4, c: 4 }, 2), /out/);

  // The eliminated player spectates: sees everything.
  const v1 = viewFor(g, 1);
  assert.equal(v1.pieces.length, Object.keys(g.pieces).length);
  assert.equal(viewFor(g, 2).pieces.length, 1); // others still have fog

  Object.assign(g.pieces.k2, { r: 3, c: 5 });
  g.pieces.k0.readyAt = 0;
  move(g, 0, { pieceId: 'k0', r: 3, c: 5 }, 2);
  assert.equal(g.status, 'ended');
  assert.equal(g.winner, 0);
});

test('optimistic spawn + move match the server result, then settle', () => {
  const g = fresh();
  spawn(g, 0, { type: 'knight', r: 6, c: 2 }, 0);
  const knight = find(g, 'knight');
  const base = viewFor(g, 0);

  const sp = { kind: 'spawn', pieceId: newPieceId(), type: 'pawn', r: 6, c: 1, at: 100 };
  const mv = { kind: 'move', pieceId: knight.id, mv: 1, r: 4, c: 3, at: COOLDOWN };
  const local = applyPending(base, [sp, mv]);
  assert.ok(local.pieces.some((p) => p.id === sp.pieceId && p.readyAt === 100 + COOLDOWN));
  assert.ok(local.pieces.some((p) => p.id === knight.id && p.r === 4 && p.c === 3 && p.mv === 1));
  assert.equal(Math.floor(pointsAt(local.econ, local.rate, 100) + 1e-9), 5);

  rawSpawn(g, 0, { id: sp.pieceId, type: 'pawn', r: 6, c: 1 }, 150);
  move(g, 0, { pieceId: knight.id, r: 4, c: 3 }, COOLDOWN + 50);
  const confirmed = viewFor(g, 0);
  assert.ok(settled(confirmed.pieces, sp) && settled(confirmed.pieces, mv));
  assert.deepEqual(applyPending(confirmed, [sp, mv]).pieces, confirmed.pieces);
  assert.deepEqual(applyPending(base, []).pieces, base.pieces);
});

test('optimistic FFA pawn spawn charges 2', () => {
  const g = newGame(players(3), 0, 'FFA', () => 0);
  const v = viewFor(g, 0);
  const k = g.pieces.k0;
  const r = k.r === 0 ? 1 : k.r - 1 >= 0 && k.r === g.size - 1 ? k.r - 1 : k.r;
  const c = k.c === 0 ? 1 : k.c === g.size - 1 ? k.c - 1 : k.c;
  const local = applyPending(v, [{ kind: 'spawn', pieceId: newPieceId(), type: 'pawn', r, c, at: 0 }]);
  assert.ok(near(local.econ.p, 7));
});
