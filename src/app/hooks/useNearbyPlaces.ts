import { useEffect, useMemo, useState } from 'react';
import { Candidate, MeetCategoryKey, NearbyPlace, NearbyPlaceCategory, NearbyPlaceSection } from '../types';
import { fetchNearbySearchResults, NearbySearchDefinition } from '../lib/naver-local-search';
import { searchAddress } from '../lib/naver-map';

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
const nearbyPlaceCoordinateCache = new Map<string, NearbyPlace['coordinates']>();

const nearbySearchPresets: Record<MeetCategoryKey, NearbySearchDefinition[]> = {
  dining: [
    { key: 'restaurant', label: '맛집', query: '맛집' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'activity', label: '놀거리', query: '놀거리' },
  ],
  cafe: [
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'restaurant', label: '브런치', query: '브런치' },
    { key: 'activity', label: '산책', query: '산책' },
  ],
  drink: [
    { key: 'restaurant', label: '술집', query: '술집' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'activity', label: '2차', query: '놀거리' },
  ],
  date: [
    { key: 'restaurant', label: '분위기 맛집', query: '맛집' },
    { key: 'cafe', label: '데이트 카페', query: '카페' },
    { key: 'activity', label: '데이트 코스', query: '놀거리' },
  ],
  culture: [
    { key: 'activity', label: '전시·산책', query: '전시' },
    { key: 'cafe', label: '카페', query: '카페' },
    { key: 'restaurant', label: '맛집', query: '맛집' },
  ],
  activity: [
    { key: 'activity', label: '놀거리', query: '놀거리' },
    { key: 'restaurant', label: '맛집', query: '맛집' },
    { key: 'cafe', label: '카페', query: '카페' },
  ],
};

function buildNearbyCacheKey(candidate: Candidate, selectedCategory: MeetCategoryKey) {
  return `${candidate.id}:${selectedCategory}`;
}

async function resolvePlaceCoordinates(address: string, fallbackQuery: string) {
  const cacheKey = `${address}:${fallbackQuery}`;

  if (nearbyPlaceCoordinateCache.has(cacheKey)) {
    return nearbyPlaceCoordinateCache.get(cacheKey) ?? null;
  }

  try {
    const results = await searchAddress(address || fallbackQuery);
    const coordinates = results[0]?.coordinates ?? null;
    nearbyPlaceCoordinateCache.set(cacheKey, coordinates);
    return coordinates;
  } catch {
    nearbyPlaceCoordinateCache.set(cacheKey, null);
    return null;
  }
}

async function buildNearbySections(candidate: Candidate, selectedCategory: MeetCategoryKey) {
  const definitions = nearbySearchPresets[selectedCategory] ?? nearbySearchPresets.dining;

  const sections = await Promise.all(
    definitions.map(async (definition) => {
      const searchQuery = `${candidate.name} ${definition.query}`;
      const results = await fetchNearbySearchResults(searchQuery, 4);

      const items = await Promise.all(
        results.slice(0, 3).map(async (result, index) => {
          const placeAddress = result.roadAddress || result.address;
          const coordinates = await resolvePlaceCoordinates(placeAddress, searchQuery);

          const item: NearbyPlace = {
            id: `${candidate.id}:${definition.key}:${index}:${result.name}`,
            name: result.name || `${candidate.name} ${definition.label}`,
            category: definition.key,
            label: definition.label,
            query: searchQuery,
            description: result.description || result.categoryPath || `${candidate.name} 근처 ${definition.label}`,
            categoryPath: result.categoryPath,
            address: result.address,
            roadAddress: result.roadAddress,
            link: result.link,
            coordinates,
          };

          return item;
        }),
      );

      return {
        key: definition.key,
        label: definition.label,
        query: searchQuery,
        items,
      } satisfies NearbyPlaceSection;
    }),
  );

  return sections.filter((section) => section.items.length > 0);
}

export function getDefaultNearbyCategory(selectedCategory: MeetCategoryKey): NearbyPlaceCategory {
  return (nearbySearchPresets[selectedCategory] ?? nearbySearchPresets.dining)[0].key;
}

export function useNearbyPlaces(
  candidate: Candidate | null,
  selectedCategory: MeetCategoryKey,
): UseNearbyPlacesResult {
  const cacheKey = useMemo(
    () => (candidate ? buildNearbyCacheKey(candidate, selectedCategory) : ''),
    [candidate, selectedCategory],
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

    setStatus('loading');
    setError(null);
    setMessage(`${candidate.name} 근처 정보를 찾는 중이에요.`);

    buildNearbySections(candidate, selectedCategory)
      .then((nextSections) => {
        if (!active) {
          return;
        }

        const nextMessage = nextSections.length
          ? `${candidate.name} 근처에서 바로 볼 수 있는 곳을 묶어왔어요.`
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
  }, [cacheKey, candidate, selectedCategory]);

  return {
    sections,
    status,
    error,
    message,
  };
}
