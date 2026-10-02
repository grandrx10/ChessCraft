import React, { useState } from 'react';
import { storedName } from './firebase.js';

export function Modal({ children, onClose }) {
  return (
    <div className="backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className="modal">{children}</div>
    </div>
  );
}

export function NameModal({ onSubmit, onClose, busy }) {
  const [name, setName] = useState(storedName.get());
  const submit = (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    storedName.set(name.trim());
    onSubmit(name.trim());
  };
  return (
    <Modal onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <input autoFocus maxLength={20} placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="primary" disabled={busy || !name.trim()}>Join</button>
      </form>
    </Modal>
  );
}

export const go = (hash) => { location.hash = hash; };
