import { useEffect, useMemo, useState } from 'react';
import { Candidate, Coordinates, MeetCategoryKey, RuntimeAiConfig } from '../types';
import { fetchNearbySearchResults } from '../lib/naver-local-search';
import { searchAddress } from '../lib/naver-map';
import { buildNaverMapReservationLink, buildNaverMapSearchLink } from '../lib/naver-links';
import { fetchAiPlaceRanking, reorderPlacesByIds } from '../lib/ai-place-recommendations';
import {
  getPlaceQualityHighlights,
  getPreferredPlaceCandidates,
  isLargeFranchisePlace,
} from '../lib/place-quality';

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
  highlights: string[];
}

interface UseContentRecommendationsResult {
  items: ContentRecommendationItem[];
  status: 'idle' | 'loading' | 'ready' | 'error';
  message: string | null;
  error: string | null;
  query: string;
}

interface UseContentRecommendationsOptions {
  selectedMeetCategory?: MeetCategoryKey;
  userVibe?: string;
  favoriteKeywords?: string[];
  groupGenderContext?: string;
  runtimeAiConfig?: RuntimeAiConfig | null;
}

const recommendationCache = new Map<string, ContentRecommendationItem[]>();
const recommendationCoordinateCache = new Map<string, Coordinates | null>();

function getGroupGenderCounts(groupGenderContext = '') {
  const female = Number(groupGenderContext.match(/여성\s*(\d+)명/)?.[1] ?? 0);
  const male = Number(groupGenderContext.match(/남성\s*(\d+)명/)?.[1] ?? 0);
  const total = Number(groupGenderContext.match(/총\s*(\d+)명/)?.[1] ?? female + male);

  return { female, male, total };
}

function isMaleLeaningGroup(groupGenderContext = '') {
  if (!groupGenderContext) {
    return false;
  }

  if (groupGenderContext.includes('남성 중심')) {
    return true;
  }

  const { female, male, total } = getGroupGenderCounts(groupGenderContext);
  const knownBinaryTotal = female + male;
  const denominator = knownBinaryTotal || total;

  return male >= 2 && denominator > 0 && male / denominator >= 0.6;
}

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

const dateContentDetailOverrides: Record<ContentCategoryKey, string[]> = {
  restaurant: ['분위기 좋은 레스토랑', '파스타', '브런치', '오마카세', '다이닝', '스테이크'],
  cafe: ['디저트 카페', '베이커리', '감성 카페', '뷰 좋은 카페', '케이크', '젤라또'],
  drink: ['와인바', '칵테일바', '이자카야', '루프탑 바', '재즈바', '위스키바'],
  culture: ['전시', '갤러리', '소품샵', '공방', '산책 코스', '복합문화공간'],
  activity: ['전시 데이트', '공방', '영화', '보드게임', '산책', '소품샵'],
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
  preferenceSignature: string,
) {
  return `${candidateId}:${category}:${detailQuery.trim().toLowerCase()}:quality-v3-date:${preferenceSignature}`;
}

function cleanQuerySegment(value: string) {
  return value.trim().replace(/\s+/g, ' ');
}

