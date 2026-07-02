import {
  buildFallbackCandidateIds,
  ensureParticipantLocalCoverageIds,
  fetchOpenAiCandidateSelection,
  fetchUpstageCandidateSelection,
  getRuntimeAiConfig,
  getServerAiProviders,
  json,
  pickTargetCount,
  readJsonBody,
  reorderCandidateIdsByFairness,
} from './_lib/server.js';

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
    const candidateTargetCount =
      typeof body?.candidateTargetCount === 'number' && Number.isFinite(body.candidateTargetCount)
        ? body.candidateTargetCount
        : undefined;
    const effectiveCandidateTargetCount =
      selectionMode === 'neighborhood' && thrillLevel >= 5 && participants.length
        ? Math.max(candidateTargetCount ?? 0, participants.length)
        : candidateTargetCount;

    if (!insights.length) {
      json(res, 400, { candidateIds: [], message: 'Candidate insights are required.' });
      return;
    }

    const env = process.env;
    const runtimeAiConfig = getRuntimeAiConfig(body);
    const aiProviders = getServerAiProviders(env, runtimeAiConfig);

    const safeFallbackBaseIds = ensureParticipantLocalCoverageIds(
      buildFallbackCandidateIds(
        insights,
        fallbackCandidateIds,
        selectionMode,
        thrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
      ),
      insights,
      participants,
      pickTargetCount(
        insights.length,
        selectionMode,
        thrillLevel,
        candidateScope,
        effectiveCandidateTargetCount,
      ),
      selectionMode,
      thrillLevel,
    );
    const safeFallbackIds =
      selectionMode === 'balance'
        ? reorderCandidateIdsByFairness(safeFallbackBaseIds, insights, thrillLevel, participants)
        : safeFallbackBaseIds;

    if (!aiProviders.length) {
      json(res, 200, {
        candidateIds: safeFallbackIds,
        source: 'heuristic',
        message: 'AI key is missing, so the app is using the fallback candidate logic.',
      });
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
        const targetCount = pickTargetCount(
          allowedIds.size,
          selectionMode,
          thrillLevel,
          candidateScope,
          effectiveCandidateTargetCount,
        );
        const candidateIds = aiSelection.candidateIds
          .filter((candidateId) => allowedIds.has(candidateId))
          .slice(0, targetCount);
        const coveredCandidateBaseIds = ensureParticipantLocalCoverageIds(
          candidateIds.length ? candidateIds : safeFallbackIds,
          insights,
          participants,
          targetCount,
          selectionMode,
          thrillLevel,
        );
        const coveredCandidateIds =
          selectionMode === 'balance'
            ? reorderCandidateIdsByFairness(
                coveredCandidateBaseIds,
                insights,
                thrillLevel,
                participants,
              )
            : coveredCandidateBaseIds;

        json(res, 200, {
          candidateIds: coveredCandidateIds.length ? coveredCandidateIds : safeFallbackIds,
          source: aiProvider.provider,
          message: aiSelection.summary || undefined,
        });
        return;
      } catch (error) {
        lastAiError = error;
      }
    }

    json(res, 200, {
      candidateIds: safeFallbackIds,
      source: 'heuristic',
      message:
        lastAiError instanceof Error
          ? lastAiError.message
          : 'AI candidate selection failed, so the app is using the fallback list.',
    });
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
