import { db, handler, HttpError } from './_lib/admin.js';
import { move, spawn, viewFor, RuleError } from './_lib/engine.js';

// Every response carries the caller's current view (with its version), accepted or rejected,
// so the client never has to wait on the Firestore listener to learn the truth.
export default handler(async (uid, body) => {
  const { action, id } = body;
  if (!id) throw new HttpError(400, 'id');
  if (action !== 'move' && action !== 'spawn') throw new HttpError(400, 'action');
  const gameRef = db.collection('games').doc(String(id));
  const lobbyRef = db.collection('lobbies').doc(String(id));
  const r = Number(body.r);
  const c = Number(body.c);

  let out;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(gameRef);
    if (!snap.exists) throw new HttpError(404, 'gone');
    const g = snap.data();
    const seat = g.players.indexOf(uid);
    if (seat < 0) throw new HttpError(403, 'player');
    const now = Date.now();

    try {
      if (action === 'move') move(g, seat, { pieceId: String(body.pieceId), r, c }, now);
      else spawn(g, seat, { id: body.pieceId, type: String(body.type), r, c }, now);
    } catch (e) {
      if (!(e instanceof RuleError)) throw e;
      out = { rejected: e.message, view: viewFor(g, seat) };
      return;
    }

    g.ver = (g.ver || 0) + 1;
    tx.set(gameRef, g);
    g.players.forEach((pid, s) => tx.set(gameRef.collection('views').doc(pid), viewFor(g, s)));
    if (g.status === 'ended') tx.update(lobbyRef, { status: 'ended' });
    out = { view: viewFor(g, seat) };
  });

  if (out.rejected) throw new HttpError(409, out.rejected, { view: out.view });
  return { view: out.view };
});
