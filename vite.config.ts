import { defineConfig, loadEnv } from 'vite';
import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';

function figmaAssetResolver() {
  return {
    name: 'figma-asset-resolver',
    resolveId(id: string) {
      if (id.startsWith('figma:asset/')) {
        const filename = id.replace('figma:asset/', '');
        return path.resolve(__dirname, 'src/assets', filename);
      }
    },
  };
}

async function readJsonBody(req: AsyncIterable<Buffer | string>) {
  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');

  if (!rawBody) {
    return {};
  }

  return JSON.parse(rawBody);
}

function getCandidateScopeBonus(candidateScope: string) {
  if (candidateScope === 'max') {
    return 4;
  }

  if (candidateScope === 'wide') {
    return 2;
  }

  return 0;
}

const FAIRNESS_SPREAD_LIMIT_BY_LEVEL: Record<number, number> = {
  1: 10,
  2: 15,
  3: 20,
  4: 25,
  5: 35,
};

function getFairnessSpreadLimit(thrillLevel: number) {
  return FAIRNESS_SPREAD_LIMIT_BY_LEVEL[thrillLevel] ?? FAIRNESS_SPREAD_LIMIT_BY_LEVEL[1];
}

function getInsightSpreadDuration(insight: any) {
  return typeof insight?.spreadDuration === 'number'
    ? insight.spreadDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightFarthestDuration(insight: any) {
  return typeof insight?.farthestDuration === 'number'
    ? insight.farthestDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightAverageDuration(insight: any) {
  return typeof insight?.averageDuration === 'number'
    ? insight.averageDuration
    : Number.MAX_SAFE_INTEGER;
}

function getInsightNumber(insight: any, key: string, fallback = 0) {
  return typeof insight?.[key] === 'number' ? insight[key] : fallback;
}

function getInsightFairEfficiencyScore(insight: any, thrillLevel: number) {
  const spread = getInsightSpreadDuration(insight);
  const average = getInsightAverageDuration(insight);
  const farthest = getInsightFarthestDuration(insight);
  const overage = Math.max(0, spread - getFairnessSpreadLimit(thrillLevel));
  const longTripPenalty =
    Math.max(0, average - 48) * 0.85 + Math.max(0, farthest - 58) * 0.55;

  return (
    spread * 1.6 +
    average * 0.85 +
    farthest * 0.62 +
    getInsightNumber(insight, 'centerDistance') * 0.8 +
    getInsightNumber(insight, 'axisDistance') * 1.05 +
    longTripPenalty +
    overage * 10 +
    overage * overage * 0.75 +
    (insight?.allReachable === false ? 24 : 0) +
    (insight?.categoryMatched === false ? 6 : 0)
  );
}

function compareInsightsByFairness(left: any, right: any, thrillLevel: number) {
  const limit = getFairnessSpreadLimit(thrillLevel);
  const leftSpread = getInsightSpreadDuration(left);
  const rightSpread = getInsightSpreadDuration(right);
  const leftWithinLimit = leftSpread <= limit;
  const rightWithinLimit = rightSpread <= limit;

  if (leftWithinLimit !== rightWithinLimit) {
    return leftWithinLimit ? -1 : 1;
  }

  const scoreDiff =
    getInsightFairEfficiencyScore(left, thrillLevel) -
    getInsightFairEfficiencyScore(right, thrillLevel);

  if (Math.abs(scoreDiff) > 1) {
    return scoreDiff;
  }

  if (leftSpread !== rightSpread) {
    return leftSpread - rightSpread;
  }

  const leftFarthest = getInsightFarthestDuration(left);
  const rightFarthest = getInsightFarthestDuration(right);

  if (leftFarthest !== rightFarthest) {
    return leftFarthest - rightFarthest;
  }

  return getInsightAverageDuration(left) - getInsightAverageDuration(right);
}

function reorderCandidateIdsByFairness(
  candidateIds: string[],
  insights: any[],
  thrillLevel: number,
) {
  const orderIndex = new Map(candidateIds.map((candidateId, index) => [candidateId, index]));

  return candidateIds
    .map((candidateId) => insights.find((insight) => getInsightCandidateId(insight) === candidateId))
    .filter(Boolean)
    .sort((left, right) => {
      const fairnessDiff = compareInsightsByFairness(left, right, thrillLevel);

      if (fairnessDiff !== 0) {
        return fairnessDiff;
      }

      return (
        (orderIndex.get(getInsightCandidateId(left)) ?? Number.MAX_SAFE_INTEGER) -
        (orderIndex.get(getInsightCandidateId(right)) ?? Number.MAX_SAFE_INTEGER)
      );
    })
    .map((insight) => getInsightCandidateId(insight));
}

function pickTargetCount(
  total: number,
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  requestedTargetCount?: number,
) {
  if (typeof requestedTargetCount === 'number' && Number.isFinite(requestedTargetCount)) {
    return Math.max(1, Math.min(Math.round(requestedTargetCount), total));
  }

  const baseCount = selectionMode === 'neighborhood' ? 7 : 6;
  const thrillBonus = thrillLevel >= 5 ? 3 : thrillLevel >= 4 ? 2 : thrillLevel >= 3 ? 1 : 0;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  return Math.max(1, Math.min(baseCount + thrillBonus + scopeBonus, total));
}

function buildFallbackCandidateIds(
  insights: Array<{ candidate?: { id?: string } }>,
  fallbackCandidateIds: string[],
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  requestedTargetCount?: number,
) {
  const seen = new Set<string>();
  const allowedIds = new Set(
    insights
      .map((insight) => insight?.candidate?.id)
      .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0),
  );
  const orderedIds = [
    ...fallbackCandidateIds.filter((candidateId) => allowedIds.has(candidateId)),
    ...insights.map((insight) => insight?.candidate?.id),
  ]
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0)
    .filter((candidateId) => {
      if (seen.has(candidateId)) {
        return false;
      }

      seen.add(candidateId);
      return true;
    });

  const targetCount = pickTargetCount(
    orderedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );

  return reorderCandidateIdsByFairness(orderedIds, insights, thrillLevel).slice(0, targetCount);
}

function getInsightCandidateId(insight: any) {
  return typeof insight?.candidate?.id === 'string' ? insight.candidate.id : '';
}

function getParticipantDuration(insight: any, participant: any) {
  const participantId = typeof participant?.id === 'string' ? participant.id : '';
  const participantName = typeof participant?.name === 'string' ? participant.name : '';
  const travelInfo = Array.isArray(insight?.travelInfo) ? insight.travelInfo : [];
  const match = travelInfo.find(
    (info: any) =>
      (participantId && info?.participantId === participantId) ||
      (participantName && info?.participantName === participantName),
  );

  return typeof match?.duration === 'number' ? match.duration : Number.MAX_SAFE_INTEGER;
}

