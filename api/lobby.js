import { db, handler, HttpError, cleanName } from './_lib/admin.js';
import { newGame, viewFor } from './_lib/engine.js';

const CAPACITY = { '1v1': 2 };

export default handler(async (uid, body) => {
  const { action } = body;

  if (action === 'ping') return {};

  if (action === 'create') {
    const name = cleanName(body.serverName, 32);
    const player = cleanName(body.name);
    const format = body.format in CAPACITY ? body.format : '1v1';
    if (!name || !player) throw new HttpError(400, 'name');
    const ref = db.collection('lobbies').doc();
    await ref.set({
      name, format, hostId: uid, status: 'waiting',
      players: [{ uid, name: player }],
      createdAt: Date.now(),
    });
    return { id: ref.id };
  }

  const ref = db.collection('lobbies').doc(String(body.id || ''));
  if (!body.id) throw new HttpError(400, 'id');

  if (action === 'join') {
    const player = cleanName(body.name);
    if (!player) throw new HttpError(400, 'name');
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, 'gone');
      const l = snap.data();
      const players = l.players.filter((p) => p.uid !== uid);
      if (players.length === l.players.length) {
        if (l.status !== 'waiting') throw new HttpError(409, 'started');
        if (players.length >= CAPACITY[l.format]) throw new HttpError(409, 'full');
      }
      tx.update(ref, { players: [...players, { uid, name: player }] });
    });
    return {};
  }

  if (action === 'leave') {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return;
      const l = snap.data();
      if (l.status !== 'waiting') return;
      if (l.hostId === uid) tx.delete(ref);
      else tx.update(ref, { players: l.players.filter((p) => p.uid !== uid) });
    });
    return {};
  }

  if (action === 'start') {
    await db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpError(404, 'gone');
      const l = snap.data();
      if (l.hostId !== uid) throw new HttpError(403, 'host');
      if (l.status !== 'waiting') throw new HttpError(409, 'started');
      if (l.players.length < CAPACITY[l.format]) throw new HttpError(409, 'players');
      const g = newGame(l.players.slice(0, CAPACITY[l.format]), Date.now());
      const gameRef = db.collection('games').doc(ref.id);
      tx.set(gameRef, g);
      g.players.forEach((pid, seat) => tx.set(gameRef.collection('views').doc(pid), viewFor(g, seat)));
      tx.update(ref, { status: 'playing' });
    });
    return {};
  }

  throw new HttpError(400, 'action');
});
