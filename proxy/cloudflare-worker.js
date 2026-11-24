// Opcionális CORS-proxy a MÁV EMMA (OTP) API-hoz, ha a böngésző nem éri el közvetlenül.
// Telepítés: Cloudflare Dashboard → Workers → Create → illeszd be ezt → Deploy.
// Utána az app Beállítások → Haladó → API cím mezőbe írd a worker címét.
const UPSTREAM = 'https://mavplusz.hu/otp2-backend/otp/routers/default/index/graphql';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Accept',
  'Access-Control-Max-Age': '86400',
};

export default {
  async fetch(request) {
    if (request.method === 'OPTIONS') return new Response(null, { headers: CORS });
    if (request.method !== 'POST') return new Response('Only POST', { status: 405, headers: CORS });
    const upstream = await fetch(UPSTREAM, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: await request.text(),
    });
    return new Response(upstream.body, {
      status: upstream.status,
      headers: { ...CORS, 'Content-Type': upstream.headers.get('Content-Type') || 'application/json' },
    });
  },
};