function isHouseFrontCandidateId(candidateId: string) {
  return candidateId.startsWith('thrill-hyper-');
}

function isLocalWildcardCandidateId(candidateId: string) {
  return (
    isHouseFrontCandidateId(candidateId) ||
    candidateId.startsWith('thrill-local-') ||
    candidateId.startsWith('participant-near-')
  );
}

function isParticipantLocalInsight(insight: any, participant: any) {
  const participantId = typeof participant?.id === 'string' ? participant.id : '';
  const participantName = typeof participant?.name === 'string' ? participant.name : '';
  const candidateId = getInsightCandidateId(insight);
  const tags = Array.isArray(insight?.candidate?.tags) ? insight.candidate.tags : [];

  return Boolean(
    participantName &&
      (insight?.nearestParticipantName === participantName ||
        tags.includes(participantName) ||
        (participantId &&
          (candidateId.includes(`-${participantId}-`) ||
            candidateId.endsWith(`-${participantId}`)))),
  );
}

function getParticipantLocalScore(insight: any, participant: any) {
  const duration = getParticipantDuration(insight, participant);
  const candidateId = getInsightCandidateId(insight);
  const explicitLocalBonus = isParticipantLocalInsight(insight, participant) ? -28 : 0;
  const houseFrontBonus = isHouseFrontCandidateId(candidateId) ? -18 : 0;
  const wildcardBonus = isLocalWildcardCandidateId(candidateId) ? -8 : 0;
  const nearestBonus =
    typeof participant?.name === 'string' && insight?.nearestParticipantName === participant.name
      ? -10
      : 0;

  return (
    duration * 0.78 +
    (Number(insight?.spreadDuration) || 0) * 0.72 +
    (Number(insight?.farthestDuration) || 0) * 0.24 +
    (Number(insight?.centerDistance) || 0) * 0.18 +
    explicitLocalBonus +
    houseFrontBonus +
    wildcardBonus +
    nearestBonus
  );
}

function isExplicitParticipantLocalInsight(
  insight: any,
  participant: any,
  requireHouseFront = false,
) {
  if (!isParticipantLocalInsight(insight, participant)) {
    return false;
  }

  const candidateId = getInsightCandidateId(insight);
  return requireHouseFront
    ? isHouseFrontCandidateId(candidateId)
    : isLocalWildcardCandidateId(candidateId);
}

function getParticipantLocalAnchor(
  insights: any[],
  participant: any,
  usedIds: Set<string>,
  requireHouseFront = false,
) {
  const unusedInsights = insights.filter((insight) => {
    const candidateId = getInsightCandidateId(insight);
    return candidateId && !usedIds.has(candidateId);
  });
  const preferredHouseFront = requireHouseFront
    ? unusedInsights
        .filter((insight) => isExplicitParticipantLocalInsight(insight, participant, true))
        .sort(
          (left, right) =>
            getParticipantLocalScore(left, participant) -
            getParticipantLocalScore(right, participant),
        )[0]
    : null;

  if (preferredHouseFront) {
    return preferredHouseFront;
  }

  const preferredLocalWildcard = unusedInsights
    .filter((insight) => isExplicitParticipantLocalInsight(insight, participant, false))
    .sort(
      (left, right) =>
        getParticipantLocalScore(left, participant) -
        getParticipantLocalScore(right, participant),
    )[0];

  if (preferredLocalWildcard) {
    return preferredLocalWildcard;
  }

  return unusedInsights
    .filter(
      (insight) =>
        isParticipantLocalInsight(insight, participant) ||
        insight?.nearestParticipantName === participant?.name ||
        getParticipantDuration(insight, participant) <= 16,
    )
    .sort(
      (left, right) =>
        getParticipantLocalScore(left, participant) -
        getParticipantLocalScore(right, participant),
    )[0];
}

function ensureParticipantLocalCoverageIds(
  candidateIds: string[],
  insights: any[],
  participants: any[],
  limit: number,
  selectionMode = 'balance',
  thrillLevel = 1,
) {
  if (!Array.isArray(participants) || participants.length < 2 || !Array.isArray(insights) || !insights.length) {
    return candidateIds.slice(0, limit);
  }

  const insightById = new Map(
    insights
      .map((insight) => [getInsightCandidateId(insight), insight] as const)
      .filter(([candidateId]) => candidateId),
  );
  const targetLimit = Math.min(Math.max(1, limit), insightById.size);
  const nextIds: string[] = [];
  const usedIds = new Set<string>();

  for (const candidateId of candidateIds) {
    if (!insightById.has(candidateId) || usedIds.has(candidateId)) {
      continue;
    }

    nextIds.push(candidateId);
    usedIds.add(candidateId);

    if (nextIds.length >= targetLimit) {
      break;
    }
  }

  const isLocalHeavyMode = selectionMode === 'neighborhood' && thrillLevel >= 4;
  const isHouseFrontMode = selectionMode === 'neighborhood' && thrillLevel >= 5;

  if (!isLocalHeavyMode) {
    return nextIds.slice(0, targetLimit);
  }

  if (isHouseFrontMode) {
    const requiredIds: string[] = [];
    const usedRequiredIds = new Set<string>();

    for (const participant of participants.slice(0, targetLimit)) {
      const localAnchor = getParticipantLocalAnchor(
        insights,
        participant,
        usedRequiredIds,
        true,
      );
      const localAnchorId = getInsightCandidateId(localAnchor);

      if (!localAnchorId) {
        continue;
      }

      requiredIds.push(localAnchorId);
      usedRequiredIds.add(localAnchorId);
    }

    if (requiredIds.length) {
      const mergedIds = [...requiredIds];
      const seenIds = new Set(requiredIds);

      for (const candidateId of nextIds) {
        if (seenIds.has(candidateId)) {
          continue;
        }

        mergedIds.push(candidateId);
        seenIds.add(candidateId);

        if (mergedIds.length >= targetLimit) {
          break;
        }
      }

      return mergedIds.slice(0, targetLimit);
    }
  }

  const localReserveLimit = isHouseFrontMode
    ? Math.min(participants.length, targetLimit)
    : isLocalHeavyMode
      ? Math.min(
          participants.length,
          Math.max(2, targetLimit - Math.max(2, Math.ceil(targetLimit * 0.65))),
        )
    : Math.min(
        participants.length,
        Math.max(2, targetLimit - Math.max(2, Math.ceil(targetLimit * 0.6))),
      );
  let insertedLocalCount = 0;

  for (const participant of participants) {
    if (insertedLocalCount >= localReserveLimit) {
      break;
    }

    const alreadyCovered = nextIds.some((candidateId) => {
      const insight = insightById.get(candidateId);
      return insight
        ? isLocalHeavyMode
          ? isExplicitParticipantLocalInsight(insight, participant, isHouseFrontMode)
          : isParticipantLocalInsight(insight, participant)
        : false;
    });

    if (alreadyCovered) {
      continue;
    }

    const localAnchor = getParticipantLocalAnchor(
      insights,
      participant,
      usedIds,
      isHouseFrontMode,
    );
    const localAnchorId = getInsightCandidateId(localAnchor);

    if (!localAnchorId) {
      continue;
    }

    if (nextIds.length >= targetLimit) {
      const replaceIndex = Math.max(
        0,
        nextIds
          .map((candidateId, index) => ({ candidateId, index }))
          .reverse()
          .find(({ candidateId }) => {
            const insight = insightById.get(candidateId);
            return insight
              ? participants.every((item) =>
                  isLocalHeavyMode
                    ? !isExplicitParticipantLocalInsight(insight, item, false)
                    : !isParticipantLocalInsight(insight, item),
                )
              : true;
          })?.index ?? nextIds.length - 1,
      );

      usedIds.delete(nextIds[replaceIndex]);
      nextIds.splice(replaceIndex, 1);
    }

    nextIds.push(localAnchorId);
    usedIds.add(localAnchorId);
    insertedLocalCount += 1;
  }

  return nextIds.slice(0, targetLimit);
}

