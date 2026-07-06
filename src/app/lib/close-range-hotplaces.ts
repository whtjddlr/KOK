import type { NearbySearchItem } from './naver-local-search';
import {
  getPlaceQualityScore,
  getPreferredPlaceCandidates,
  isLargeFranchisePlace,
} from './place-quality';
import { getCloseParticipantContext, getDistanceKm } from './meeting';
import type { Candidate, Coordinates, MeetCategoryKey, Participant } from '../types';

const ALL_MEET_CATEGORIES: MeetCategoryKey[] = [
  'dining',
  'cafe',
  'drink',
  'date',
  'culture',
  'activity',
];
const CLOSE_HOTPLACE_EXPANSION_KM = 3.2;
const HOTPLACE_CLUSTER_RADIUS_KM = 0.5;
const HOTPLACE_MIN_CLUSTER_SIZE = 3;
const HOTPLACE_MAX_CANDIDATES = 3;

interface HotplaceSearchItemWithQuery extends NearbySearchItem {
  query: string;
}

interface ScoredHotplaceSearchItem extends HotplaceSearchItemWithQuery {
  qualityScore: number;
}

interface HotplaceCluster {
  items: ScoredHotplaceSearchItem[];
  coordinates: Coordinates;
  qualityScore: number;
  token: string;
}

export interface BuildHotplaceCandidatesOptions {
  participants: Participant[];
  selectedCategory?: MeetCategoryKey;
  itemsByQuery: Record<string, NearbySearchItem[]>;
}

function getParticipantCenter(participants: Participant[]) {
  if (!participants.length) {
    return null;
  }

  return {
    lat:
      participants.reduce((sum, participant) => sum + participant.coordinates.lat, 0) /
      participants.length,
    lng:
      participants.reduce((sum, participant) => sum + participant.coordinates.lng, 0) /
      participants.length,
  };
}

function createLocalCandidateCategories(selectedCategory?: MeetCategoryKey) {
  if (!selectedCategory) {
    return ALL_MEET_CATEGORIES;
  }

  return [...new Set<MeetCategoryKey>([selectedCategory, 'dining', 'cafe', 'drink'])];
}

function normalizeHotplaceToken(value: string) {
  return value
    .replace(/\([^)]*\)/g, ' ')
    .replace(/[^\p{L}\p{N}\s·.-]/gu, ' ')
    .split(/\s+/)
    .map((token) =>
      token
        .trim()
        .replace(/^(서울|서울시|서울특별시|경기|경기도|인천|인천시|인천광역시)$/u, '')
        .replace(/(역|주변|근처)$/u, ''),
    )
    .filter((token) => token.length >= 2 && !/^[가-힣]+(시|군|구)$/u.test(token));
}

function pushUnique(items: string[], value: string) {
  if (value && !items.includes(value)) {
    items.push(value);
  }
}

function getLocationTokens(participants: Participant[]) {
  const tokens: string[] = [];

  participants.forEach((participant) => {
    const rawTokens = normalizeHotplaceToken(participant.location);

    if (rawTokens.length) {
      pushUnique(tokens, rawTokens[rawTokens.length - 1]);
    }

    if (rawTokens.length >= 2) {
      pushUnique(tokens, rawTokens[rawTokens.length - 2]);
    }
  });

  return tokens.slice(0, 4);
}

function getCategoryKeywords(selectedCategory?: MeetCategoryKey) {
  if (selectedCategory === 'cafe') {
    return ['카페', '디저트'];
  }

  if (selectedCategory === 'drink') {
    return ['술집', '맛집'];
  }

  if (selectedCategory === 'culture' || selectedCategory === 'activity') {
    return ['놀거리', '카페'];
  }

  if (selectedCategory === 'date') {
    return ['맛집', '카페'];
  }

  return ['맛집', '카페'];
}

export function buildCloseRangeHotplaceQueries(
  participants: Participant[],
  selectedCategory?: MeetCategoryKey,
) {
  const tokens = getLocationTokens(participants);
  const keywords = getCategoryKeywords(selectedCategory);
  const queries: string[] = [];

  tokens.forEach((token) => {
    keywords.forEach((keyword) => {
      pushUnique(queries, `${token} ${keyword}`);
    });
  });

  return queries.slice(0, 4);
}

