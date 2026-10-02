import test from 'node:test';
import assert from 'node:assert/strict';
import { newGame, spawn, move, viewFor } from '../api/_lib/engine.js';
import { moves, inCheck, pointsAt } from '../shared/game.js';

const players = [{ uid: 'a', name: 'A' }, { uid: 'b', name: 'B' }];
const fresh = () => newGame(players, 0, () => 0); // both kings at c=0

const has = (list, r, c) => list.some((m) => m.r === r && m.c === c);

test('kings start in a back-rank corner', () => {
  const g = fresh();
  assert.deepEqual([g.pieces.k0.r, g.pieces.k0.c], [7, 0]);
  assert.deepEqual([g.pieces.k1.r, g.pieces.k1.c], [0, 0]);
});

test('spawn costs points, respects radius, starts on cooldown', () => {
  const g = fresh();
  spawn(g, 0, { type: 'rook', r: 5, c: 2 }, 0);
  assert.equal(g.econ[0].p, 4);
  const rook = Object.values(g.pieces).find((p) => p.type === 'rook');
  assert.equal(rook.readyAt, 3000);
  assert.throws(() => spawn(g, 0, { type: 'pawn', r: 4, c: 0 }, 0), /square/);
  assert.throws(() => spawn(g, 0, { type: 'queen', r: 6, c: 1 }, 0), /points/);
  assert.throws(() => move(g, 0, { pieceId: rook.id, r: 4, c: 2 }, 1000), /cooldown/);
  move(g, 0, { pieceId: rook.id, r: 4, c: 2 }, 3000);
});

test('income: king + coins, 1 per 5s each', () => {
  const g = fresh();
  spawn(g, 0, { type: 'coin', r: 6, c: 1 }, 0); // 6 left, rate 2
  spawn(g, 0, { type: 'pawn', r: 6, c: 2 }, 5000); // +2 => 8, -1 => 7
  assert.ok(Math.abs(g.econ[0].p - 7) < 1e-9);
  const v = viewFor(g, 0);
  assert.equal(v.rate, 2);
  assert.ok(Math.abs(pointsAt(v.econ, v.rate, 10000) - 9) < 1e-9);
});

test('sliders capped at 4 squares; pawn double step only from back two ranks', () => {
  const g = fresh();
  spawn(g, 0, { type: 'rook', r: 7, c: 2 }, 0);
  const rook = Object.values(g.pieces).find((p) => p.type === 'rook');
  const ms = moves(rook, Object.values(g.pieces));
  assert.ok(has(ms, 3, 2));
  assert.ok(!has(ms, 2, 2));
  spawn(g, 0, { type: 'pawn', r: 6, c: 1 }, 0);
  const pawn = Object.values(g.pieces).find((p) => p.type === 'pawn');
  assert.ok(pawn.dbl);
  assert.ok(has(moves(pawn, Object.values(g.pieces)), 4, 1));
});

test('pawn far from back ranks has no double step; promotes on last rank', () => {
  const g = fresh();
  g.pieces.k0.r = 2; g.pieces.k0.c = 4;
  g.econ[0].p = 20;
  spawn(g, 0, { type: 'pawn', r: 1, c: 4 }, 0);
  const pawn = Object.values(g.pieces).find((p) => p.type === 'pawn');
  assert.ok(!pawn.dbl);
  assert.throws(() => spawn(g, 0, { type: 'pawn', r: 0, c: 5 }, 0), /square/);
  move(g, 0, { pieceId: pawn.id, r: 0, c: 4 }, 3000);
  assert.equal(pawn.type, 'queen');
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
  const q = Object.values(g.pieces).find((p) => p.type === 'queen');
  move(g, 0, { pieceId: q.id, r: 4, c: 4 }, 3000);
  assert.equal(g.status, 'ended');
  assert.equal(g.winner, 0);
  assert.throws(() => spawn(g, 1, { type: 'pawn', r: 1, c: 1 }, 3000), /over/);
});

test('garrison extends spawn area and cannot move', () => {
  const g = fresh();
  spawn(g, 0, { type: 'garrison', r: 5, c: 2 }, 0);
  const gar = Object.values(g.pieces).find((p) => p.type === 'garrison');
  spawn(g, 0, { type: 'pawn', r: 3, c: 4 }, 0);
  assert.throws(() => move(g, 0, { pieceId: gar.id, r: 4, c: 2 }, 5000), /illegal/);
});