function extractResponseText(data: any) {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const collected: string[] = [];

  for (const item of data?.output ?? []) {
    if (!Array.isArray(item?.content)) {
      continue;
    }

    for (const content of item.content) {
      if (typeof content?.text === 'string' && content.text.trim()) {
        collected.push(content.text.trim());
      }
    }
  }

  return collected.join('\n').trim();
}

function getThrillHint(thrillLevel: number) {
  if (thrillLevel >= 5) {
    return 'Keep a fair midpoint core, but include one explicit local extreme anchor per participant. Prefer one thrill-hyper id for each participant first; use thrill-local or participant-near only as fallback.';
  }

  if (thrillLevel === 4) {
    return 'Keep a fair midpoint core, then add participant-near or thrill-local candidates around one person, but avoid exact house-front picks.';
  }

  if (thrillLevel === 3) {
    return 'Keep the fair midpoint core, then mix in a few nearby neighborhood wildcard picks.';
  }

  if (thrillLevel === 2) {
    return 'Stay centered and fair for everyone, but allow a little more surprise than the safest midpoint.';
  }

  return 'Focus on realistic, fair midpoint areas for the whole group.';
}

function buildSelectionPayload(
  participants: any[],
  insights: any[],
  selectedCategory: string,
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
  targetCount: number,
) {
  const isNearOnePersonMode = selectionMode === 'neighborhood' && thrillLevel >= 4;
  const isHouseFrontMode = selectionMode === 'neighborhood' && thrillLevel >= 5;
  const fairnessSpreadLimit = getFairnessSpreadLimit(thrillLevel);
  const categoryLabels: Record<string, string> = {
    dining: '식사',
    cafe: '카페',
    drink: '술자리',
    date: '데이트',
    culture: '문화/산책',
    activity: '액티비티',
  };
  const categoryLabel = categoryLabels[selectedCategory] ?? selectedCategory;

  return {
    selectionGoal:
      'Select meetup area candidates near the middle of the group so everyone can reach them as fairly as possible.',
    fairnessRule:
      `Lv${thrillLevel} 공정도는 참여자별 이동시간 편차(spreadDuration) ${fairnessSpreadLimit}분 이하가 기준이다. 이 기준 안의 후보를 최우선으로 고르고, 충분하지 않을 때만 편차가 가장 작은 후보를 보충해라. 중간에서 만나 모드에서는 기준 안에 들어온 후보끼리 averageDuration과 farthestDuration이 낮은 효율적인 후보를 우선하고, 모두가 똑같이 오래 이동하는 후보는 낮게 평가해라. 공정 모드에서는 서울/경기/인천 지역 안배보다 spreadDuration 최소화와 이동 효율이 먼저이며, 지역 대표 후보를 억지로 넣어 편차를 키우지 마라.`,
    twoPersonRule:
      participants.length === 2 && selectionMode === 'balance'
        ? '2명 모임에서는 후보가 애매하게 퍼지기 쉬우니 두 출발지를 잇는 이동축 근처, 그중에서도 한쪽 끝이 아니라 가운데 35~65% 구간에 가까운 후보를 우선해라. 편차가 낮아도 둘 다 오래 이동하거나 이동축에서 크게 벗어난 후보는 낮게 평가해라.'
        : '3명 이상 모임에서는 전체 중심과 참여자별 편차를 함께 본다.',
    categoryRule:
      `${categoryLabel} 카테고리에 잘 맞는 상권을 고르되, 카테고리 적합성은 공정성 다음 기준이다. 먼저 fairnessSpreadLimit 안에 있거나 spreadDuration이 작은 후보를 고르고, 그 안에서 selectedCategory와 tags/categories/bestFor가 잘 맞는 후보를 우선해라. 유명한 상권 하나로 몰지 말고, 덜 유명한 동네라도 ${categoryLabel}에 맞는 식당/카페/바/전시/액티비티 포인트가 있으면 공정한 후보로 살려라. 카테고리 때문에 한 참여자 근처로 과하게 쏠리는 선택은 피하라.`,
    localModeRule:
      isHouseFrontMode
        ? 'House-front mode is intentionally extreme: keep some fair midpoint candidates, but every participant must have at least one explicit local wildcard candidate in the final ids. Prefer exactly one thrill-hyper id per participant first, then use thrill-local or participant-near only as fallback. Do not give two house-front picks to one participant while another participant has none.'
        : isNearOnePersonMode
          ? 'Near-one-person mode: keep the fair midpoint core, but include participant-near or thrill-local commercial areas across participants as evenly as possible. Do not use thrill-hyper unless it is level 5.'
        : thrillLevel >= 3
          ? 'Do not replace the balanced core with only local picks. Add local wildcard areas on top of the fair midpoint core.'
        : 'Return only balanced midpoint recommendations.',
    candidateMixRule:
      isHouseFrontMode
        ? 'Do not remove all house-front ids just because they are one-sided. The house-front wildcard bucket must be participant-fair: one local extreme anchor for each participant before adding extra picks.'
        : isNearOnePersonMode
          ? 'Include a few one-person-near picks, but keep exact house-front picks out.'
        : 'Keep candidate selection centered on fair and realistic meetup areas.',
    selectedCategory,
    categoryLabel,
    selectionMode,
    thrillLevel,
    fairnessSpreadLimit,
    candidateScope,
    thrillHint: getThrillHint(thrillLevel),
    targetCount,
    participants: participants.map((participant) => ({
      name: participant?.name,
      gender: participant?.gender,
      location: participant?.location,
      maxTravelTime: participant?.maxTravelTime,
    })),
    candidates: insights.map((insight) => ({
      id: insight?.candidate?.id,
      name: insight?.candidate?.name,
      district: insight?.candidate?.district,
      vibe: insight?.candidate?.vibe,
      bestFor: insight?.candidate?.bestFor,
      routeHint: insight?.candidate?.routeHint,
      tags: insight?.candidate?.tags,
      categories: insight?.candidate?.categories,
      categoryMatched: Boolean(insight?.categoryMatched),
      averageDuration: insight?.averageDuration,
      maxDuration: insight?.maxDuration,
      spreadDuration: insight?.spreadDuration,
      allReachable: insight?.allReachable,
      centerDistance: insight?.centerDistance,
      nearestParticipantName: insight?.nearestParticipantName,
      nearestDuration: insight?.nearestDuration,
      farthestParticipantName: insight?.farthestParticipantName,
      farthestDuration: insight?.farthestDuration,
    })),
  };
}

