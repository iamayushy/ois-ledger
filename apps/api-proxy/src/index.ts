const STRIPPED_REQUEST_HEADERS: readonly string[] = [
  'host',
  'connection',
  'keep-alive',
  'proxy-connection',
  'transfer-encoding',
  'upgrade',
];

function toUpstreamUrl(requestUrl: string, apiOrigin: string): URL {
  const incoming = new URL(requestUrl);
  const upstream = new URL(apiOrigin);
  upstream.pathname = incoming.pathname;
  upstream.search = incoming.search;
  return upstream;
}

function toUpstreamHeaders(request: Request): Headers {
  const headers = new Headers(request.headers);
  for (const name of STRIPPED_REQUEST_HEADERS) {
    headers.delete(name);
  }
  headers.set('x-forwarded-host', new URL(request.url).host);
  headers.set('x-forwarded-proto', 'https');
  return headers;
}

function hasRequestBody(method: string): boolean {
  return method !== 'GET' && method !== 'HEAD';
}

export default {
  fetch(request, env) {
    return fetch(toUpstreamUrl(request.url, env.API_ORIGIN), {
      method: request.method,
      headers: toUpstreamHeaders(request),
      body: hasRequestBody(request.method) ? request.body : null,
      redirect: 'manual',
    });
  },
} satisfies ExportedHandler<Env>;
