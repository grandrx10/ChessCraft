import React, { useEffect, useMemo, useRef, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, api, serverNow } from './firebase.js';
import { go } from './ui.jsx';
import Piece from './Piece.jsx';
import { applyPending, newPieceId, settled, rulesOfView } from './optimistic.js';
import {
  costOf, seatColor, toBoard, COOLDOWN, SPAWNABLE, moves, visibility, spawnSquares, inCheck, pointsAt, pieceAt,
} from '../shared/game.js';

export default function Game({ id, uid }) {
  const [serverView, setServerView] = useState(null);
  const [pending, setPending] = useState([]);
  const [sel, setSel] = useState(null); // piece id
  const [spawnType, setSpawnType] = useState(null);
  const [dismissed, setDismissed] = useState(false);
  const [, tick] = useState(0);
  const latest = useRef(null);

  // Server views arrive from the listener and from API responses; keep whichever is newest.
  const accept = (v) => {
    if (!v || (latest.current && (v.ver || 0) < (latest.current.ver || 0))) return;
    latest.current = v;
    setServerView(v);
  };
  // Drop acknowledged actions the newest server view already reflects.
  const prune = (ps) => ps.filter((a) => !(a.acked && latest.current && settled(latest.current.pieces, a)));

  useEffect(() => onSnapshot(doc(db, 'games', id, 'views', uid), (s) => {
    if (!s.exists()) return;
    accept(s.data());
    setPending(prune);
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
    const rules = rulesOfView(view);
    return {
      rules,
      vis: visibility(pieces, seat, rules.size),
      check: inCheck(pieces, seat, rules),
      king: pieces.find((p) => p.owner === seat && p.type === 'king'),
    };
  }, [view]);

  if (!view) return <div className="center"><div className="spinner" /></div>;

  const { pieces, seat, names, status, winner } = view;
  const { rules } = derived;
  const { mode, size } = rules;
  const alive = view.alive || names.map(() => true);
  const now = serverNow();
  const points = Math.floor(pointsAt(view.econ, view.rate, now) + 1e-9);
  const ended = status === 'ended';
  const out = !alive[seat];
  const idle = ended || out;
  const cost = (t) => costOf(t, mode);
  const ready = (p) => now >= p.readyAt;

  const selPiece = sel && pieces.find((p) => p.id === sel && p.owner === seat);
  const targets = selPiece && ready(selPiece) && !idle ? moves(selPiece, pieces, rules) : [];
  const spawnSet = spawnType && !idle ? spawnSquares(pieces, seat, spawnType, rules) : [];
  const has = (list, r, c) => list.some((m) => m.r === r && m.c === c);

  // Apply locally right away. Either way the response carries the server's current view:
  // on success it already includes the action; on rejection the action is dropped (rollback onto that view).
  const act = (action) => {
    const a = { ...action, at: serverNow(), acked: false };
    setPending((ps) => [...ps, a]);
    api('game', { id, action: a.kind, pieceId: a.pieceId, type: a.type, r: a.r, c: a.c })
      .then((res) => {
        accept(res.view);
        setPending((ps) => prune(ps.map((x) => (x === a ? { ...x, acked: true } : x))));
      })
      .catch((err) => {
        console.warn('rejected', a.kind, err.message);
        accept(err.data?.view);
        setPending((ps) => ps.filter((x) => x !== a));
      });
  };

  const onSquare = (r, c) => {
    if (idle) return;
    if (spawnType) {
      if (has(spawnSet, r, c)) {
        act({ kind: 'spawn', pieceId: newPieceId(), type: spawnType, r, c });
        if (points - cost(spawnType) < cost(spawnType)) setSpawnType(null);
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

  // The board is rotated so this player's home edge is at the bottom.
  const home = view.home ?? (seat === 1 ? 2 : 0);
  const squares = [];
  for (let dr = 0; dr < size; dr++) {
    for (let dc = 0; dc < size; dc++) {
      const { r, c } = toBoard(dr, dc, home, size);
      const p = pieceAt(pieces, r, c);
      const visible = idle || derived.vis[r * size + c];
      const cls = [
        'sq',
        (r + c) % 2 ? 'dark' : 'light',
        !visible && 'fog',
        has(spawnSet, r, c) && 'spawn',
        selPiece && selPiece.r === r && selPiece.c === c && 'sel',
        has(targets, r, c) && (p ? 'capture' : 'target'),
        p && p.id === derived.king?.id && derived.check && !idle && 'check',
      ].filter(Boolean).join(' ');
      squares.push(
        <div key={`${r}-${c}`} className={cls} onMouseDown={() => onSquare(r, c)}>
          {p && <Piece type={p.type} color={seatColor(mode, p.owner)} />}
          {p && p.owner === seat && now < p.readyAt + 800 && <Cooldown key={`${p.id}:${p.mv || 0}`} readyAt={p.readyAt} />}
        </div>,
      );
    }
  }
  const track = `repeat(${size}, minmax(0, 1fr))`;

  return (
    <div className="game" onContextMenu={(e) => { e.preventDefault(); setSel(null); setSpawnType(null); }}>
      <div className="player top">
        {names.map((n, s) => s !== seat && (
          <span key={s} className={`opp ${alive[s] ? '' : 'dead'}`}><Swatch color={seatColor(mode, s)} />{n}</span>
        ))}
      </div>
      <div className="board" style={{ gridTemplate: `${track} / ${track}` }}>{squares}</div>
      <div className="player">
        <Swatch color={seatColor(mode, seat)} />{names[seat]}<span className="grow" /><span className="points">{points}</span>
      </div>
      <div className="units">
        {SPAWNABLE.map((t) => (
          <button
            key={t}
            className={`unit ${spawnType === t ? 'on' : ''}`}
            disabled={idle || points < cost(t)}
            onClick={() => { setSel(null); setSpawnType(spawnType === t ? null : t); }}
          >
            <Piece type={t} color={seatColor(mode, seat)} />
            <span className="cost">{cost(t)}</span>
          </button>
        ))}
      </div>
      {(ended || (out && !dismissed)) && (
        <div className="backdrop soft" onMouseDown={(e) => !ended && e.target === e.currentTarget && setDismissed(true)}>
          <div className="modal result">
            <div className={`big ${winner === seat ? 'win' : 'lose'}`}>{winner === seat ? 'Victory' : 'Defeat'}</div>
            <button className="primary" onClick={() => go('')}>Lobby</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Swatch({ color }) {
  const custom = color.startsWith('#');
  return <span className={`swatch ${custom ? '' : color}`} style={custom ? { background: color, borderColor: color } : undefined} />;
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