type AiProviderName = 'gms' | 'upstage' | 'openai';

type ServerAiProvider =
  | {
      provider: 'gms' | 'upstage';
      apiKey: string;
      model: string;
      baseUrl: string;
    }
  | {
      provider: 'openai';
      apiKey: string;
      model: string;
    };

function pickFirstEnv(env: Record<string, string | undefined>, keys: string[]) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function getServerGmsAiConfig(env: Record<string, string | undefined>): ServerAiProvider | null {
  const apiKey = pickFirstEnv(env, ['GMS_AI_API_KEY', 'GMS_API_KEY', 'VITE_GMS_AI_API_KEY']);
  const model = pickFirstEnv(env, ['GMS_AI_MODEL', 'GMS_MODEL', 'VITE_GMS_AI_MODEL']);
  const baseUrl = pickFirstEnv(env, [
    'GMS_AI_API_BASE_URL',
    'GMS_API_BASE_URL',
    'VITE_GMS_AI_API_BASE_URL',
  ]);

  if (!apiKey || !model || !baseUrl) {
    return null;
  }

  return {
    provider: 'gms',
    apiKey,
    model,
    baseUrl,
  };
}

function getServerAiProviders(
  env: Record<string, string | undefined>,
  runtimeAiConfig: any,
): ServerAiProvider[] {
  const providers: ServerAiProvider[] = [];
  const seenProviders = new Set<AiProviderName>();
  const addProvider = (provider: ServerAiProvider | null) => {
    if (!provider || seenProviders.has(provider.provider)) {
      return;
    }

    seenProviders.add(provider.provider);
    providers.push(provider);
  };

  if (runtimeAiConfig?.provider === 'gms' && runtimeAiConfig.baseUrl) {
    addProvider({
      provider: 'gms',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
      baseUrl: runtimeAiConfig.baseUrl,
    });
  }

  if (runtimeAiConfig?.provider === 'upstage') {
    addProvider({
      provider: 'upstage',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
      baseUrl:
        runtimeAiConfig.baseUrl ||
        pickFirstEnv(env, [
          'UPSTAGE_API_BASE_URL',
          'SOLAR_API_BASE_URL',
          'VITE_UPSTAGE_API_BASE_URL',
        ]) ||
        'https://api.upstage.ai/v1',
    });
  }

  if (runtimeAiConfig?.provider === 'openai') {
    addProvider({
      provider: 'openai',
      apiKey: runtimeAiConfig.apiKey,
      model: runtimeAiConfig.model,
    });
  }

  addProvider(getServerGmsAiConfig(env));

  const rawOpenAiKey = pickFirstEnv(env, ['OPENAI_API_KEY', 'AI_API_KEY', 'VITE_OPENAI_API_KEY']);
  const rawUpstageKey = pickFirstEnv(env, [
    'UPSTAGE_API_KEY',
    'SOLAR_API_KEY',
    'VITE_UPSTAGE_API_KEY',
  ]);
  const detectedUpstageKey =
    rawUpstageKey || (rawOpenAiKey.startsWith('up_') ? rawOpenAiKey : '');
  const detectedOpenAiKey =
    detectedUpstageKey && rawOpenAiKey === detectedUpstageKey ? '' : rawOpenAiKey;

  if (detectedUpstageKey) {
    addProvider({
      provider: 'upstage',
      apiKey: detectedUpstageKey,
      model: pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) || 'solar-pro3',
      baseUrl:
        pickFirstEnv(env, [
          'UPSTAGE_API_BASE_URL',
          'SOLAR_API_BASE_URL',
          'VITE_UPSTAGE_API_BASE_URL',
        ]) || 'https://api.upstage.ai/v1',
    });
  }

  if (detectedOpenAiKey) {
    addProvider({
      provider: 'openai',
      apiKey: detectedOpenAiKey,
      model: pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini',
    });
  }

  return providers;
}

function getRuntimeAiConfig(body: any) {
  const runtimeAiConfig = body?.runtimeAiConfig;

  if (!runtimeAiConfig || typeof runtimeAiConfig !== 'object') {
    return null;
  }

  const provider =
    runtimeAiConfig.provider === 'gms' ||
    runtimeAiConfig.provider === 'upstage' ||
    runtimeAiConfig.provider === 'openai'
      ? runtimeAiConfig.provider
      : null;
  const apiKey =
    typeof runtimeAiConfig.apiKey === 'string' ? runtimeAiConfig.apiKey.trim() : '';
  const model =
    typeof runtimeAiConfig.model === 'string' ? runtimeAiConfig.model.trim() : '';
  const baseUrl =
    typeof runtimeAiConfig.baseUrl === 'string' ? runtimeAiConfig.baseUrl.trim() : '';

  if (!provider || !apiKey || !model || (provider === 'gms' && !baseUrl)) {
    return null;
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl,
  };
}

interface PlaceCandidate {
  id: string;
  name: string;
  description?: string;
  categoryPath?: string;
  address?: string;
  roadAddress?: string;
}

const genericPlaceChainKeywords = [
  '롯데리아',
  '맥도날드',
  '버거킹',
  'KFC',
  '맘스터치',
  '써브웨이',
  '이디야',
  '메가커피',
  '빽다방',
  '컴포즈커피',
  '스타벅스',
  '투썸',
  '파리바게뜨',
  '뚜레쥬르',
  'CU',
  'GS25',
  '세븐일레븐',
  '다이소',
  '올리브영',
  '마트',
  '편의점',
  '약국',
  '주차장',
];

const placeCategoryHints: Record<string, string[]> = {
  restaurant: ['음식점', '한식', '일식', '양식', '중식', '고기', '파스타', '브런치', '다이닝'],
  cafe: ['카페', '디저트', '베이커리', '커피', '브런치'],
  drink: ['술집', '바', '이자카야', '와인', '맥주', '포차', '칵테일'],
  culture: ['전시', '공연', '문화', '갤러리', '소품샵', '서점', '공방'],
  activity: ['방탈출', '보드게임', '볼링', '오락', '영화', '놀거리', '공원'],
};

