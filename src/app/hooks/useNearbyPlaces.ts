import { useEffect, useMemo, useState } from 'react';
import { Candidate, MeetCategoryKey, NearbyPlace, NearbyPlaceCategory, NearbyPlaceSection } from '../types';
import { fetchNearbySearchResults, NearbySearchDefinition } from '../lib/naver-local-search';
import { buildNaverMapSearchLink } from '../lib/naver-links';
import { fetchAiPlaceRanking, reorderPlacesByIds } from '../lib/ai-place-recommendations';
import { getPreferredPlaceCandidates, isLargeFranchisePlace } from '../lib/place-quality';

type NearbyPlacesStatus = 'idle' | 'loading' | 'ready' | 'error';

interface UseNearbyPlacesResult {
  sections: NearbyPlaceSection[];
  status: NearbyPlacesStatus;
  error: string | null;
  message: string | null;
}

interface CachedNearbyPlacesResult {
  sections: NearbyPlaceSection[];
  message: string | null;
}

const nearbyPlacesCache = new Map<string, CachedNearbyPlacesResult>();
const nearbySearchPresets: Record<MeetCategoryKey, NearbySearchDefinition[]> = {
  dining: [
    { key: 'restaurant', label: '맛집', query: '맛집' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'landmark', label: '동네명소', query: '명소' },
    { key: 'activity', label: '놀거리', query: '놀거리' },
  ],
  cafe: [
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'landmark', label: '동네명소', query: '가볼만한곳' },
    { key: 'restaurant', label: '브런치', query: '브런치' },
    { key: 'activity', label: '산책', query: '산책' },
  ],
  drink: [
    { key: 'restaurant', label: '술집', query: '술집' },
    { key: 'landmark', label: '동네명소', query: '핫플' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'activity', label: '2차', query: '놀거리' },
  ],
  date: [
    { key: 'restaurant', label: '레스토랑', query: '분위기 좋은 레스토랑' },
    { key: 'cafe', label: '디저트', query: '디저트 카페' },
    { key: 'activity', label: '전시/공방', query: '전시 공방' },
    { key: 'landmark', label: '산책/뷰', query: '산책 명소' },
  ],
  culture: [
    { key: 'landmark', label: '동네명소', query: '명소' },
    { key: 'activity', label: '전시·산책', query: '전시' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'restaurant', label: '맛집', query: '맛집' },
  ],
  activity: [
    { key: 'activity', label: '놀거리', query: '놀거리' },
    { key: 'landmark', label: '동네명소', query: '가볼만한곳' },
    { key: 'restaurant', label: '맛집', query: '맛집' },
    { key: 'cafe', label: '카페', query: '카페' },
  ],
};

function buildNearbyCacheKey(
  candidate: Candidate,
  selectedCategory: MeetCategoryKey,
  groupGenderContext: string,
) {
  return `${candidate.id}:${selectedCategory}:ai-v4-date:${groupGenderContext}`;
}

function getAiNearbyCategory(definition: NearbySearchDefinition) {
  if (definition.key === 'landmark') {
    return 'culture';
  }

  return definition.key;
}

async function buildNearbySection(
  candidate: Candidate,
  selectedCategory: MeetCategoryKey,
  definition: NearbySearchDefinition,
  groupGenderContext: string,
) {
  const searchQuery = `${candidate.name} ${definition.query}`;
  const detailQuery = definition.query || definition.label;
  const results = await fetchNearbySearchResults(searchQuery, 8);

  const items = results.map((result, index) => {
    return {
      id: `${candidate.id}:${definition.key}:${index}:${result.name}`,
      name: result.name || `${candidate.name} ${definition.label}`,
      category: definition.key,
      label: definition.label,
      query: searchQuery,
      description:
        result.description || result.categoryPath || `${candidate.name} 근처 ${definition.label}`,
      categoryPath: result.categoryPath,
      address: result.address,
      roadAddress: result.roadAddress,
      link: buildNaverMapSearchLink(result.name || searchQuery),
      coordinates: result.coordinates ?? null,
    } satisfies NearbyPlace;
  });

  const aiCategory = getAiNearbyCategory(definition);
  const preferredItems = getPreferredPlaceCandidates(items, {
    category: aiCategory,
    detailQuery,
    meetCategory: selectedCategory,
    groupGenderContext,
    minimumIndependent: 3,
  });
  const independentItems = preferredItems.filter((item) => !isLargeFranchisePlace(item));
  const rankingItems = independentItems.length >= 3 ? independentItems : preferredItems;
  let rankedItems = rankingItems.slice(0, 3);

  try {
    const ranking = await fetchAiPlaceRanking(
      {
        candidate: {
          name: candidate.name,
          district: candidate.district,
        },
        category: aiCategory,
        detailQuery,
        meetCategory: selectedCategory,
        groupGenderContext,
      },
      rankingItems,
      3,
    );

    rankedItems = reorderPlacesByIds(rankingItems, ranking.itemIds, 3);
  } catch {
    rankedItems = rankingItems.slice(0, 3);
  }

  return {
    key: definition.key,
    label: definition.label,
    query: searchQuery,
    items: rankedItems,
  } satisfies NearbyPlaceSection;
}

