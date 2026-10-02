import { db, handler, HttpError } from './_lib/admin.js';
import { move, spawn, viewFor } from './_lib/engine.js';

export default handler(async (uid, body) => {
  const { action, id } = body;
  if (!id) throw new HttpError(400, 'id');
  const gameRef = db.collection('games').doc(String(id));
  const lobbyRef = db.collection('lobbies').doc(String(id));
  const r = Number(body.r);
  const c = Number(body.c);

  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpError(404, 'gone');
    const g = snap.data();
    const seat = g.players.indexOf(uid);
    if (seat < 0) throw new HttpError(403, 'player');
    const now = Date.now();

    if (action === 'move') move(g, seat, { pieceId: String(body.pieceId), r, c }, now);
    else if (action === 'spawn') spawn(g, seat, { id: body.pieceId, type: String(body.type), r, c }, now);
    else throw new HttpError(400, 'action');

    tx.set(gameRef, g);
    g.players.forEach((pid, s) => tx.set(gameRef.collection('views').doc(pid), viewFor(g, s)));
    if (g.status === 'ended') tx.update(lobbyRef, { status: 'ended' });
  });
  return {};
});