function normalizePlaceText(value: unknown) {
  return typeof value === 'string' ? value.trim() : '';
}

function getPlaceCandidateText(item: PlaceCandidate) {
  return [
    item.name,
    item.description,
    item.categoryPath,
    item.address,
    item.roadAddress,
  ]
    .filter(Boolean)
    .join(' ');
}

function getPlaceHeuristicScore(
  item: PlaceCandidate,
  category: string,
  detailQuery: string,
  meetCategory: string,
) {
  const text = getPlaceCandidateText(item);
  const lowerText = text.toLowerCase();
  const normalizedDetail = detailQuery.trim().toLowerCase();
  const hints = placeCategoryHints[category] ?? [];
  let score = 0;

  hints.forEach((hint) => {
    if (text.includes(hint)) {
      score += 9;
    }
  });

  if (normalizedDetail && lowerText.includes(normalizedDetail)) {
    score += 8;
  }

  if (text.includes('맛집') || text.includes('핫플') || text.includes('분위기')) {
    score += 5;
  }

  if (text.includes('예약') || text.includes('레스토랑') || text.includes('다이닝')) {
    score += 3;
  }

  const chainPenalty = genericPlaceChainKeywords.some((keyword) => text.includes(keyword))
    ? 18
    : 0;
  score -= meetCategory === 'date' || detailQuery.includes('데이트') || detailQuery.includes('분위기')
    ? chainPenalty * 1.4
    : chainPenalty;

  if (text.includes('호텔') || text.includes('모텔') || text.includes('부동산')) {
    score -= 30;
  }

  return score;
}

function buildPlaceFallbackIds(
  items: PlaceCandidate[],
  category: string,
  detailQuery: string,
  meetCategory: string,
  limit: number,
) {
  return [...items]
    .sort(
      (left, right) =>
        getPlaceHeuristicScore(right, category, detailQuery, meetCategory) -
        getPlaceHeuristicScore(left, category, detailQuery, meetCategory),
    )
    .map((item) => item.id)
    .filter(Boolean)
    .slice(0, limit);
}

function buildPlaceSelectionPayload(input: {
  candidateName: string;
  candidateDistrict: string;
  category: string;
  detailQuery: string;
  meetCategory: string;
  userVibe: string;
  favoriteKeywords: string[];
  groupGenderContext: string;
  limit: number;
  items: PlaceCandidate[];
}) {
  return {
    placeArea: input.candidateName,
    district: input.candidateDistrict,
    meetCategory: input.meetCategory,
    recommendationCategory: input.category,
    detailQuery: input.detailQuery,
    userVibe: input.userVibe,
    favoriteKeywords: input.favoriteKeywords,
    groupGenderContext: input.groupGenderContext,
    targetCount: input.limit,
    allowedIds: input.items.map((item) => item.id),
    places: input.items.map((item) => ({
      id: item.id,
      name: item.name,
      description: item.description,
      categoryPath: item.categoryPath,
      address: item.roadAddress || item.address,
      heuristicScore:
        Math.round(
          getPlaceHeuristicScore(item, input.category, input.detailQuery, input.meetCategory) *
            10,
        ) / 10,
      genericChain: genericPlaceChainKeywords.some((keyword) =>
        getPlaceCandidateText(item).includes(keyword),
      ),
    })),
  };
}

