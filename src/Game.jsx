import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, api, serverNow } from './firebase.js';
import { go } from './ui.jsx';
import Piece from './Piece.jsx';
import { applyPending, newPieceId, settled } from './optimistic.js';
import {
  COST, COOLDOWN, SPAWNABLE, moves, visibility, spawnSquares, inCheck, pointsAt, pieceAt,
} from '../shared/game.js';

export default function Game({ id, uid }) {
  const [serverView, setServerView] = useState(null);
  const [pending, setPending] = useState([]);
  const [sel, setSel] = useState(null); // piece id
  const [spawnType, setSpawnType] = useState(null);
  const [, tick] = useState(0);
  const latest = useRef(null);

  useEffect(() => onSnapshot(doc(db, 'games', id, 'views', uid), (s) => {
    if (!s.exists()) return;
    const v = s.data();
    latest.current = v;
    setServerView(v);
    // Drop acknowledged actions the server view now reflects.
    setPending((ps) => ps.filter((a) => !(a.acked && settled(v.pieces, a))));
  }), [id, uid]);

  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 100);
    const esc = (e) => e.key === 'Escape' && (setSel(null), setSpawnType(null));
    addEventListener('keydown', esc);
    return () => { clearInterval(t); removeEventListener('keydown', esc); };
  }, []);

  const view = useMemo(() => serverView && applyPending(serverView, pending), [serverView, pending]);

  const derived = useMemo(() => {
    if (!view) return null;
    const { pieces, seat } = view;
    return {
      vis: visibility(pieces, seat),
      check: inCheck(pieces, seat),
      king: pieces.find((p) => p.owner === seat && p.type === 'king'),
    };
  }, [view]);

  if (!view) return <div className="center"><div className="spinner" /></div>;

  const { pieces, seat, names, status, winner } = view;
  const now = serverNow();
  const points = Math.floor(pointsAt(view.econ, view.rate, now) + 1e-9);
  const ended = status === 'ended';
  const ready = (p) => now >= p.readyAt;

  const selPiece = sel && pieces.find((p) => p.id === sel && p.owner === seat);
  const targets = selPiece && ready(selPiece) && !ended ? moves(selPiece, pieces) : [];
  const spawnSet = spawnType && !ended ? spawnSquares(pieces, seat, spawnType) : [];
  const has = (list, r, c) => list.some((m) => m.r === r && m.c === c);

  // Apply locally right away; on rejection drop it (rollback), on success keep it until a snapshot reflects it.
  const act = (action) => {
    const a = { ...action, at: serverNow(), acked: false };
    setPending((ps) => [...ps, a]);
    api('game', { id, action: a.kind, pieceId: a.pieceId, type: a.type, r: a.r, c: a.c })
      .then(() => setPending((ps) => ps
        .map((x) => (x === a ? { ...x, acked: true } : x))
        .filter((x) => !(x.acked && latest.current && settled(latest.current.pieces, x)))))
      .catch(() => setPending((ps) => ps.filter((x) => x !== a)));
  };

  const onSquare = (r, c) => {
    if (ended) return;
    if (spawnType) {
      if (has(spawnSet, r, c)) {
        act({ kind: 'spawn', pieceId: newPieceId(), type: spawnType, r, c });
        if (points - COST[spawnType] < COST[spawnType]) setSpawnType(null);
      } else setSpawnType(null);
      return;
    }
    if (selPiece && has(targets, r, c)) {
      act({ kind: 'move', pieceId: selPiece.id, mv: (selPiece.mv || 0) + 1, r, c });
      setSel(null);
      return;
    }
    const p = pieceAt(pieces, r, c);
    setSel(p && p.owner === seat && p.type !== 'garrison' && ready(p) && p.id !== sel ? p.id : null);
  };

  // Seat 1 sees the board rotated so their side is at the bottom.
  const flip = seat === 1;
  const squares = [];
  for (let dr = 0; dr < 8; dr++) {
    for (let dc = 0; dc < 8; dc++) {
      const r = flip ? 7 - dr : dr;
      const c = flip ? 7 - dc : dc;
      const p = pieceAt(pieces, r, c);
      const visible = ended || derived.vis[r * 8 + c];
      const cls = [
        'sq',
        (r + c) % 2 ? 'dark' : 'light',
        !visible && 'fog',
        has(spawnSet, r, c) && 'spawn',
        selPiece && selPiece.r === r && selPiece.c === c && 'sel',
        has(targets, r, c) && (p ? 'capture' : 'target'),
        p && p.id === derived.king?.id && derived.check && !ended && 'check',
      ].filter(Boolean).join(' ');
      squares.push(
        <div key={`${r}-${c}`} className={cls} onMouseDown={() => onSquare(r, c)}>
          {p && <Piece type={p.type} owner={p.owner} />}
          {p && p.owner === seat && now < p.readyAt + 800 && <Cooldown key={`${p.id}:${p.mv || 0}`} readyAt={p.readyAt} />}
        </div>,
      );
    }
  }

  return (
    <div className="game" onContextMenu={(e) => { e.preventDefault(); setSel(null); setSpawnType(null); }}>
      <div className="player top"><span className={`swatch ${seat === 0 ? 'black' : 'white'}`} />{names[1 - seat]}</div>
      <div className="board">{squares}</div>
      <div className="player"><span className={`swatch ${seat === 0 ? 'white' : 'black'}`} />{names[seat]}<span className="grow" /><span className="points">{points}</span></div>
      <div className="units">
        {SPAWNABLE.map((t) => (
          <button
            key={t}
            className={`unit ${spawnType === t ? 'on' : ''}`}
            disabled={ended || points < COST[t]}
            onClick={() => { setSel(null); setSpawnType(spawnType === t ? null : t); }}
          >
            <Piece type={t} owner={seat} />
            <span className="cost">{COST[t]}</span>
          </button>
        ))}
      </div>
      {ended && (
        <div className="backdrop soft">
          <div className="modal result">
            <div className={`big ${winner === seat ? 'win' : 'lose'}`}>{winner === seat ? 'Victory' : 'Defeat'}</div>
            <button className="primary" onClick={() => go('')}>Lobby</button>
          </div>
        </div>
      )}
    </div>
  );
}

// Red ring fills over the cooldown, flashes green when ready, then fades.
// Keyed by piece id + move count, so a server confirmation doesn't restart it.
function Cooldown({ readyAt }) {
  const [remain] = useState(() => readyAt - serverNow());
  if (remain <= -700) return null;
  const elapsed = COOLDOWN - remain;
  return (
    <svg className="cd" viewBox="0 0 40 40" style={{ animationDelay: `${remain}ms` }}>
      <circle className="cd-track" cx="20" cy="20" r="17" />
      <circle
        className="cd-fill" cx="20" cy="20" r="17" pathLength="100"
        style={{ animationDuration: `${COOLDOWN}ms`, animationDelay: `${-elapsed}ms` }}
      />
      <circle className="cd-done" cx="20" cy="20" r="17" style={{ animationDelay: `${remain}ms` }} />
    </svg>
  );
}
