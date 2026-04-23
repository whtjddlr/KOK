import { json } from '../_lib/server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const clientId = process.env.NAVER_SEARCH_CLIENT_ID?.trim() ?? '';
  const clientSecret = process.env.NAVER_SEARCH_CLIENT_SECRET?.trim() ?? '';

  if (!clientId || !clientSecret) {
    json(res, 500, {
      message: 'NAVER Search credentials are missing on the server.',
    });
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const query = requestUrl.searchParams.get('query')?.trim();
    const display = requestUrl.searchParams.get('display')?.trim() || '4';
    const sort = requestUrl.searchParams.get('sort')?.trim() || 'random';

    if (!query) {
      json(res, 400, { message: 'query is required.' });
      return;
    }

    const upstreamUrl = new URL('https://openapi.naver.com/v1/search/local.json');
    upstreamUrl.searchParams.set('query', query);
    upstreamUrl.searchParams.set('display', display);
    upstreamUrl.searchParams.set('start', '1');
    upstreamUrl.searchParams.set('sort', sort);

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        'X-Naver-Client-Id': clientId,
        'X-Naver-Client-Secret': clientSecret,
        Accept: 'application/json',
      },
    });
    const body = await upstreamResponse.text();

    res.statusCode = upstreamResponse.status;
    res.setHeader(
      'Content-Type',
      upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
    );
    res.end(body);
  } catch (error) {
    json(res, 500, {
      message:
        error instanceof Error
          ? error.message
          : 'Unknown proxy error while calling NAVER local search API.',
    });
  }
}
