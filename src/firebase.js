import { initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signInAnonymously } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const configured = Boolean(config.apiKey && config.projectId);

const app = configured ? initializeApp(config) : null;
const auth = app && getAuth(app);
export const db = app && getFirestore(app);

// Resolves with the anonymous user once signed in.
export const userReady = configured
  ? new Promise((resolve) => {
      onAuthStateChanged(auth, (u) => {
        if (u) resolve(u);
        else signInAnonymously(auth).catch(console.error);
      });
    })
  : new Promise(() => {});

// Server clock offset, refreshed from every API response.
let offset = 0;
export const serverNow = () => Date.now() + offset;

export async function api(path, body) {
  const user = await userReady;
  const token = await user.getIdToken();
  const t0 = Date.now();
  const res = await fetch(`/api/${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  const t1 = Date.now();
  const json = await res.json().catch(() => ({ ok: false, error: 'network' }));
  if (json.now) offset = json.now - (t0 + t1) / 2;
  if (!json.ok) throw Object.assign(new Error(json.error || 'error'), { data: json });
  return json;
}

export const storedName = {
  get() { try { return localStorage.getItem('cc-name') || ''; } catch { return ''; } },
  set(v) { try { localStorage.setItem('cc-name', v); } catch { /* ignore */ } },
};
