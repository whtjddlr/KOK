import { useEffect, useMemo, useState } from 'react';
import { Candidate, Coordinates, MeetCategoryKey } from '../types';
import { fetchNearbySearchResults } from '../lib/naver-local-search';
import { searchAddress } from '../lib/naver-map';
import { buildNaverMapReservationLink, buildNaverMapSearchLink } from '../lib/naver-links';

export type ContentCategoryKey =
  | 'restaurant'
  | 'cafe'
  | 'drink'
  | 'culture'
  | 'activity';

export interface ContentCategoryDefinition {
  key: ContentCategoryKey;
  label: string;
  accent: string;
  placeholder: string;
  details: string[];
}

export interface ContentRecommendationItem {
  id: string;
  rank: number;
  name: string;
  description: string;
  categoryPath: string;
  address: string;
  roadAddress: string;
  link: string;
  naverSearchLink: string;
  reservationSearchLink: string;
  coordinates: Coordinates | null;
}

interface UseContentRecommendationsResult {
  items: ContentRecommendationItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string | null;
  error: string | null;
  query: string;
}

const recommendationCache = new Map<string, ContentRecommendationItem[]>();
const recommendationCoordinateCache = new Map<string, Coordinates | null>();

export const contentCategoryDefinitions: Record<ContentCategoryKey, ContentCategoryDefinition> = {
  restaurant: {
    key: 'restaurant',
    label: '맛집',
    accent: '#ff7b6b',
    placeholder: '메뉴나 분위기를 검색해 보세요',
    details: ['맛집', '한식', '고기', '파스타', '초밥', '브런치'],
  },
  cafe: {
    key: 'cafe',
    label: '카페',
    accent: '#4ecdc4',
    placeholder: '감성 카페나 디저트를 찾아보세요',
    details: ['카페', '디저트', '베이커리', '감성 카페', '브런치 카페', '작업 카페'],
  },
  drink: {
    key: 'drink',
    label: '술/바',
    accent: '#f59e0b',
    placeholder: '술집이나 바 분위기를 검색해 보세요',
    details: ['술집', '이자카야', '와인바', '칵테일바', '맥주', '포차'],
  },
  culture: {
    key: 'culture',
    label: '전시/문화',
    accent: '#2d3561',
    placeholder: '전시나 문화공간을 검색해 보세요',
    details: ['전시', '공연', '복합문화공간', '소품샵', '갤러리', '산책'],
  },
  activity: {
    key: 'activity',
    label: '놀거리',
    accent: '#8b5cf6',
    placeholder: '방탈출, 보드게임 같은 놀거리를 검색해 보세요',
    details: ['놀거리', '방탈출', '보드게임', '볼링', '오락실', '영화'],
  },
};

export const contentCategoryOrder: ContentCategoryKey[] = [
  'restaurant',
  'cafe',
  'drink',
  'culture',
  'activity',
];

function buildRecommendationCacheKey(
  candidateId: string,
  category: ContentCategoryKey,
  detailQuery: string,
) {
  return `${candidateId}:${category}:${detailQuery.trim().toLowerCase()}`;
}

