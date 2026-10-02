import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db, api } from './firebase.js';
import { NameModal, go } from './ui.jsx';
import Game from './Game.jsx';

export default function Room({ id, uid }) {
  const [lobby, setLobby] = useState(undefined);
  const [busy, setBusy] = useState(false);

  useEffect(() => onSnapshot(doc(db, 'lobbies', id), (snap) => {
    if (!snap.exists()) go('');
    else setLobby(snap.data());
  }, () => go('')), [id]);

  const member = lobby?.players.some((p) => p.uid === uid);
  const shut = lobby && lobby.status !== 'waiting' && !member;
  useEffect(() => { if (shut) go(''); }, [shut]);

  if (!lobby || shut) return <div className="center"><div className="spinner" /></div>;
  if (lobby.status !== 'waiting') return <Game id={id} uid={uid} />;

  if (!member) {
    const join = async (name) => {
      setBusy(true);
      try { await api('lobby', { action: 'join', id, name }); } catch { go(''); }
      setBusy(false);
    };
    return <NameModal busy={busy} onSubmit={join} onClose={() => go('')} />;
  }

  const isHost = lobby.hostId === uid;
  const canStart = isHost && lobby.players.length >= 2;

  const leave = async () => {
    go('');
    api('lobby', { action: 'leave', id }).catch(() => {});
  };
  const start = async () => {
    setBusy(true);
    try { await api('lobby', { action: 'start', id }); } catch { setBusy(false); }
  };

  return (
    <div className="page">
      <header className="bar">
        <button className="icon" onClick={leave} aria-label="Leave">←</button>
        <h1 className="grow">{lobby.name}</h1>
        <span className="tag">{lobby.format}</span>
      </header>
      <ul className="list">
        {lobby.players.map((p) => (
          <li key={p.uid} className={`row ${p.uid === uid ? 'me' : ''}`}>
            <span className={`dot ${p.uid === lobby.hostId ? 'host' : ''}`} />
            <span className="grow">{p.name}</span>
          </li>
        ))}
        {Array.from({ length: Math.max(0, 2 - lobby.players.length) }, (_, i) => (
          <li key={`empty${i}`} className="row ghost"><span className="dot" /><span className="pulse">·  ·  ·</span></li>
        ))}
      </ul>
      {isHost && (
        <button className="primary wide" disabled={!canStart || busy} onClick={start}>Start</button>
      )}
    </div>
  );
}