async function fetchOpenAiPlaceRanking({
  apiKey,
  model,
  payload,
  allowedIds,
}: {
  apiKey: string;
  model: string;
  payload: ReturnType<typeof buildPlaceSelectionPayload>;
  allowedIds: string[];
}) {
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      input: [
        {
          role: 'system',
          content:
            'You rank real nearby places for a Korean meetup/date planning app. Return JSON only. Choose only allowed ids. Prioritize places that fit the requested category, detail query, and social context. Prefer distinctive local venues, appropriate ambience, reservation-worthy restaurants/cafes/bars, and places people would actually choose for a meetup. Use groupGenderContext only as a soft ambience and comfort signal: prefer clean, safe, conversation-friendly, inclusive places for mixed or gender-skewed groups, but do not stereotype or exclude valid options only by gender. Penalize generic fast-food chains, convenience stores, marts, pharmacies, unrelated retail, hotels/motels, and broad landmarks when the user asks for restaurants, dates, cafes, bars, or activities. For date or ambience-driven requests, do not rank generic fast-food chains such as Lotteria highly unless no other relevant option exists. Do not invent places.',
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'place_recommendation_ranking',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              item_ids: {
                type: 'array',
                minItems: payload.targetCount,
                maxItems: payload.targetCount,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: allowedIds,
                },
              },
              summary: {
                type: 'string',
              },
            },
            required: ['item_ids', 'summary'],
          },
        },
      },
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI place ranking failed with status ${response.status}.`);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error('OpenAI place ranking returned no structured output.');
  }

  const parsed = JSON.parse(outputText);

  return {
    itemIds: Array.isArray(parsed?.item_ids)
      ? parsed.item_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

async function fetchUpstagePlaceRanking({
  apiKey,
  model,
  baseUrl,
  payload,
  providerLabel = 'Upstage',
}: {
  apiKey: string;
  model: string;
  baseUrl: string;
  payload: ReturnType<typeof buildPlaceSelectionPayload>;
  providerLabel?: string;
}) {
  const apiBase = baseUrl.replace(/\/$/, '');
  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.45,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON object with keys item_ids and summary. item_ids must contain only allowed ids and match targetCount. You rank real nearby places for a Korean meetup/date planning app. Prioritize category fit, detail query fit, ambience, local distinctiveness, and places people would actually choose for a meetup. Use groupGenderContext only as a soft ambience and comfort signal: prefer clean, safe, conversation-friendly, inclusive places for mixed or gender-skewed groups, but do not stereotype or exclude valid options only by gender. Penalize generic fast-food chains, convenience stores, marts, pharmacies, unrelated retail, hotels/motels, and broad landmarks when the user asks for restaurants, dates, cafes, bars, or activities. For date or ambience-driven requests, do not rank generic fast-food chains such as Lotteria highly unless no other relevant option exists. Do not invent places.',
        },
        {
          role: 'user',
          content: JSON.stringify(payload),
        },
      ],
    }),
  });
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `${providerLabel} place ranking failed with status ${response.status}.`);
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  if (!content.trim()) {
    throw new Error(`${providerLabel} place ranking returned no content.`);
  }

  const parsed = JSON.parse(content);

  return {
    itemIds: Array.isArray(parsed?.item_ids)
      ? parsed.item_ids.filter((id: unknown): id is string => typeof id === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

async function fetchOpenAiCandidateSelection({
  apiKey,
  model,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
  requestedTargetCount,
  providerLabel = 'Upstage',
}: {
  apiKey: string;
  model: string;
  participants: any[];
  insights: any[];
  selectedCategory: string;
  selectionMode: string;
  thrillLevel: number;
  candidateScope: string;
  requestedTargetCount?: number;
  providerLabel?: string;
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(
    allowedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );

  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      input: [
        {
          role: 'system',
          content:
            'You are selecting meeting area candidates for a Seoul Capital Area meetup app. Return JSON only. Choose only from the allowed candidate ids. The primary fairness metric is spreadDuration, the difference between the slowest and fastest participant travel times. Respect the provided fairnessSpreadLimit first: prefer candidates at or below that limit, and if there are not enough, choose the smallest spreadDuration candidates. Category fit is important but secondary to fairness: among fair candidates, prefer areas whose tags/categories/bestFor match selectedCategory. Do not let category fit collapse the list into one famous or one-person-near area. Every neighborhood can have category-specific venues, so keep less famous but fair areas when their tags, bestFor, or commercial context support the category. Do not force Seoul/Gyeonggi/Incheon regional representation if it increases spreadDuration. In balance mode, respect fairnessSpreadLimit first, but among candidates within the limit prioritize low averageDuration and low farthestDuration so the group does not travel equally far; use spreadDuration, centerDistance, and axisDistance as tie-breakers. For exactly two participants, prefer candidates near the corridor between both starts and close to the middle band, not candidates drifting toward either endpoint. In neighborhood level 4, include participant-near or thrill-local candidates only after preserving a fair midpoint core. In neighborhood level 5 house-front mode, every participant must get one explicit local extreme anchor when possible, but still keep the rest of the set as fair as possible.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            buildSelectionPayload(
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              targetCount,
            ),
          ),
        },
      ],
      text: {
        format: {
          type: 'json_schema',
          name: 'meeting_candidate_selection',
          strict: true,
          schema: {
            type: 'object',
            additionalProperties: false,
            properties: {
              candidate_ids: {
                type: 'array',
                minItems: targetCount,
                maxItems: targetCount,
                uniqueItems: true,
                items: {
                  type: 'string',
                  enum: allowedIds,
                },
              },
              summary: {
                type: 'string',
              },
            },
            required: ['candidate_ids', 'summary'],
          },
        },
      },
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `OpenAI candidate selection failed with status ${response.status}.`);
  }

  const outputText = extractResponseText(data);

  if (!outputText) {
    throw new Error('OpenAI candidate selection returned no structured output.');
  }

  const parsed = JSON.parse(outputText);

  return {
    candidateIds: Array.isArray(parsed?.candidate_ids)
      ? parsed.candidate_ids.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

async function fetchUpstageCandidateSelection({
  apiKey,
  model,
  baseUrl,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
  requestedTargetCount,
}: {
  apiKey: string;
  model: string;
  baseUrl: string;
  participants: any[];
  insights: any[];
  selectedCategory: string;
  selectionMode: string;
  thrillLevel: number;
  candidateScope: string;
  requestedTargetCount?: number;
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(
    allowedIds.length,
    selectionMode,
    thrillLevel,
    candidateScope,
    requestedTargetCount,
  );
  const apiBase = baseUrl.replace(/\/$/, '');

  const response = await fetch(`${apiBase}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.8,
      response_format: {
        type: 'json_object',
      },
      messages: [
        {
          role: 'system',
          content:
            'Return a JSON object with keys candidate_ids and summary. candidate_ids must contain only allowed ids and match the requested targetCount. The primary fairness metric is spreadDuration, the difference between the slowest and fastest participant travel times. Respect the provided fairnessSpreadLimit first: prefer candidates at or below that limit, and if there are not enough, choose the smallest spreadDuration candidates. Category fit is important but secondary to fairness: among fair candidates, prefer areas whose tags/categories/bestFor match selectedCategory. Do not let category fit collapse the list into one famous or one-person-near area. Every neighborhood can have category-specific venues, so keep less famous but fair areas when their tags, bestFor, or commercial context support the category. Do not force Seoul/Gyeonggi/Incheon regional representation if it increases spreadDuration. In balance mode, respect fairnessSpreadLimit first, but among candidates within the limit prioritize low averageDuration and low farthestDuration so the group does not travel equally far; use spreadDuration, centerDistance, and axisDistance as tie-breakers. For exactly two participants, prefer candidates near the corridor between both starts and close to the middle band, not candidates drifting toward either endpoint. In neighborhood level 4, include participant-near or thrill-local candidates only after preserving a fair midpoint core. In neighborhood level 5 house-front mode, every participant must get one explicit local extreme anchor when possible, but still keep the rest of the set as fair as possible.',
        },
        {
          role: 'user',
          content: JSON.stringify(
            buildSelectionPayload(
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              targetCount,
            ),
          ),
        },
      ],
    }),
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data?.error?.message ?? `${providerLabel} candidate selection failed with status ${response.status}.`);
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  if (!content.trim()) {
    throw new Error(`${providerLabel} candidate selection returned no content.`);
  }

  const parsed = JSON.parse(content);

  return {
    candidateIds: Array.isArray(parsed?.candidate_ids)
      ? parsed.candidate_ids.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
      : [],
    summary: typeof parsed?.summary === 'string' ? parsed.summary : '',
  };
}