function cleanQuerySegment(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

async function resolveCoordinates(address: string, fallbackQuery: string) {
  const cacheKey = `${address}:${fallbackQuery}`;
  if (recommendationCoordinateCache.has(cacheKey)) {
    return recommendationCoordinateCache.get(cacheKey) ?? null;
  }

  try {
    const results = await searchAddress(address || fallbackQuery);
    const coordinates = results[0]?.coordinates ?? null;
    recommendationCoordinateCache.set(cacheKey, coordinates);
    return coordinates;
  } catch {
    recommendationCoordinateCache.set(cacheKey, null);
    return null;
  }
}

export function getDefaultContentCategory(
  selectedMeetCategory: MeetCategoryKey,
): ContentCategoryKey {
  switch (selectedMeetCategory) {
    case 'cafe':
      return 'cafe';
    case 'drink':
      return 'drink';
    case 'culture':
      return 'culture';
    case 'activity':
      return 'activity';
    case 'date':
      return 'restaurant';
    case 'dining':
    default:
      return 'restaurant';
  }
}

export function getRandomContentCategory() {
  return contentCategoryOrder[Math.floor(Math.random() * contentCategoryOrder.length)];
}

export function getRandomCategoryDetail(category: ContentCategoryKey) {
  const details = contentCategoryDefinitions[category].details;
  return details[Math.floor(Math.random() * details.length)] ?? '';
}

export function useContentRecommendations(
  candidate: Candidate | null,
  category: ContentCategoryKey | null,
  detailQuery: string,
): UseContentRecommendationsResult {
  const normalizedDetailQuery = useMemo(() => cleanQuerySegment(detailQuery), [detailQuery]);
  const query = useMemo(() => {
    if (!candidate || !category || !normalizedDetailQuery) {
      return '';
    }

    return `${candidate.name} ${normalizedDetailQuery}`;
  }, [candidate, category, normalizedDetailQuery]);

  const cacheKey = useMemo(() => {
    if (!candidate || !category || !normalizedDetailQuery) {
      return '';
    }

    return buildRecommendationCacheKey(candidate.id, category, normalizedDetailQuery);
  }, [candidate, category, normalizedDetailQuery]);

  const cachedItems = cacheKey ? recommendationCache.get(cacheKey) ?? [] : [];
  const [items, setItems] = useState<ContentRecommendationItem[]>(cachedItems);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>(
    cacheKey && cachedItems.length ? 'ready' : 'idle',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!candidate || !category || !normalizedDetailQuery || !cacheKey || !query) {
      setItems([]);
      setStatus('idle');
      setMessage(null);
      setError(null);
      return () => {
        active = false;
      };
    }

    const cached = recommendationCache.get(cacheKey);
    if (cached?.length) {
      setItems(cached);
      setStatus('ready');
      setMessage(`${candidate.name} 근처 인기 순 결과를 바로 보여드릴게요.`);
      setError(null);
      return () => {
        active = false;
      };
    }

    setItems([]);
    setStatus('loading');
    setMessage(`${candidate.name} 근처 인기 장소를 찾고 있어요.`);
    setError(null);

    fetchNearbySearchResults(query, 6, 'comment')
      .then(async (results) => {
        if (!active) {
          return;
        }

        const mapped = await Promise.all(
          results.slice(0, 6).map(async (item, index) => {
            const placeKeyword = item.name || query;
            const address = item.roadAddress || item.address;
            const coordinates = await resolveCoordinates(address, query);

            return {
              id: `${cacheKey}:${index}`,
              rank: index + 1,
              name: item.name || `${candidate.name} ${normalizedDetailQuery}`,
              description:
                item.description ||
                item.categoryPath ||
                `${candidate.name} 근처 ${normalizedDetailQuery} 추천`,
              categoryPath: item.categoryPath,
              address: item.address,
              roadAddress: item.roadAddress,
              link: buildNaverMapSearchLink(placeKeyword),
              naverSearchLink: buildNaverMapSearchLink(placeKeyword),
              reservationSearchLink: buildNaverMapReservationLink(placeKeyword),
              coordinates,
            } satisfies ContentRecommendationItem;
          }),
        );

        if (!active) {
          return;
        }

        recommendationCache.set(cacheKey, mapped);
        setItems(mapped);
        setStatus('ready');
        setMessage(
          mapped.length
            ? `${candidate.name} 근처에서 유명한 곳부터 보여드리고 있어요.`
            : `${candidate.name} 근처 결과를 아직 찾지 못했어요.`,
        );
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setItems([]);
        setStatus('error');
        setError(
          nextError instanceof Error
            ? nextError.message
            : '추천 결과를 불러오지 못했어요.',
        );
        setMessage(null);
      });

    return () => {
      active = false;
    };
  }, [candidate, category, normalizedDetailQuery, cacheKey, query]);

  return {
    items,
    status,
    message,
    error,
    query,
  };
}
