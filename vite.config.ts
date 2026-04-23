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
) {
  const baseCount = selectionMode === 'neighborhood' ? 7 : 6;
  const thrillBonus = thrillLevel >= 4 ? 2 : thrillLevel >= 3 ? 1 : 0;
  const scopeBonus = getCandidateScopeBonus(candidateScope);
  return Math.max(1, Math.min(baseCount + thrillBonus + scopeBonus, total));
}

function buildFallbackCandidateIds(
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

  if (thrillLevel >= 4) {
    return 'Allow hyper-local picks that feel almost like meeting right in front of someone’s home.';
  }

  if (thrillLevel === 3) {
    return 'Bias toward local neighborhood picks instead of only middle-point regions.';
  }

  if (thrillLevel === 2) {
    return 'Allow a little more surprise than a safe middle-point pick.';
  }

  return 'Keep the picks realistic and balanced around the middle.';
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

      const upstreamUrl = new URL('https://naveropenapi.apigw.ntruss.com/map-direction/v1/driving');
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

function runtimeCapabilitiesProxy({
  openAiApiKey,
  openAiModel,
  upstageApiKey,
  upstageModel,
  naverSearchClientId,
  naverSearchClientSecret,
}: {
  openAiApiKey: string;
  openAiModel: string;
  upstageApiKey: string;
  upstageModel: string;
  naverSearchClientId: string;
  naverSearchClientSecret: string;
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
      );

      if (!effectiveOpenAiApiKey && !effectiveUpstageApiKey) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: safeFallbackIds,
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
            });

        const allowedIds = new Set(
          insights
            .map((insight) => insight?.candidate?.id)
            .filter((candidateId: unknown): candidateId is string => typeof candidateId === 'string'),
        );
        const candidateIds = aiSelection.candidateIds
          .filter((candidateId) => allowedIds.has(candidateId))
          .slice(0, pickTargetCount(allowedIds.size, selectionMode, thrillLevel, candidateScope));

        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: candidateIds.length ? candidateIds : safeFallbackIds,
            source: effectiveUpstageApiKey ? 'upstage' : 'openai',
            message: aiSelection.summary || undefined,
          }),
        );
      } catch (error) {
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.end(
          JSON.stringify({
            candidateIds: safeFallbackIds,
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

  return {
    plugins: [
      figmaAssetResolver(),
      naverDirectionsProxy(env.VITE_NAVER_MAP_KEY_ID, env.NAVER_MAP_CLIENT_SECRET),
      naverLocalSearchProxy(env.NAVER_SEARCH_CLIENT_ID, env.NAVER_SEARCH_CLIENT_SECRET),
      runtimeCapabilitiesProxy({
        openAiApiKey: detectedOpenAiKey,
        openAiModel: pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini',
        upstageApiKey: detectedUpstageKey,
        upstageModel:
          pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) ||
          'solar-pro3',
        naverSearchClientId: env.NAVER_SEARCH_CLIENT_ID,
        naverSearchClientSecret: env.NAVER_SEARCH_CLIENT_SECRET,
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
