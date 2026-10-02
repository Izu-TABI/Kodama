// Serves /api/lookup from the Vite dev and preview servers.
import { lookup, LookupError } from './lookup.js';

async function handle(req, res, next) {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname !== '/api/lookup') return next();
  let status = 200;
  let body;
  try {
    body = await lookup(url.searchParams.get('url') || '');
  } catch (e) {
    const known = e instanceof LookupError;
    if (!known) console.error('[api/lookup]', e);
    status = known ? e.status : 500;
    body = { error: { code: known ? e.code : 'internal', message: known ? e.message : '読み込み中にエラーが起きました' } };
  }
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(body));
}

export default function lookupApi() {
  return {
    name: 'shadowing-lookup-api',
    configureServer(server) { server.middlewares.use(handle); },
    configurePreviewServer(server) { server.middlewares.use(handle); },
  };
}
