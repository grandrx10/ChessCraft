import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn as rawSpawn, move, viewFor } from '../api/_lib/engine.js';
import { moves, inCheck, pointsAt, COOLDOWN, INCOME_MS } from '../shared/game.js';
import { applyPending, settled, newPieceId } from '../src/optimistic.js';

const players = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }];
const fresh = () => newGame(players, 0, () => 0); // both kings at c=0

let n = 0;
const nextId = () => `c${String(++n).padStart(10, '0')}`;
const spawn = (g, seat, a, now) => rawSpawn(g, seat, { id: nextId(), ...a }, now);
const find = (g, type) => Object.values(g.pieces).find((p) => p.type === type);
const has = (list, r, c) => list.some((m) => m.r === r && m.c === c);

test('timings', () => {
  assert.equal(COOLDOWN, 5000);
  assert.equal(INCOME_MS, 10000);
});

test('kings start in a back-rank corner', () => {
  const g = fresh();
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

test('income: king + coins, 1 per 10s each', () => {
  const g = fresh();
  spawn(g, 0, { type: 'coin', r: 6, c: 1 }, 0); // 6 left, rate 2
  spawn(g, 0, { type: 'pawn', r: 6, c: 2 }, INCOME_MS); // +2 => 8, -1 => 7
  assert.ok(Math.abs(g.econ[0].p - 7) < 1e-9);
  const v = viewFor(g, 0);
  assert.equal(v.rate, 2);
  assert.ok(Math.abs(pointsAt(v.econ, v.rate, 2 * INCOME_MS) - 9) < 1e-9);
});

test('sliders capped at 4 squares; pawn double step only from back two ranks', () => {
  const g = fresh();
  spawn(g, 0, { type: 'rook', r: 7, c: 2 }, 0);
  const ms = moves(find(g, 'rook'), Object.values(g.pieces));
  assert.ok(has(ms, 3, 2));
  assert.ok(!has(ms, 2, 2));
  spawn(g, 0, { type: 'pawn', r: 6, c: 1 }, 0);
  const pawn = find(g, 'pawn');
  assert.ok(pawn.dbl);
  assert.ok(has(moves(pawn, Object.values(g.pieces)), 4, 1));
});

test('pawn far from back ranks has no double step; promotes on last rank', () => {
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
  const sp = { id: 's', type: 'superpawn', owner: 0, r: 3, c: 3 };
  const pieces = [
    sp,
    { id: 'e1', type: 'rook', owner: 1, r: 2, c: 3 }, // directly above: blocks, not capturable
    { id: 'e2', type: 'rook', owner: 1, r: 4, c: 4 }, // diagonal: capturable
    { id: 'f1', type: 'rook', owner: 0, r: 2, c: 2 }, // own piece diagonal: not capturable
  ];
  const ms = moves(sp, pieces);
  assert.deepEqual(
    ms.map((m) => `${m.r}${m.c}`).sort(),
    ['32', '34', '43', '44'],
  );
  // Gives check like any attacker.
  pieces.push({ id: 'k', type: 'king', owner: 1, r: 2, c: 4 });
  assert.ok(inCheck(pieces, 1));
});

test('fog hides distant enemies; capturing king ends game', () => {
  const g = fresh();
  assert.equal(viewFor(g, 0).pieces.length, 1);
  g.pieces.k1.r = 4; g.pieces.k1.c = 4;
  g.econ[0].p = 20;
  spawn(g, 0, { type: 'queen', r: 6, c: 2 }, 0);
  const view = viewFor(g, 0);
  assert.equal(view.pieces.length, 3);
  assert.ok(inCheck(view.pieces, 1));
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

  // Server applies the same actions; the confirmed view settles both, so nothing is double-applied.
  rawSpawn(g, 0, { id: sp.pieceId, type: 'pawn', r: 6, c: 1 }, 150);
  move(g, 0, { pieceId: knight.id, r: 4, c: 3 }, COOLDOWN + 50);
  const confirmed = viewFor(g, 0);
  assert.ok(settled(confirmed.pieces, sp) && settled(confirmed.pieces, mv));
  assert.deepEqual(applyPending(confirmed, [sp, mv]).pieces, confirmed.pieces);

  // Rejected actions roll back by simply being removed from pending.
  assert.deepEqual(applyPending(base, []).pieces, base.pieces);
});
