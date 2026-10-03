import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// Dev only: serve api/*.js with a minimal Vercel-style req/res shim, so `npm run dev` runs the full stack.
function localApi() {
  return {
    name: 'local-api',
    apply: 'serve',
    configureServer(server) {
      Object.assign(process.env, loadEnv('development', process.cwd(), ''));
      server.middlewares.use('/api', async (req, res, next) => {
        const name = (req.url || '').split('?')[0].replace(/^\/+/, '');
        if (!/^[a-z]+$/.test(name)) return next();
        let raw = '';
        for await (const chunk of req) raw += chunk;
        try { req.body = raw ? JSON.parse(raw) : {}; } catch { req.body = {}; }
        res.status = (code) => { res.statusCode = code; return res; };
        res.json = (obj) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(obj)); };
        try {
          const mod = await server.ssrLoadModule(`/api/${name}.js`);
          await mod.default(req, res);
        } catch (e) {
          console.error(e);
          res.statusCode = 500;
          res.end();
        }
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), localApi()],
  // Must match the server's BUILD (api/_lib/admin.js) so the client can detect version skew.
  define: { __BUILD__: JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA || 'dev') },
  ssr: { external: ['firebase-admin'] },
});
