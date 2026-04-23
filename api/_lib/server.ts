type EnvMap = Record<string, string | undefined>;

export async function readJsonBody(req: any) {
  if (req.body && typeof req.body === 'object') {
    return req.body;
  }

  if (typeof req.body === 'string') {
    return req.body ? JSON.parse(req.body) : {};
  }

  const chunks: Buffer[] = [];

  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }

  const rawBody = Buffer.concat(chunks).toString('utf8');
  return rawBody ? JSON.parse(rawBody) : {};
}

export function json(res: any, statusCode: number, body: unknown) {
  res.statusCode = statusCode;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(body));
}

export function pickFirstEnv(env: EnvMap, keys: string[]) {
  for (const key of keys) {
    const value = env[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
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

export function pickTargetCount(
  total: number,
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
) {
  const baseCount = selectionMode === 'neighborhood' ? 7 : 6;
  const thrillBonus = thrillLevel >= 4 ? 2 : thrillLevel >= 3 ? 1 : 0;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  return Math.max(1, Math.min(baseCount + thrillBonus + scopeBonus, total));
}

export function buildFallbackCandidateIds(
  insights: Array<{ candidate?: { id?: string } }>,
  fallbackCandidateIds: string[],
  selectionMode: string,
  thrillLevel: number,
  candidateScope: string,
) {
  const seen = new Set<string>();
  const orderedIds = [...fallbackCandidateIds, ...insights.map((insight) => insight?.candidate?.id)]
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
    pickTargetCount(orderedIds.length, selectionMode, thrillLevel, candidateScope),
  );
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
  if (thrillLevel >= 4) {
    return 'Keep fair midpoint recommendations first, then optionally add a small number of hyper-local wildcard picks.';
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
  return {
    selectionGoal:
      'Select meetup area candidates near the middle of the group so everyone can reach them as fairly as possible.',
    localModeRule:
      thrillLevel >= 3
        ? 'Do not replace the balanced core with only local picks. Add local wildcard areas on top of the fair midpoint core.'
        : 'Return only balanced midpoint recommendations.',
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

export function getRuntimeAiConfig(body: any) {
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

export async function fetchOpenAiCandidateSelection({
  apiKey,
  model,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
}: {
  apiKey: string;
  model: string;
  participants: any[];
  insights: any[];
  selectedCategory: string;
  selectionMode: string;
  thrillLevel: number;
  candidateScope: string;
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(allowedIds.length, selectionMode, thrillLevel, candidateScope);

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
            'You are selecting meeting area candidates for a Seoul metro meetup app. Return JSON only. Choose only from the allowed candidate ids. Keep a fair midpoint core for the whole group, and only add a few local wildcard picks when the thrill level requests it. Favor fairness across participants, travel plausibility, and category fit.',
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

export async function fetchUpstageCandidateSelection({
  apiKey,
  model,
  baseUrl,
  participants,
  insights,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
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
}) {
  const allowedIds = insights
    .map((insight) => insight?.candidate?.id)
    .filter((candidateId): candidateId is string => typeof candidateId === 'string' && candidateId.length > 0);
  const targetCount = pickTargetCount(allowedIds.length, selectionMode, thrillLevel, candidateScope);
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
            'Return a JSON object with keys candidate_ids and summary. candidate_ids must contain only allowed ids and match the requested targetCount. Always preserve balanced midpoint recommendations, and only add local wildcard picks on top of that core when the thrill level is high.',
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
