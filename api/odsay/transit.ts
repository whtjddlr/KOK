import { json, pickFirstEnv } from '../_lib/server.js';

function isFiniteCoordinate(value: string | null) {
  return value !== null && Number.isFinite(Number(value));
}

function getHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

function getRequestReferer(req: any) {
  const referer = getHeaderValue(req.headers?.referer);
  const origin = getHeaderValue(req.headers?.origin);

  if (referer) {
    return referer;
  }

  if (origin) {
    return origin;
  }

  const host = getHeaderValue(req.headers?.host);

  if (!host) {
    return 'https://randommeetingplaceapp.vercel.app/';
  }

  const forwardedProto = getHeaderValue(req.headers?.['x-forwarded-proto']);
  const isLocalHost = host.startsWith('127.0.0.1') || host.startsWith('localhost');
  const protocol = forwardedProto ?? (isLocalHost ? 'http' : 'https');

  return `${protocol}://${host}/`;
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'GET') {
    json(res, 405, { message: 'Method not allowed' });
    return;
  }

  const apiKey = pickFirstEnv(process.env, ['ODSAY_API_KEY', 'VITE_ODSAY_API_KEY']);

  if (!apiKey) {
    json(res, 500, {
      message: 'ODsay API key is missing on the server.',
    });
    return;
  }

  try {
    const requestUrl = new URL(req.url, 'http://127.0.0.1');
    const startX = requestUrl.searchParams.get('startX');
    const startY = requestUrl.searchParams.get('startY');
    const endX = requestUrl.searchParams.get('endX');
    const endY = requestUrl.searchParams.get('endY');

    if (
      !isFiniteCoordinate(startX) ||
      !isFiniteCoordinate(startY) ||
      !isFiniteCoordinate(endX) ||
      !isFiniteCoordinate(endY)
    ) {
      json(res, 400, {
        message: 'startX, startY, endX, and endY query params are required.',
      });
      return;
    }

    const upstreamUrl = new URL('https://api.odsay.com/v1/api/searchPubTransPathT');
    upstreamUrl.searchParams.set('apiKey', apiKey);
    upstreamUrl.searchParams.set('SX', startX!);
    upstreamUrl.searchParams.set('SY', startY!);
    upstreamUrl.searchParams.set('EX', endX!);
    upstreamUrl.searchParams.set('EY', endY!);
    upstreamUrl.searchParams.set('OPT', requestUrl.searchParams.get('opt') ?? '0');
    upstreamUrl.searchParams.set('SearchType', requestUrl.searchParams.get('searchType') ?? '0');
    upstreamUrl.searchParams.set(
      'SearchPathType',
      requestUrl.searchParams.get('searchPathType') ?? '0',
    );
    upstreamUrl.searchParams.set('lang', requestUrl.searchParams.get('lang') ?? '0');
    upstreamUrl.searchParams.set('output', 'json');

    const upstreamResponse = await fetch(upstreamUrl.toString(), {
      headers: {
        Accept: 'application/json',
        Referer: getRequestReferer(req),
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
          : 'Unknown proxy error while calling ODsay transit API.',
    });
  }
}