async function buildNearbySections(
  candidate: Candidate,
  selectedCategory: MeetCategoryKey,
  groupGenderContext: string,
) {
  const definitions = nearbySearchPresets[selectedCategory] ?? nearbySearchPresets.dining;

  const sections = await Promise.all(
    definitions.map((definition) =>
      buildNearbySection(candidate, selectedCategory, definition, groupGenderContext),
    ),
  );

  return sections.filter((section) => section.items.length > 0);
}

export function getDefaultNearbyCategory(selectedCategory: MeetCategoryKey): NearbyPlaceCategory {
  return (nearbySearchPresets[selectedCategory] ?? nearbySearchPresets.dining)[0].key;
}

export function useNearbyPlaces(
  candidate: Candidate | null,
  selectedCategory: MeetCategoryKey,
  enabled = false,
  groupGenderContext = '',
): UseNearbyPlacesResult {
  const cacheKey = useMemo(
    () => (candidate ? buildNearbyCacheKey(candidate, selectedCategory, groupGenderContext) : ''),
    [candidate, groupGenderContext, selectedCategory],
  );

  const cached = cacheKey ? nearbyPlacesCache.get(cacheKey) : null;
  const [sections, setSections] = useState<NearbyPlaceSection[]>(cached?.sections ?? []);
  const [status, setStatus] = useState<NearbyPlacesStatus>(cached ? 'ready' : 'idle');
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(cached?.message ?? null);

  useEffect(() => {
    let active = true;

    if (!candidate) {
      setSections([]);
      setStatus('idle');
      setError(null);
      setMessage(null);
      return () => {
        active = false;
      };
    }

    const currentCached = nearbyPlacesCache.get(cacheKey);
    if (currentCached) {
      setSections(currentCached.sections);
      setStatus('ready');
      setError(null);
      setMessage(currentCached.message);
      return () => {
        active = false;
      };
    }

    if (!enabled) {
      setSections([]);
      setStatus('idle');
      setError(null);
      setMessage('궁금할 때만 근처 정보를 불러올게요.');
      return () => {
        active = false;
      };
    }

    setStatus('loading');
    setError(null);
    setMessage(`${candidate.name} 근처 정보를 찾는 중이에요.`);

    buildNearbySections(candidate, selectedCategory, groupGenderContext)
      .then((nextSections) => {
        if (!active) {
          return;
        }

        const nextMessage = nextSections.length
          ? `${candidate.name} 근처에서 모임에 어울리는 곳을 정리했어요.`
          : `${candidate.name} 근처에서 바로 보여줄 정보를 아직 찾지 못했어요.`;

        nearbyPlacesCache.set(cacheKey, {
          sections: nextSections,
          message: nextMessage,
        });

        setSections(nextSections);
        setStatus('ready');
        setError(null);
        setMessage(nextMessage);
      })
      .catch((nextError) => {
        if (!active) {
          return;
        }

        setSections([]);
        setStatus('error');
        setError(
          nextError instanceof Error ? nextError.message : '근처 정보를 불러오지 못했습니다.',
        );
        setMessage(null);
      });

    return () => {
      active = false;
    };
  }, [cacheKey, candidate, selectedCategory, enabled, groupGenderContext]);

  return {
    sections,
    status,
    error,
    message,
  };
}
