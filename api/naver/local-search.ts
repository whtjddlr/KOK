import { json } from '../_lib/server.js';

type SearchCacheEntry = {
  body: string;
  contentType: string;
  expiresAt: number;
  status: number;
};

const LOCAL_SEARCH_CACHE_TTL_MS = 5 * 60 * 1000;
const globalSearchState = globalThis as typeof globalThis & {
  __kokNaverLocalSearchCache?: Map<string, SearchCacheEntry>;
  __kokNaverLocalSearchInFlight?: Map<string, Promise<SearchCacheEntry>>;
};
const localSearchCache =
  globalSearchState.__kokNaverLocalSearchCache ??
  (globalSearchState.__kokNaverLocalSearchCache = new Map<string, SearchCacheEntry>());
const localSearchInFlight =
  globalSearchState.__kokNaverLocalSearchInFlight ??
  (globalSearchState.__kokNaverLocalSearchInFlight = new Map<string, Promise<SearchCacheEntry>>());

function sendCachedSearchResult(res: any, entry: SearchCacheEntry) {
  res.statusCode = entry.status;
  res.setHeader('Content-Type', entry.contentType);
  res.end(entry.body);
}

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

    const cacheKey = `${query}:${display}:${sort}`;
    const cached = localSearchCache.get(cacheKey);

    if (cached && cached.expiresAt > Date.now()) {
      sendCachedSearchResult(res, cached);
      return;
    }

    const upstreamUrl = new URL('https://openapi.naver.com/v1/search/local.json');
    upstreamUrl.searchParams.set('query', query);
    upstreamUrl.searchParams.set('display', display);
    upstreamUrl.searchParams.set('start', '1');
    upstreamUrl.searchParams.set('sort', sort);

    const pending =
      localSearchInFlight.get(cacheKey) ??
      (async () => {
        const upstreamResponse = await fetch(upstreamUrl.toString(), {
          headers: {
            'X-Naver-Client-Id': clientId,
            'X-Naver-Client-Secret': clientSecret,
            Accept: 'application/json',
          },
        });
        const body = await upstreamResponse.text();

        return {
          body,
          contentType:
            upstreamResponse.headers.get('content-type') ?? 'application/json; charset=utf-8',
          expiresAt: Date.now() + LOCAL_SEARCH_CACHE_TTL_MS,
          status: upstreamResponse.status,
        } satisfies SearchCacheEntry;
      })();

    localSearchInFlight.set(cacheKey, pending);

    const result = await pending.finally(() => {
      localSearchInFlight.delete(cacheKey);
    });

    if (result.status === 200) {
      localSearchCache.set(cacheKey, result);
    }

    sendCachedSearchResult(res, result);
  } catch (error) {
    json(res, 500, {
      message:
        error instanceof Error
          ? error.message
          : 'Unknown proxy error while calling NAVER local search API.',
    });
  }
}