function getSearchCategory(selectedCategory?: MeetCategoryKey) {
  if (selectedCategory === 'cafe') {
    return 'cafe';
  }

  if (selectedCategory === 'drink') {
    return 'drink';
  }

  return 'restaurant';
}

// 품질 점수는 전역 카테고리가 아니라 각 검색 쿼리의 키워드 기준으로 매긴다.
// "○○ 카페"로 검색한 결과를 restaurant 기준으로 점수 매기면
// 카테고리 불일치 감점 때문에 정상적인 카페들이 전부 탈락한다.
function getQueryKeywordCategory(query: string, selectedCategory?: MeetCategoryKey) {
  if (/(카페|디저트)$/u.test(query.trim())) {
    return 'cafe';
  }

  if (/놀거리$/u.test(query.trim())) {
    return 'activity';
  }

  if (/술집$/u.test(query.trim())) {
    return getSearchCategory(selectedCategory === 'drink' ? 'drink' : selectedCategory);
  }

  return 'restaurant';
}

function getItemQualityScore(
  item: HotplaceSearchItemWithQuery,
  selectedCategory: MeetCategoryKey | undefined,
) {
  return getPlaceQualityScore(
    item,
    getQueryKeywordCategory(item.query, selectedCategory),
    item.query,
    selectedCategory,
  );
}

function getUniquePlaceKey(item: NearbySearchItem) {
  return [
    item.name.trim().toLowerCase(),
    item.roadAddress.trim().toLowerCase() || item.address.trim().toLowerCase(),
  ].join('|');
}

function getClusterCenter(items: ScoredHotplaceSearchItem[]) {
  return {
    lat:
      items.reduce((sum, item) => sum + (item.coordinates?.lat ?? 0), 0) /
      items.length,
    lng:
      items.reduce((sum, item) => sum + (item.coordinates?.lng ?? 0), 0) /
      items.length,
  };
}

function extractAreaTokens(value: string) {
  const tokens = value
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);

  return tokens.filter((token) => /^[가-힣0-9A-Za-z]+(동|가|로|길)$/u.test(token));
}

function getMostCommonToken(tokens: string[]) {
  const counts = new Map<string, number>();

  tokens.forEach((token) => {
    counts.set(token, (counts.get(token) ?? 0) + 1);
  });

  return [...counts.entries()].sort((left, right) => {
    if (right[1] !== left[1]) {
      return right[1] - left[1];
    }

    return left[0].localeCompare(right[0]);
  })[0]?.[0] ?? '';
}

function getClusterToken(cluster: HotplaceCluster) {
  const addressTokens = cluster.items.flatMap((item) =>
    extractAreaTokens(item.roadAddress || item.address),
  );
  const queryTokens = cluster.items.flatMap((item) => normalizeHotplaceToken(item.query));

  return getMostCommonToken(addressTokens) || getMostCommonToken(queryTokens) || '근처';
}

function normalizeSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^\p{L}\p{N}-]/gu, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');

  return slug || 'area';
}

function buildClusters(items: ScoredHotplaceSearchItem[]) {
  const unassigned = [...items];
  const clusters: HotplaceCluster[] = [];

  while (unassigned.length) {
    const seed = unassigned.shift();

    if (!seed?.coordinates) {
      continue;
    }

    const clusterItems = [seed];

    for (let index = unassigned.length - 1; index >= 0; index -= 1) {
      const next = unassigned[index];

      if (
        next.coordinates &&
        getDistanceKm(seed.coordinates, next.coordinates) <= HOTPLACE_CLUSTER_RADIUS_KM
      ) {
        clusterItems.push(next);
        unassigned.splice(index, 1);
      }
    }

    if (clusterItems.length < HOTPLACE_MIN_CLUSTER_SIZE) {
      continue;
    }

    const coordinates = getClusterCenter(clusterItems);
    const qualityScore =
      clusterItems.reduce(
        (sum, item) => sum + item.qualityScore,
        0,
      ) / clusterItems.length;

    clusters.push({
      items: clusterItems,
      coordinates,
      qualityScore,
      token: '',
    });
  }

  return clusters.map((cluster) => ({
    ...cluster,
    token: getClusterToken(cluster),
  }));
}

