import {
  buildFallbackCandidateIds,
  fetchOpenAiCandidateSelection,
  fetchUpstageCandidateSelection,
  getRuntimeAiConfig,
  json,
  pickFirstEnv,
  pickTargetCount,
  readJsonBody,
} from './_lib/server';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    json(res, 405, { message: 'Method not allowed' });
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

    if (!insights.length) {
      json(res, 400, { candidateIds: [], message: 'Candidate insights are required.' });
      return;
    }

    const env = process.env;
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
    const runtimeAiConfig = getRuntimeAiConfig(body);
    const effectiveUpstageApiKey =
      runtimeAiConfig?.provider === 'upstage' ? runtimeAiConfig.apiKey : detectedUpstageKey;
    const effectiveUpstageModel =
      runtimeAiConfig?.provider === 'upstage'
        ? runtimeAiConfig.model
        : pickFirstEnv(env, ['UPSTAGE_MODEL', 'SOLAR_MODEL', 'VITE_UPSTAGE_MODEL']) || 'solar-pro3';
    const effectiveUpstageBaseUrl =
      runtimeAiConfig?.provider === 'upstage' && runtimeAiConfig.baseUrl
        ? runtimeAiConfig.baseUrl
        : pickFirstEnv(env, [
            'UPSTAGE_API_BASE_URL',
            'SOLAR_API_BASE_URL',
            'VITE_UPSTAGE_API_BASE_URL',
          ]) || 'https://api.upstage.ai/v1';
    const effectiveOpenAiApiKey =
      runtimeAiConfig?.provider === 'openai' ? runtimeAiConfig.apiKey : detectedOpenAiKey;
    const effectiveOpenAiModel =
      runtimeAiConfig?.provider === 'openai'
        ? runtimeAiConfig.model
        : pickFirstEnv(env, ['OPENAI_MODEL', 'VITE_OPENAI_MODEL']) || 'gpt-4o-mini';

    const safeFallbackIds = buildFallbackCandidateIds(
      insights,
      fallbackCandidateIds,
      selectionMode,
      thrillLevel,
      candidateScope,
    );

    if (!effectiveOpenAiApiKey && !effectiveUpstageApiKey) {
      json(res, 200, {
        candidateIds: safeFallbackIds,
        source: 'heuristic',
        message: 'AI key is missing, so the app is using the fallback candidate logic.',
      });
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

      json(res, 200, {
        candidateIds: candidateIds.length ? candidateIds : safeFallbackIds,
        source: effectiveUpstageApiKey ? 'upstage' : 'openai',
        message: aiSelection.summary || undefined,
      });
    } catch (error) {
      json(res, 200, {
        candidateIds: safeFallbackIds,
        source: 'heuristic',
        message:
          error instanceof Error
            ? error.message
            : 'AI candidate selection failed, so the app is using the fallback list.',
      });
    }
  } catch (error) {
    json(res, 500, {
      candidateIds: [],
      message:
        error instanceof Error
          ? error.message
          : 'Unknown server error while preparing AI meeting candidates.',
    });
  }
}