function naverDirectionsProxy(clientId: string, clientSecret: string) {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/naver/directions')) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    if (!clientId || !clientSecret) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: 'NAVER Maps Directions credentials are missing on the dev server.',
        }),
      );
      return;
    }

    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const start = requestUrl.searchParams.get('start');
      const goal = requestUrl.searchParams.get('goal');
      const option = requestUrl.searchParams.get('option') ?? 'traoptimal';

      if (!start || !goal) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: 'start and goal query params are required.' }));
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
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown proxy error while calling NAVER Directions API.',
        }),
      );
    }
  };

  return {
    name: 'naver-directions-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function naverLocalSearchProxy(clientId: string, clientSecret: string) {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/naver/local-search')) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    if (!clientId || !clientSecret) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: 'NAVER Search credentials are missing on the dev server.',
        }),
      );
      return;
    }

    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const query = requestUrl.searchParams.get('query')?.trim();
      const display = requestUrl.searchParams.get('display')?.trim() || '4';
      const sort = requestUrl.searchParams.get('sort')?.trim() || 'random';

      if (!query) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ message: 'query is required.' }));
        return;
      }

      const upstreamUrl = new URL('https://openapi.naver.com/v1/search/local.json');
      upstreamUrl.searchParams.set('query', query);
      upstreamUrl.searchParams.set('display', display);
      upstreamUrl.searchParams.set('start', '1');
      upstreamUrl.searchParams.set('sort', sort);

      const upstreamResponse = await fetch(upstreamUrl.toString(), {
        headers: {
          'X-Naver-Client-Id': clientId,
          'X-Naver-Client-Secret': clientSecret,
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
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown proxy error while calling NAVER local search API.',
        }),
      );
    }
  };

  return {
    name: 'naver-local-search-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function odsayTransitProxy(apiKey: string) {
  const getHeaderValue = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value[0] : value;

  const getRequestReferer = (req: any) => {
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
      return 'http://127.0.0.1:4173/';
    }

    const forwardedProto = getHeaderValue(req.headers?.['x-forwarded-proto']);
    const isLocalHost = host.startsWith('127.0.0.1') || host.startsWith('localhost');
    const protocol = forwardedProto ?? (isLocalHost ? 'http' : 'https');

    return `${protocol}://${host}/`;
  };

  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/odsay/transit')) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    if (!apiKey) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message: 'ODsay API key is missing on the dev server.',
        }),
      );
      return;
    }

    try {
      const requestUrl = new URL(req.url, 'http://127.0.0.1');
      const startX = requestUrl.searchParams.get('startX');
      const startY = requestUrl.searchParams.get('startY');
      const endX = requestUrl.searchParams.get('endX');
      const endY = requestUrl.searchParams.get('endY');

      if (
        !startX ||
        !startY ||
        !endX ||
        !endY ||
        !Number.isFinite(Number(startX)) ||
        !Number.isFinite(Number(startY)) ||
        !Number.isFinite(Number(endX)) ||
        !Number.isFinite(Number(endY))
      ) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            message: 'startX, startY, endX, and endY query params are required.',
          }),
        );
        return;
      }

      const upstreamUrl = new URL('https://api.odsay.com/v1/api/searchPubTransPathT');
      upstreamUrl.searchParams.set('apiKey', apiKey);
      upstreamUrl.searchParams.set('SX', startX);
      upstreamUrl.searchParams.set('SY', startY);
      upstreamUrl.searchParams.set('EX', endX);
      upstreamUrl.searchParams.set('EY', endY);
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
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          message:
            error instanceof Error
              ? error.message
              : 'Unknown proxy error while calling ODsay transit API.',
        }),
      );
    }
  };

  return {
    name: 'odsay-transit-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function runtimeCapabilitiesProxy({
  aiProviders,
  naverSearchClientId,
  naverSearchClientSecret,
  odsayApiKey,
}: {
  aiProviders: ServerAiProvider[];
  naverSearchClientId: string;
  naverSearchClientSecret: string;
  odsayApiKey: string;
}) {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/runtime-capabilities')) {
      next();
      return;
    }

    if (req.method !== 'GET') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    const [aiProvider] = aiProviders;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ai: {
          connected: Boolean(aiProvider),
          provider: aiProvider?.provider ?? null,
          model: aiProvider?.model ?? null,
        },
        naverSearch: {
          connected: Boolean(naverSearchClientId && naverSearchClientSecret),
        },
        odsayTransit: {
          connected: Boolean(odsayApiKey),
        },
      }),
    );
  };

  return {
    name: 'runtime-capabilities-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function liveCandidateProxy({
  env,
}: {
  env: Record<string, string | undefined>;
}) {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/live-candidates')) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const participants = Array.isArray(body?.participants) ? body.participants : [];
      const insights = Array.isArray(body?.insights) ? body.insights : [];
      const fallbackCandidateIds = Array.isArray(body?.fallbackCandidateIds)
        ? body.fallbackCandidateIds.filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string')
        : [];
      const selectedCategory =
        typeof body?.selectedCategory === 'string' ? body.selectedCategory : 'dining';
      const selectionMode =
        typeof body?.selectionMode === 'string' ? body.selectionMode : 'balance';
      const thrillLevel =
        typeof body?.thrillLevel === 'number' ? body.thrillLevel : 1;
      const candidateScope =
        typeof body?.candidateScope === 'string' ? body.candidateScope : 'standard';
      const candidateTargetCount =
        typeof body?.candidateTargetCount === 'number' && Number.isFinite(body.candidateTargetCount)
          ? body.candidateTargetCount
          : undefined;
      const effectiveCandidateTargetCount =
        selectionMode === 'neighborhood' && thrillLevel >= 5 && participants.length
          ? Math.max(candidateTargetCount ?? 0, participants.length)
          : candidateTargetCount;
      const runtimeAiConfig = getRuntimeAiConfig(body);
      const aiProviders = getServerAiProviders(env, runtimeAiConfig);

      if (!insights.length) {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(JSON.stringify({ candidateIds: [], message: 'Candidate insights are required.' }));
        return;
      }

      const safeFallbackIds = buildFallbackCandidateIds(
        insights,
        fallbackCandidateIds,
        selectionMode,
        thrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
      );
      const safeTargetCount = pickTargetCount(
        insights.length,
        selectionMode,
        thrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
      );
      const coveredSafeFallbackIds = reorderCandidateIdsByFairness(
        ensureParticipantLocalCoverageIds(
          safeFallbackIds,
          insights,
          participants,
          safeTargetCount,
          selectionMode,
          thrillLevel,
        ),
        insights,
        thrillLevel,
      );

      if (!aiProviders.length) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: coveredSafeFallbackIds,
            source: 'heuristic',
            message: 'AI 키가 없어 기본 후보 로직으로 이어갑니다.',
          }),
        );
        return;
      }

      let lastAiError: unknown = null;

      for (const aiProvider of aiProviders) {
        try {
          const aiSelection =
            aiProvider.provider === 'openai'
              ? await fetchOpenAiCandidateSelection({
                  apiKey: aiProvider.apiKey,
                  model: aiProvider.model,
                  participants,
                  insights,
                  selectedCategory,
                  selectionMode,
                  thrillLevel,
                  candidateScope,
                  requestedTargetCount: effectiveCandidateTargetCount,
                })
              : await fetchUpstageCandidateSelection({
                  apiKey: aiProvider.apiKey,
                  model: aiProvider.model,
                  baseUrl: aiProvider.baseUrl,
                  participants,
                  insights,
                  selectedCategory,
                  selectionMode,
                  thrillLevel,
                  candidateScope,
                  requestedTargetCount: effectiveCandidateTargetCount,
                  providerLabel: aiProvider.provider === 'gms' ? 'GMS AI' : 'Upstage',
                });

          const allowedIds = new Set(
            insights
              .map((insight) => insight?.candidate?.id)
              .filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string'),
          );
          const candidateIds = aiSelection.candidateIds
            .filter((candidateId) => allowedIds.has(candidateId))
            .slice(0, pickTargetCount(allowedIds.size, selectionMode, thrillLevel, candidateScope, effectiveCandidateTargetCount));
          const coveredCandidateIds = reorderCandidateIdsByFairness(
            ensureParticipantLocalCoverageIds(
              candidateIds.length ? candidateIds : coveredSafeFallbackIds,
              insights,
              participants,
              pickTargetCount(allowedIds.size, selectionMode, thrillLevel, candidateScope, effectiveCandidateTargetCount),
              selectionMode,
              thrillLevel,
            ),
            insights,
            thrillLevel,
          );

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              candidateIds: coveredCandidateIds.length ? coveredCandidateIds : coveredSafeFallbackIds,
              source: aiProvider.provider,
              message: aiSelection.summary || undefined,
            }),
          );
          return;
        } catch (error) {
          lastAiError = error;
        }
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          candidateIds: coveredSafeFallbackIds,
          source: 'heuristic',
          message:
            lastAiError instanceof Error
              ? lastAiError.message
              : 'AI 후보 생성에 실패해 기본 후보로 이어갑니다.',
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          candidateIds: [],
          message:
            error instanceof Error
              ? error.message
              : 'Unknown proxy error while preparing AI meeting candidates.',
        }),
      );
    }
  };

  return {
    name: 'live-candidate-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

function contentRecommendationsProxy({
  env,
}: {
  env: Record<string, string | undefined>;
}) {
  const middleware = async (req: any, res: any, next: () => void) => {
    if (!req.url?.startsWith('/api/content-recommendations')) {
      next();
      return;
    }

    if (req.method !== 'POST') {
      res.statusCode = 405;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ message: 'Method not allowed' }));
      return;
    }

    try {
      const body = await readJsonBody(req);
      const items = Array.isArray(body?.items)
        ? body.items
            .map((item: any) => ({
              id: normalizePlaceText(item?.id),
              name: normalizePlaceText(item?.name),
              description: normalizePlaceText(item?.description),
              categoryPath: normalizePlaceText(item?.categoryPath),
              address: normalizePlaceText(item?.address),
              roadAddress: normalizePlaceText(item?.roadAddress),
            }))
            .filter((item: PlaceCandidate) => item.id && item.name)
        : [];
      const category = normalizePlaceText(body?.category) || 'restaurant';
      const detailQuery = normalizePlaceText(body?.detailQuery) || category;
      const meetCategory = normalizePlaceText(body?.meetCategory) || category;
      const limit = Math.max(
        1,
        Math.min(
          typeof body?.limit === 'number' && Number.isFinite(body.limit)
            ? Math.round(body.limit)
            : 6,
          items.length,
        ),
      );
      const allowedIds = items.map((item) => item.id).filter(Boolean);
      const fallbackIds = buildPlaceFallbackIds(
        items,
        category,
        detailQuery,
        meetCategory,
        limit,
      );

      if (!items.length || !allowedIds.length) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            itemIds: [],
            source: 'empty',
            message: '추천 후보가 아직 없어요.',
          }),
        );
        return;
      }

      const runtimeAiConfig = getRuntimeAiConfig(body);
      const aiProviders = getServerAiProviders(env, runtimeAiConfig);
      const payload = buildPlaceSelectionPayload({
        candidateName: normalizePlaceText(body?.candidate?.name),
        candidateDistrict: normalizePlaceText(body?.candidate?.district),
        category,
        detailQuery,
        meetCategory,
        userVibe: normalizePlaceText(body?.userVibe),
        groupGenderContext: normalizePlaceText(body?.groupGenderContext),
        favoriteKeywords: Array.isArray(body?.favoriteKeywords)
          ? body.favoriteKeywords.filter((keyword: unknown): keyword is string => typeof keyword === 'string')
          : [],
        limit,
        items,
      });

      if (!aiProviders.length) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            itemIds: fallbackIds,
            source: 'heuristic',
            message: 'AI 키가 없어 기본 필터로 장소를 정리했어요.',
          }),
        );
        return;
      }

      let lastAiError: unknown = null;

      for (const aiProvider of aiProviders) {
        try {
          const aiRanking =
            aiProvider.provider === 'openai'
              ? await fetchOpenAiPlaceRanking({
                  apiKey: aiProvider.apiKey,
                  model: aiProvider.model,
                  payload,
                  allowedIds,
                })
              : await fetchUpstagePlaceRanking({
                  apiKey: aiProvider.apiKey,
                  model: aiProvider.model,
                  baseUrl: aiProvider.baseUrl,
                  payload,
                  providerLabel: aiProvider.provider === 'gms' ? 'GMS AI' : 'Upstage',
                });
          const itemIds = aiRanking.itemIds
            .filter((id) => allowedIds.includes(id))
            .slice(0, limit);

          res.statusCode = 200;
          res.setHeader('Content-Type', 'application/json; charset=utf-8');
          res.end(
            JSON.stringify({
              itemIds: itemIds.length ? itemIds : fallbackIds,
              source: aiProvider.provider,
              message: aiRanking.summary || 'AI가 모임에 어울리는 순서로 장소를 정리했어요.',
            }),
          );
          return;
        } catch (error) {
          lastAiError = error;
        }
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          itemIds: fallbackIds,
          source: 'heuristic',
          message:
            lastAiError instanceof Error
              ? `AI 추천 정렬 실패: ${lastAiError.message}`
              : 'AI 추천 정렬에 실패해 기본 필터로 장소를 정리했어요.',
        }),
      );
    } catch (error) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(
        JSON.stringify({
          itemIds: [],
          source: 'error',
          message:
            error instanceof Error
              ? error.message
              : '장소 추천을 정리하지 못했어요.',
        }),
      );
    }
  };

  return {
    name: 'content-recommendations-proxy',
    configureServer(server: any) {
      server.middlewares.use(middleware);
    },
    configurePreviewServer(server: any) {
      server.middlewares.use(middleware);
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const serverAiProviders = getServerAiProviders(env, null);
  const odsayApiKey = pickFirstEnv(env, ['ODSAY_API_KEY', 'VITE_ODSAY_API_KEY']);

  return {
    plugins: [
      figmaAssetResolver(),
      naverDirectionsProxy(env.VITE_NAVER_MAP_KEY_ID, env.NAVER_MAP_CLIENT_SECRET),
      naverLocalSearchProxy(env.NAVER_SEARCH_CLIENT_ID, env.NAVER_SEARCH_CLIENT_SECRET),
      odsayTransitProxy(odsayApiKey),
      runtimeCapabilitiesProxy({
        aiProviders: serverAiProviders,
        naverSearchClientId: env.NAVER_SEARCH_CLIENT_ID,
        naverSearchClientSecret: env.NAVER_SEARCH_CLIENT_SECRET,
        odsayApiKey,
      }),
      liveCandidateProxy({
        env,
      }),
      contentRecommendationsProxy({
        env,
      }),
      react(),
      tailwindcss(),
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    assetsInclude: ['**/*.svg', '**/*.csv'],
  };
});
