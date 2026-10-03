import React, { useEffect, useState } from 'react';
import { collection, onSnapshot, query, where } from 'firebase/firestore';
import { db, api, storedName } from './firebase.js';
import { Modal, go } from './ui.jsx';
import { MODES } from '../shared/game.js';

const STALE_MS = 2 * 60 * 60 * 1000;

export default function Lobby() {
  const [servers, setServers] = useState(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const q = query(collection(db, 'lobbies'), where('status', '==', 'waiting'));
    return onSnapshot(q, (snap) => {
      const cutoff = Date.now() - STALE_MS;
      setServers(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .filter((s) => s.createdAt > cutoff)
          .sort((a, b) => b.createdAt - a.createdAt),
      );
    });
  }, []);

  return (
    <div className="page">
      <header className="bar">
        <h1>ChessCraft</h1>
        <button className="icon primary" onClick={() => setCreating(true)} aria-label="Create server">+</button>
      </header>
      <ul className="list">
        {servers === null && <li className="row muted"><div className="spinner" /></li>}
        {servers?.length === 0 && <li className="row muted empty">—</li>}
        {servers?.map((s) => (
          <li key={s.id} className="row clickable" onClick={() => go(`#/s/${s.id}`)}>
            <span className="grow">{s.name}</span>
            <span className="tag">{s.format}</span>
            <span className="muted">{s.players.length}/{MODES[s.format]?.max ?? 2}</span>
          </li>
        ))}
      </ul>
      {creating && <CreateModal onClose={() => setCreating(false)} />}
    </div>
  );
}

function CreateModal({ onClose }) {
  const [serverName, setServerName] = useState('');
  const [name, setName] = useState(storedName.get());
  const [format, setFormat] = useState('1v1');
  const [busy, setBusy] = useState(false);
  const valid = serverName.trim() && name.trim();

  const submit = async (e) => {
    e.preventDefault();
    if (!valid) return;
    setBusy(true);
    storedName.set(name.trim());
    try {
      const { id } = await api('lobby', { action: 'create', serverName, name, format });
      go(`#/s/${id}`);
    } catch {
      setBusy(false);
    }
  };

  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <input autoFocus maxLength={32} placeholder="Server" value={serverName} onChange={(e) => setServerName(e.target.value)} />
        <input maxLength={20} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div className="seg">
          {Object.keys(MODES).map((f) => (
            <button type="button" key={f} className={f === format ? 'on' : ''} onClick={() => setFormat(f)}>{f}</button>
          ))}
        </div>
        <button className="primary" disabled={busy || !valid}>Create</button>
      </form>
    </Modal>
  );
}
