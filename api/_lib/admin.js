import { initializeApp, cert, getApps } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

function credential() {
  const raw = (process.env.FIREBASE_SERVICE_ACCOUNT || '').trim();
  if (!raw) throw new Error('FIREBASE_SERVICE_ACCOUNT not set');
  // Accept either raw JSON or base64-encoded JSON.
  const json = raw.startsWith('{') ? raw : Buffer.from(raw, 'base64').toString('utf8');
  return cert(JSON.parse(json));
}

if (!getApps().length) initializeApp({ credential: credential() });

export const db = getFirestore();
const auth = getAuth();

export class HttpError extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

async function uidFrom(req) {
  const h = req.headers.authorization || '';
  if (!h.startsWith('Bearer ')) throw new HttpError(401, 'auth');
  try {
    return (await auth.verifyIdToken(h.slice(7))).uid;
  } catch {
    throw new HttpError(401, 'auth');
  }
}

// Wraps a POST handler: verifies the Firebase ID token and stamps server time on every response.
export function handler(fn) {
  return async (req, res) => {
    if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'method' });
    try {
      const uid = await uidFrom(req);
      const out = await fn(uid, req.body || {});
      res.status(200).json({ ok: true, ...out, now: Date.now() });
    } catch (e) {
      if (!e.status) console.error(e);
      res.status(e.status || 500).json({ ok: false, error: e.status ? e.message : 'server', now: Date.now() });
    }
  };
}

export const cleanName = (s, max = 20) => String(s || '').trim().slice(0, max);
