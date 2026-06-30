// proxy-worker.js
// Despliega esto en Cloudflare Workers (gratis hasta 100,000 peticiones/día).
//
// Pasos:
// 1. Crea una cuenta en https://workers.cloudflare.com
// 2. Dashboard → Workers & Pages → Create → "Create Worker"
// 3. Pega este código en el editor y dale "Deploy"
// 4. Cloudflare te da una URL tipo: https://tu-proxy.tu-usuario.workers.dev
// 5. En Extracta, en el campo "Proxy CORS" pon:
//    https://tu-proxy.tu-usuario.workers.dev/?url=

export default {
  async fetch(request) {
    const requestUrl = new URL(request.url);
    const targetUrl = requestUrl.searchParams.get('url');

    // CORS preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders() });
    }

    if (!targetUrl) {
      return new Response('Falta el parámetro "url"', { status: 400, headers: corsHeaders() });
    }

    // Opcional pero recomendado: restringe a dominios que tú controlas
    // o que sepas que vas a escanear, para evitar que cualquiera use tu proxy
    // como puerta abierta a otros sitios.
    //
    // const allowed = ['tienda-cliente.com', 'otra-tienda.com'];
    // const targetHost = new URL(targetUrl).hostname;
    // if (!allowed.some(h => targetHost.endsWith(h))) {
    //   return new Response('Dominio no permitido', { status: 403, headers: corsHeaders() });
    // }

    try {
      const response = await fetch(targetUrl, {
        headers: {
          // Algunos sitios bloquean peticiones sin user-agent de navegador
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36'
        }
      });

      const body = await response.text();

      return new Response(body, {
        status: response.status,
        headers: {
          ...corsHeaders(),
          'Content-Type': response.headers.get('Content-Type') || 'text/html; charset=utf-8'
        }
      });
    } catch (err) {
      return new Response('Error al obtener la URL: ' + err.message, { status: 502, headers: corsHeaders() });
    }
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type'
  };
}