function toHotplaceCandidate(cluster: HotplaceCluster, selectedCategory?: MeetCategoryKey): Candidate {
  const representativeNames = cluster.items
    .slice(0, 3)
    .map((item) => item.name)
    .filter(Boolean);
  const token = cluster.token;

  return {
    id: `naver-close-${normalizeSlug(token)}`,
    name: `${token} 상권`,
    district: '근거리 상권 후보',
    description:
      '참여자 위치 가까이에 실제 검색 결과가 여러 곳 모여 있는 생활권 상권 후보예요.',
    vibe: '멀리 이동하지 않고 바로 만나기 좋은 근거리 로컬 상권 무드',
    coordinates: cluster.coordinates,
    tags: ['근거리', '상권', '로컬'],
    bestFor: '가까운 사람끼리 빠르게 모여 식사, 카페, 가벼운 2차까지 이어가기',
    whyItWorks: `${token} 주변에 ${representativeNames.join(', ') || '실제 장소'}처럼 선택지가 모여 있어 합성 좌표보다 자연스럽게 고르기 좋아요.`,
    routeHint: `${token} 주변에서 만남 장소를 고르면 참여자 모두 짧게 이동하면서도 실제 갈 곳을 바로 찾기 쉬워요.`,
    drawMood: '안정 픽' as Candidate['drawMood'],
    categories: createLocalCandidateCategories(selectedCategory),
  };
}

export function buildHotplaceCandidatesFromSearchItems({
  participants,
  selectedCategory,
  itemsByQuery,
}: BuildHotplaceCandidatesOptions) {
  const center = getParticipantCenter(participants);
  const closeContext = getCloseParticipantContext(participants);

  if (!center || !closeContext.isCloseGroup) {
    return [];
  }

  const distanceLimitKm = closeContext.candidateLimitKm + CLOSE_HOTPLACE_EXPANSION_KM;
  const seenPlaceKeys = new Set<string>();
  const candidates = Object.entries(itemsByQuery)
    .flatMap(([query, items]) =>
      items.map((item) => ({
        ...item,
        query,
      })),
    )
    .filter((item) => {
      if (!item.coordinates) {
        return false;
      }

      const placeKey = getUniquePlaceKey(item);

      if (seenPlaceKeys.has(placeKey)) {
        return false;
      }

      seenPlaceKeys.add(placeKey);

      return getDistanceKm(center, item.coordinates) <= distanceLimitKm;
    })
    .filter((item) => !isLargeFranchisePlace(item))
    .map((item) => ({
      ...item,
      qualityScore: getItemQualityScore(item, selectedCategory),
    }))
    .filter((item) => item.qualityScore >= 0);
  // 쿼리 키워드 카테고리별로 나눠서 선호 필터를 적용한다 (카페 결과를
  // restaurant 기준으로 거르면 전부 탈락하는 문제 방지).
  const candidatesByCategory = new Map<string, ScoredHotplaceSearchItem[]>();

  candidates.forEach((item) => {
    const category = getQueryKeywordCategory(item.query, selectedCategory);
    candidatesByCategory.set(category, [...(candidatesByCategory.get(category) ?? []), item]);
  });

  const preferredItems = [...candidatesByCategory.entries()].flatMap(
    ([category, categoryItems]) =>
      getPreferredPlaceCandidates(categoryItems, {
        category,
        detailQuery: [...new Set(categoryItems.map((item) => item.query))].join(' '),
        meetCategory: selectedCategory,
        minimumIndependent: Math.min(HOTPLACE_MIN_CLUSTER_SIZE, categoryItems.length),
        allowRejectedFallback: false,
      }),
  );
  const clusters = buildClusters(preferredItems)
    .sort((left, right) => {
      const densityDiff = right.items.length - left.items.length;

      if (densityDiff !== 0) {
        return densityDiff;
      }

      return right.qualityScore - left.qualityScore;
    })
    .slice(0, HOTPLACE_MAX_CANDIDATES);
  const seenCandidateIds = new Set<string>();

  return clusters
    .map((cluster) => toHotplaceCandidate(cluster, selectedCategory))
    .filter((candidate) => {
      if (seenCandidateIds.has(candidate.id)) {
        return false;
      }

      seenCandidateIds.add(candidate.id);
      return true;
    });
}
