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

  return orderedIds.slice(
    0,
    pickTargetCount(orderedIds.length, selectionMode, thrillLevel, candidateScope, requestedTargetCount),
  );
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

  return {
    selectionGoal:
      'Select meetup area candidates near the middle of the group so everyone can reach them as fairly as possible.',
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
    selectionMode,
    thrillLevel,
    candidateScope,
    thrillHint: getThrillHint(thrillLevel),
    targetCount,
    participants: participants.map((participant) => ({
      name: participant?.name,
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

function pickFirstEnv(env: Record<string, string>, keys: string[]) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function getRuntimeAiConfig(body: any) {
  const runtimeAiConfig = body?.runtimeAiConfig;

  if (!runtimeAiConfig || typeof runtimeAiConfig !== 'object') {
    return null;
  }

  const provider =
    runtimeAiConfig.provider === 'upstage' || runtimeAiConfig.provider === 'openai'
      ? runtimeAiConfig.provider
      : null;
  const apiKey =
    typeof runtimeAiConfig.apiKey === 'string' ? runtimeAiConfig.apiKey.trim() : '';
  const model =
    typeof runtimeAiConfig.model === 'string' ? runtimeAiConfig.model.trim() : '';
  const baseUrl =
    typeof runtimeAiConfig.baseUrl === 'string' ? runtimeAiConfig.baseUrl.trim() : '';

  if (!provider || !apiKey || !model) {
    return null;
  }

  return {
    provider,
    apiKey,
    model,
    baseUrl,
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
            'You are selecting meeting area candidates for a Seoul Capital Area meetup app. Return JSON only. Choose only from the allowed candidate ids. Keep a fair midpoint core for the whole group. In neighborhood thrill level 4, include participant-near or thrill-local candidates around one person. In neighborhood thrill level 5 house-front mode, every participant must get one explicit local extreme anchor: prefer one thrill-hyper id per participant, then use thrill-local or participant-near only as fallback. Do not give multiple house-front picks to one participant while another participant has none. Favor fairness across participants, travel plausibility, and category fit.',
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
            'Return a JSON object with keys candidate_ids and summary. candidate_ids must contain only allowed ids and match the requested targetCount. Always preserve balanced midpoint recommendations. In neighborhood thrill level 4, include participant-near or thrill-local candidates around one person. In neighborhood thrill level 5 house-front mode, every participant must get one explicit local extreme anchor: prefer one thrill-hyper id per participant, then use thrill-local or participant-near only as fallback. Do not give multiple house-front picks to one participant while another participant has none.',
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
    throw new Error(data?.error?.message ?? `Upstage candidate selection failed with status ${response.status}.`);
  }

  const rawContent = data?.choices?.[0]?.message?.content;
  const content =
    typeof rawContent === 'string'
      ? rawContent
      : Array.isArray(rawContent)
        ? rawContent.map((item) => item?.text ?? '').join('\n')
        : '';

  if (!content.trim()) {
    throw new Error('Upstage candidate selection returned no content.');
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
  openAiApiKey,
  openAiModel,
  upstageApiKey,
  upstageModel,
  naverSearchClientId,
  naverSearchClientSecret,
  odsayApiKey,
}: {
  openAiApiKey: string;
  openAiModel: string;
  upstageApiKey: string;
  upstageModel: string;
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

    const aiProvider = upstageApiKey ? 'upstage' : openAiApiKey ? 'openai' : null;
    const aiModel = upstageApiKey ? upstageModel : openAiApiKey ? openAiModel : null;

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(
      JSON.stringify({
        ai: {
          connected: Boolean(aiProvider),
          provider: aiProvider,
          model: aiModel,
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
  openAiApiKey,
  openAiModel,
  upstageApiKey,
  upstageModel,
  upstageBaseUrl,
}: {
  openAiApiKey: string;
  openAiModel: string;
  upstageApiKey: string;
  upstageModel: string;
  upstageBaseUrl: string;
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
      const effectiveUpstageApiKey =
        runtimeAiConfig?.provider === 'upstage' ? runtimeAiConfig.apiKey : upstageApiKey;
      const effectiveUpstageModel =
        runtimeAiConfig?.provider === 'upstage' ? runtimeAiConfig.model : upstageModel;
      const effectiveUpstageBaseUrl =
        runtimeAiConfig?.provider === 'upstage' && runtimeAiConfig.baseUrl
          ? runtimeAiConfig.baseUrl
          : upstageBaseUrl;
      const effectiveOpenAiApiKey =
        runtimeAiConfig?.provider === 'openai' ? runtimeAiConfig.apiKey : openAiApiKey;
      const effectiveOpenAiModel =
        runtimeAiConfig?.provider === 'openai' ? runtimeAiConfig.model : openAiModel;

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
      const coveredSafeFallbackIds = ensureParticipantLocalCoverageIds(
        safeFallbackIds,
        insights,
        participants,
        safeTargetCount,
        selectionMode,
        thrillLevel,
      );

      if (!effectiveOpenAiApiKey && !effectiveUpstageApiKey) {
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

      try {
        const aiSelection = effectiveUpstageApiKey
          ? await fetchUpstageCandidateSelection({
              apiKey: effectiveUpstageApiKey,
              model: effectiveUpstageModel,
              baseUrl: effectiveUpstageBaseUrl,
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              requestedTargetCount: effectiveCandidateTargetCount,
            })
          : await fetchOpenAiCandidateSelection({
              apiKey: effectiveOpenAiApiKey,
              model: effectiveOpenAiModel,
              participants,
              insights,
              selectedCategory,
              selectionMode,
              thrillLevel,
              candidateScope,
              requestedTargetCount: effectiveCandidateTargetCount,
            });

        const allowedIds = new Set(
          insights
            .map((insight) => insight?.candidate?.id)
            .filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string'),
        );
        const candidateIds = aiSelection.candidateIds
          .filter((candidateId) => allowedIds.has(candidateId))
          .slice(0, pickTargetCount(allowedIds.size, selectionMode, thrillLevel, candidateScope, effectiveCandidateTargetCount));
        const coveredCandidateIds = ensureParticipantLocalCoverageIds(
          candidateIds.length ? candidateIds : coveredSafeFallbackIds,
          insights,
          participants,
          pickTargetCount(allowedIds.size, selectionMode, thrillLevel, candidateScope, effectiveCandidateTargetCount),
          selectionMode,
          thrillLevel,
        );

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: coveredCandidateIds.length ? coveredCandidateIds : coveredSafeFallbackIds,
            source: effectiveUpstageApiKey ? 'upstage' : 'openai',
            message: aiSelection.summary || undefined,
          }),
        );
      } catch (error) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: coveredSafeFallbackIds,
            source: 'heuristic',
            message:
              error instanceof Error
                ? error.message
                : 'AI 후보 생성에 실패해 기본 후보로 이어갑니다.',
          }),
        );
      }
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

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
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
  const odsayApiKey = pickFirstEnv(env, ['ODSAY_API_KEY', 'VITE_ODSAY_API_KEY']);

  return {
    plugins: [
      figmaAssetResolver(),
      naverDirectionsProxy(env.VITE_NAVER_MAP_KEY_ID, env.NAVER_MAP_CLIENT_SECRET),
      naverLocalSearchProxy(env.NAVER_SEARCH_CLIENT_ID, env.NAVER_SEARCH_CLIENT_SECRET),
      odsayTransitProxy(odsayApiKey),
      runtimeCapabilitiesProxy({
        openAiApiKey: detectedOpenAiKey,
        openAiModel: pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini',
        upstageApiKey: detectedUpstageKey,
        upstageModel:
          pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) ||
          'solar-pro3',
        naverSearchClientId: env.NAVER_SEARCH_CLIENT_ID,
        naverSearchClientSecret: env.NAVER_SEARCH_CLIENT_SECRET,
        odsayApiKey,
      }),
      liveCandidateProxy({
        openAiApiKey: detectedOpenAiKey,
        openAiModel: pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini',
        upstageApiKey: detectedUpstageKey,
        upstageModel:
          pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) ||
          'solar-pro3',
        upstageBaseUrl:
          pickFirstEnv(env, [
            'UPSTAGE_API_BASE_URL',
            'SOLAR_API_BASE_URL',
            'VITE_UPSTAGE_API_BASE_URL',
          ]) || 'https://api.upstage.ai/v1',
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
