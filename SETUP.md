# Setup

## 1. Firebase
1. https://console.firebase.google.com → **Add project** (Analytics optional).
2. **Build → Firestore Database → Create database** → production mode → pick a region.
3. **Firestore → Rules** → paste the contents of `firestore.rules` → **Publish**.
4. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable**.
5. **Project settings (gear) → General → Your apps → Web (`</>`)** → register app (no hosting).
   Copy `apiKey`, `authDomain`, `projectId`, `appId` from the config shown.
6. **Project settings → Service accounts → Generate new private key** → downloads a JSON file.
   Keep it secret, never commit it. Encode it (PowerShell):
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("C:\path\to\key.json")) | Set-Clipboard
   ```

## 2. Local
Copy `.env.example` to `.env` and fill in the values (the base64 string goes in `FIREBASE_SERVICE_ACCOUNT`).

```powershell
npm install
npm run dev       # Vite app + /api functions (local shim in vite.config.js)
```
Open http://localhost:5173 twice (a normal and a private window) to play yourself.

## 3. Vercel
1. Push this folder to a GitHub repo → https://vercel.com/new → import it (preset: Vite).
2. **Settings → Environment Variables**: add the same five variables as in `.env`.
3. Deploy.

## Architecture
- `shared/game.js`: pure rules (moves, fog, spawning, income), used by both the client and the server.
- `api/lobby.js`, `api/game.js`: Vercel functions. They verify the player's Firebase token, validate every
  action against the full game state in a Firestore transaction, then write one fog-filtered
  view per player to `games/{id}/views/{uid}`.
- Clients can read only `lobbies/*` and their own view, so hidden pieces never reach the browser.
- `npm test` runs the engine tests.
