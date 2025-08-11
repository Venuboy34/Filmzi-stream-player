// worker.js - Filmzii proxy
const ALLOWED_HOSTS = [
  'pixeldrain.dev',
  'io-filedownloader.vercel.app',
  'files002.tusdrive.com',
  'files010.tusdrive.com',
  'files013.tusdrive.top',
  'gofile.io',
  'bzwok-9e28de65052d.herokuapp.com',
  'files002.tusdrive.top',
  // add more trusted hostnames here
];

function corsResponse(body, init = {}) {
  init.headers = init.headers || {};
  init.headers['Access-Control-Allow-Origin'] = '*';
  init.headers['Access-Control-Allow-Methods'] = 'GET,HEAD,OPTIONS';
  init.headers['Access-Control-Allow-Headers'] = 'Range,Content-Type,Origin';
  return new Response(body, init);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    if (request.method === 'OPTIONS') return corsResponse(null, { status: 204 });

    try {
      if (pathname === '/stream') {
        const target = url.searchParams.get('url');
        if (!target) return corsResponse('Missing url', { status: 400 });

        let turl;
        try { turl = new URL(target); } catch (e) { return corsResponse('Invalid url', { status: 400 }); }

        if (!ALLOWED_HOSTS.includes(turl.hostname)) {
          return corsResponse('Host not allowed', { status: 403 });
        }

        // Forward Range and Accept headers
        const headers = new Headers();
        if (request.headers.get('Range')) headers.set('Range', request.headers.get('Range'));
        if (request.headers.get('Accept')) headers.set('Accept', request.headers.get('Accept'));
        // Optional: forward User-Agent if you want
        headers.set('User-Agent', request.headers.get('User-Agent') || 'Filmzii-Worker');

        const resp = await fetch(turl.toString(), { method: 'GET', headers });
        // allow partial content (206) or 200
        if (!resp.ok && resp.status !== 206) return corsResponse(`Upstream returned ${resp.status}`, { status: 502 });

        const rh = new Headers(resp.headers);
        rh.set('Access-Control-Allow-Origin', '*');
        rh.set('Access-Control-Expose-Headers', 'Content-Length,Content-Range,Accept-Ranges,Content-Type');

        return new Response(resp.body, { status: resp.status, statusText: resp.statusText, headers: rh });
      }

      // health check or root
      if (pathname === '/' || pathname === '/health') {
        return corsResponse(JSON.stringify({ ok: true, ts: Date.now() }), { status: 200, headers: { 'Content-Type': 'application/json' } });
      }

      return corsResponse('Not found', { status: 404 });
    } catch (err) {
      return corsResponse('Worker error: ' + err.message, { status: 500 });
    }
  }
};
