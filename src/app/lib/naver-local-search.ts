import { NearbyPlaceCategory } from '../types';

interface NaverLocalSearchItemResponse {
  title?: string;
  link?: string;
  category?: string;
  description?: string;
  address?: string;
  roadAddress?: string;
  mapx?: string;
  mapy?: string;
}

interface NaverLocalSearchResponse {
  items?: NaverLocalSearchItemResponse[];
  message?: string;
}

export interface NearbySearchDefinition {
  key: NearbyPlaceCategory;
  label: string;
  query: string;
}

export interface NearbySearchItem {
  name: string;
  link: string;
  categoryPath: string;
  description: string;
  address: string;
  roadAddress: string;
  coordinates?: {
    lat: number;
    lng: number;
  };
}

export type NaverLocalSearchSort = 'random' | 'comment';

const nearbySearchCache = new Map<string, NearbySearchItem[]>();
const nearbySearchInFlight = new Map<string, Promise<NearbySearchItem[]>>();

function wait(ms: number) {
  return new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function cleanHtmlText(value: string) {
  return value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function parseNaverLocalCoordinate(value?: string) {
  const numericValue = Number(value);

  if (!Number.isFinite(numericValue)) {
    return null;
  }

  return numericValue / 10000000;
}

async function fetchNearbySearchResultsOnce(
  query: string,
  display = 4,
  sort: NaverLocalSearchSort = 'comment',
) {
  const requestUrl = new URL('/api/naver/local-search', window.location.origin);
  requestUrl.searchParams.set('query', query);
  requestUrl.searchParams.set('display', String(display));
  requestUrl.searchParams.set('sort', sort);

  const response = await fetch(requestUrl.toString());
  const data = (await response.json().catch(() => null)) as NaverLocalSearchResponse | null;

  if (!response.ok) {
    throw new Error(data?.message ?? '근처 정보를 가져오지 못했습니다.');
  }

  if (!data) {
    throw new Error('근처 정보를 가져오지 못했습니다.');
  }

  return (data.items ?? []).map<NearbySearchItem>((item) => {
    const lng = parseNaverLocalCoordinate(item.mapx);
    const lat = parseNaverLocalCoordinate(item.mapy);
    const hasCoordinates = lat !== null && lng !== null;

    return {
      name: cleanHtmlText(item.title ?? ''),
      link: item.link?.trim() ?? '',
      categoryPath: cleanHtmlText(item.category ?? ''),
      description: cleanHtmlText(item.description ?? ''),
      address: cleanHtmlText(item.address ?? ''),
      roadAddress: cleanHtmlText(item.roadAddress ?? ''),
      coordinates: hasCoordinates ? { lat, lng } : undefined,
    };
  });
}

export async function fetchNearbySearchResults(
  query: string,
  display = 4,
  sort: NaverLocalSearchSort = 'comment',
) {
  const cacheKey = `${query.trim()}:${display}:${sort}`;
  const cached = nearbySearchCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const inFlight = nearbySearchInFlight.get(cacheKey);

  if (inFlight) {
    return inFlight;
  }

  const request = (async () => {
    let lastError: unknown = null;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await fetchNearbySearchResultsOnce(query, display, sort);
      } catch (error) {
        lastError = error;
        if (attempt < 2) {
          await wait(450 * (attempt + 1));
        }
      }
    }

    throw lastError instanceof Error ? lastError : new Error('주변 정보를 가져오지 못했습니다.');
  })();

  nearbySearchInFlight.set(cacheKey, request);

  try {
    const results = await request;
    nearbySearchCache.set(cacheKey, results);
    return results;
  } finally {
    nearbySearchInFlight.delete(cacheKey);
  }
}