function normalizeRecommendationIdentity(value: string) {
  return cleanQuerySegment(value)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function getRecommendationIdentityKey(input: {
  name: string;
  address?: string;
  roadAddress?: string;
  categoryPath?: string;
}) {
  const name = normalizeRecommendationIdentity(input.name);
  const address = normalizeRecommendationIdentity(input.roadAddress || input.address || '');
  const categoryPath = normalizeRecommendationIdentity(input.categoryPath || '');

  if (name && address) {
    return `${name}:${address}`;
  }

  return [name, categoryPath].filter(Boolean).join(':');
}

function dedupeRecommendationItems<T extends {
  name: string;
  address?: string;
  roadAddress?: string;
  categoryPath?: string;
}>(items: T[]) {
  const seen = new Set<string>();

  return items.filter((item) => {
    const key = getRecommendationIdentityKey(item);

    if (!key || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function buildPreferenceSignature(input: {
  selectedMeetCategory?: MeetCategoryKey;
  userVibe: string;
  favoriteKeywords: string[];
  groupGenderContext: string;
  runtimeAiConfig: RuntimeAiConfig | null;
}) {
  return JSON.stringify({
    meet: input.selectedMeetCategory ?? '',
    vibe: input.userVibe,
    keywords: input.favoriteKeywords,
    gender: input.groupGenderContext,
    aiProvider: input.runtimeAiConfig?.provider ?? '',
    aiModel: input.runtimeAiConfig?.model ?? '',
    aiBaseUrl: input.runtimeAiConfig?.baseUrl ?? '',
  });
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

export function getContentCategoryDetails(
  category: ContentCategoryKey,
  selectedMeetCategory?: MeetCategoryKey,
  groupGenderContext = '',
) {
  if (selectedMeetCategory === 'date') {
    return dateContentDetailOverrides[category] ?? contentCategoryDefinitions[category].details;
  }

  if (category === 'activity' && selectedMeetCategory === 'activity' && isMaleLeaningGroup(groupGenderContext)) {
    return [
      'PC방',
      '당구',
      '스크린야구',
      '보드게임',
      '볼링',
      '오락실',
      ...contentCategoryDefinitions[category].details,
    ].filter((detail, index, details) => details.indexOf(detail) === index);
  }

  return contentCategoryDefinitions[category].details;
}

export function getRandomCategoryDetail(
  category: ContentCategoryKey,
  selectedMeetCategory?: MeetCategoryKey,
  groupGenderContext = '',
) {
  const details = getContentCategoryDetails(category, selectedMeetCategory, groupGenderContext);
  return details[Math.floor(Math.random() * details.length)] ?? '';
}

function hasDateSearchSignal(value: string) {
  return [
    '데이트',
    '분위기',
    '감성',
    '레스토랑',
    '다이닝',
    '와인',
    '브런치',
    '전시',
    '갤러리',
    '산책',
    '디저트',
    '베이커리',
    '뷰',
    '공방',
    '오마카세',
  ].some((keyword) => value.includes(keyword));
}

function buildRecommendationQuery(
  candidateName: string,
  category: ContentCategoryKey,
  detailQuery: string,
  selectedMeetCategory?: MeetCategoryKey,
) {
  if (selectedMeetCategory !== 'date') {
    return `${candidateName} ${detailQuery}`;
  }

  if (category === 'restaurant' && !hasDateSearchSignal(detailQuery)) {
    return `${candidateName} 분위기 좋은 ${detailQuery}`;
  }

  if (category === 'cafe' && !hasDateSearchSignal(detailQuery)) {
    return `${candidateName} 데이트 ${detailQuery}`;
  }

  return `${candidateName} ${detailQuery}`;
}

function buildRecommendationQueries(
  candidateName: string,
  category: ContentCategoryKey,
  detailQuery: string,
  selectedMeetCategory?: MeetCategoryKey,
  groupGenderContext = '',
) {
  const primary = buildRecommendationQuery(
    candidateName,
    category,
    detailQuery,
    selectedMeetCategory,
  );
  const fallbackDetails: Record<ContentCategoryKey, string[]> = {
    restaurant:
      selectedMeetCategory === 'date'
        ? ['데이트 맛집', '분위기 좋은 레스토랑', '파스타', '브런치']
        : ['맛집', '음식점', '한식', '고기'],
    cafe:
      selectedMeetCategory === 'date'
        ? ['데이트 카페', '디저트 카페', '베이커리', '감성 카페']
        : ['카페', '디저트', '베이커리'],
    drink: ['술집', '이자카야', '와인바', '칵테일바'],
    culture:
      selectedMeetCategory === 'date'
        ? ['데이트 코스', '전시', '갤러리', '소품샵']
        : ['전시', '문화공간', '가볼만한곳'],
    activity: isMaleLeaningGroup(groupGenderContext)
      ? ['PC방', '보드게임', '볼링', '오락실', '방탈출']
      : ['놀거리', '보드게임', '방탈출', '영화', '볼링'],
  };
  const queries = [
    primary,
    ...fallbackDetails[category].map((detail) => `${candidateName} ${detail}`),
  ];

  return queries
    .map(cleanQuerySegment)
    .filter((query, index, list) => query && list.indexOf(query) === index)
    .slice(0, 5);
}

async function fetchRecommendationResults(queries: string[]) {
  const seen = new Set<string>();
  const collected: Awaited<ReturnType<typeof fetchNearbySearchResults>> = [];

  for (const searchQuery of queries) {
    const results = await fetchNearbySearchResults(searchQuery, 10, 'comment');

    results.forEach((result) => {
      const key = getRecommendationIdentityKey(result);

      if (!key || seen.has(key)) {
        return;
      }

      seen.add(key);
      collected.push(result);
    });

    if (collected.length >= 20) {
      break;
    }
  }

  return collected.slice(0, 20);
}

export function useContentRecommendations(
  candidate: Candidate | null,
  category: ContentCategoryKey | null,
  detailQuery: string,
  options: UseContentRecommendationsOptions = {},
): UseContentRecommendationsResult {
  const normalizedDetailQuery = useMemo(() => cleanQuerySegment(detailQuery), [detailQuery]);
  const selectedMeetCategory = options.selectedMeetCategory;
  const userVibe = cleanQuerySegment(options.userVibe ?? '');
  const favoriteKeywords = useMemo(
    () =>
      (options.favoriteKeywords ?? [])
        .map((keyword) => cleanQuerySegment(keyword))
        .filter(Boolean),
    [options.favoriteKeywords],
  );
  const runtimeAiConfig = options.runtimeAiConfig ?? null;
  const groupGenderContext = cleanQuerySegment(options.groupGenderContext ?? '');
  const preferenceSignature = useMemo(
    () =>
      buildPreferenceSignature({
        selectedMeetCategory,
        userVibe,
        favoriteKeywords,
        groupGenderContext,
        runtimeAiConfig,
      }),
    [
      selectedMeetCategory,
      userVibe,
      favoriteKeywords,
      groupGenderContext,
      runtimeAiConfig?.provider,
      runtimeAiConfig?.model,
      runtimeAiConfig?.baseUrl,
    ],
  );
  const query = useMemo(() => {
    if (!candidate || !category || !normalizedDetailQuery) {
      return '';
    }

    return buildRecommendationQuery(
      candidate.name,
      category,
      normalizedDetailQuery,
      selectedMeetCategory,
    );
  }, [candidate, category, normalizedDetailQuery, selectedMeetCategory]);

  const cacheKey = useMemo(() => {
    if (!candidate || !category || !normalizedDetailQuery) {
      return '';
    }

    return buildRecommendationCacheKey(
      candidate.id,
      category,
      normalizedDetailQuery,
      preferenceSignature,
    );
  }, [candidate, category, normalizedDetailQuery, preferenceSignature]);

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
    setMessage(`${candidate.name} 근처에서 모임에 어울리는 장소를 찾고 있어요.`);
    setError(null);

    const searchQueries = buildRecommendationQueries(
      candidate.name,
      category,
      normalizedDetailQuery,
      selectedMeetCategory,
      groupGenderContext,
    );

    fetchRecommendationResults(searchQueries)
      .then(async (results) => {
        if (!active) {
          return;
        }

        const mappedCandidates = dedupeRecommendationItems(await Promise.all(
          results.slice(0, 20).map(async (item, index) => {
            const placeKeyword = item.name || query;
            const address = item.roadAddress || item.address;
            const coordinates = item.coordinates ?? (await resolveCoordinates(address, query));

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
              highlights: [],
            } satisfies ContentRecommendationItem;
          }),
        ));

        if (!active) {
          return;
        }

        const preferredCandidates = getPreferredPlaceCandidates(mappedCandidates, {
          category,
          detailQuery: normalizedDetailQuery,
          meetCategory: selectedMeetCategory ?? category,
          groupGenderContext,
          minimumIndependent: 5,
        });
        const independentCandidates = preferredCandidates.filter(
          (item) => !isLargeFranchisePlace(item),
        );
        const rankingCandidates =
          independentCandidates.length >= 8 ? independentCandidates : preferredCandidates;
        let rankingMessage: string | null = null;
        let rankedItems = rankingCandidates.slice(0, 10);

        try {
          const ranking = await fetchAiPlaceRanking(
            {
              candidate: {
                name: candidate.name,
                district: candidate.district,
              },
              category,
              detailQuery: normalizedDetailQuery,
              meetCategory: selectedMeetCategory ?? category,
              userVibe,
              favoriteKeywords,
              groupGenderContext,
              runtimeAiConfig,
            },
            rankingCandidates,
            10,
          );

          rankingMessage = ranking.message;
          rankedItems = reorderPlacesByIds(rankingCandidates, ranking.itemIds, 10);
        } catch {
          rankedItems = rankingCandidates.slice(0, 10);
        }

        if (!active) {
          return;
        }

        const nextItems = dedupeRecommendationItems(rankedItems).map((item, index) => ({
          ...item,
          rank: index + 1,
          highlights: getPlaceQualityHighlights(item, {
            category,
            detailQuery: normalizedDetailQuery,
            meetCategory: selectedMeetCategory ?? category,
            groupGenderContext,
            favoriteKeywords,
          }),
        }));

        recommendationCache.set(cacheKey, nextItems);
        setItems(nextItems);
        setStatus('ready');
        setMessage(
          nextItems.length
            ? rankingMessage ?? `${candidate.name} 근처에서 모임에 어울리는 순서로 정리했어요.`
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
  }, [
    candidate,
    category,
    normalizedDetailQuery,
    cacheKey,
    query,
    selectedMeetCategory,
    userVibe,
    favoriteKeywords,
    groupGenderContext,
    runtimeAiConfig,
  ]);

  return {
    items,
    status,
    message,
    error,
    query,
  };
}
