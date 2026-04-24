import { json } from '../_lib/server.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const clientId = process.env.VITE_NAVER_MAP_KEY_ID?.trim() ?? '';
  const clientSecret = process.env.NAVER_MAP_CLIENT_SECRET?.trim() ?? '';

  if (!clientId || !clientSecret) {
    json(res, 500, {
      message: 'NAVER Maps Directions credentials are missing on the server.',
    });
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const start = requestUrl.searchParams.get('start');
    const goal = requestUrl.searchParams.get('goal');
    const option = requestUrl.searchParams.get('option') ?? 'traoptimal';

    if (!start || !goal) {
      json(res, 400, { message: 'start and goal query params are required.' });
      return;
    }

    const upstreamUrl = new URL('https://maps.apigw.ntruss.com/map-direction/v1/driving');
    upstreamUrl.searchParams.set('start', start);
    upstreamUrl.searchParams.set('goal', goal);
    upstreamUrl.searchParams.set('option', option);

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        'x-ncp-apigw-api-key-id': clientId,
        'x-ncp-apigw-api-key': clientSecret,
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
          : 'Unknown proxy error while calling NAVER Directions API.',
    });
  }
}
