import React, { useEffect, useState } from 'react';
import { configured, userReady, api } from './firebase.js';
import Lobby from './Lobby.jsx';
import Room from './Room.jsx';

export default function App() {
  const [hash, setHash] = useState(location.hash);
  const [user, setUser] = useState(null);

  useEffect(() => {
    const onHash = () => setHash(location.hash);
    addEventListener('hashchange', onHash);
    userReady.then((u) => {
      setUser(u);
      api('lobby', { action: 'ping' }).catch(() => {});
    });
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (!configured) return <div className="center muted">Firebase not configured</div>;
  if (!user) return <div className="center"><div className="spinner" /></div>;

  const m = hash.match(/^#\/s\/([\w-]+)$/);
  return m ? <Room key={m[1]} id={m[1]} uid={user.uid} /> : <Lobby />;
}
