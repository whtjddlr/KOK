import { Candidate, MeetCategoryKey, RuntimeAiConfig } from '../types';

export interface AiPlaceCandidate {
  id: string;
  name: string;
  description?: string;
  categoryPath?: string;
  address?: string;
  roadAddress?: string;
}

export interface AiPlaceRankingContext {
  candidate: Pick<Candidate, 'name' | 'district'>;
  category: string;
  detailQuery: string;
  meetCategory?: MeetCategoryKey | string;
  userVibe?: string;
  favoriteKeywords?: string[];
  groupGenderContext?: string;
  runtimeAiConfig?: RuntimeAiConfig | null;
}

interface AiPlaceRankingResponse {
  itemIds?: string[];
  source?: string;
  message?: string;
}

export async function fetchAiPlaceRanking(
  context: AiPlaceRankingContext,
  items: AiPlaceCandidate[],
  limit = 6,
) {
  if (!items.length) {
    return {
      itemIds: [] as string[],
      source: 'empty',
      message: '추천 후보가 아직 없어요.',
    };
  }

  const response = await fetch('/api/content-recommendations', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...context,
      meetCategory: context.meetCategory ?? context.category,
      limit,
      items,
    }),
  });
  const data = (await response.json().catch(() => null)) as AiPlaceRankingResponse | null;

  if (!response.ok) {
    throw new Error(data?.message ?? 'AI 장소 추천을 불러오지 못했어요.');
  }

  if (!data) {
    throw new Error('AI 장소 추천을 불러오지 못했어요.');
  }

  return {
    itemIds: Array.isArray(data.itemIds)
      ? data.itemIds.filter((id): id is string => typeof id === 'string')
      : [],
    source: data.source ?? 'heuristic',
    message: data.message ?? null,
  };
}

export function reorderPlacesByIds<T extends { id: string }>(items: T[], itemIds: string[], limit: number) {
  const itemById = new Map(items.map((item) => [item.id, item]));
  const ordered: T[] = [];
  const usedIds = new Set<string>();

  itemIds.forEach((itemId) => {
    const item = itemById.get(itemId);

    if (!item || usedIds.has(itemId)) {
      return;
    }

    ordered.push(item);
    usedIds.add(itemId);
  });

  items.forEach((item) => {
    if (usedIds.has(item.id)) {
      return;
    }

    ordered.push(item);
    usedIds.add(item.id);
  });

  return ordered.slice(0, limit);
}
