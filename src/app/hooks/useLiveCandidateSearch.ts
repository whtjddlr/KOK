import { useEffect, useMemo, useState } from 'react';
import { fetchLiveCandidates } from '../lib/live-candidates';
import {
  ensureParticipantLocalCoverage,
  getFairnessSpreadLimit,
  getHotplaceRankingScore,
  getPracticalRouteGuardedInsights,
} from '../lib/meeting';
import {
  CandidateInsight,
  CandidateScopeKey,
  MeetCategoryKey,
  Participant,
  RuntimeAiConfig,
  SelectionModeKey,
  ThrillLevel,
} from '../types';

type LiveCandidateStatus = 'idle' | 'loading' | 'ready' | 'error';

interface LiveCandidateSearchResult {
  candidateIds: string[];
  status: LiveCandidateStatus;
  source: string | null;
  message: string | null;
  error: string | null;
}

interface CachedResult {
  candidateIds: string[];
  source: string | null;
  message: string | null;
}

const liveCandidateCache = new Map<string, CachedResult>();

function getCorridorDriftPenalty(insight: CandidateInsight) {
  const axisDrift = Math.max(0, insight.axisDistance - 4.2);
  const centerDrift = Math.max(0, insight.centerDistance - 8);
  const equalLongTripPenalty =
    insight.spreadDuration <= 10 && insight.averageDuration >= 34
      ? (insight.averageDuration - 33) * 2.2
      : 0;

  return axisDrift * 8.5 + centerDrift * 5.4 + equalLongTripPenalty;
}

function isDetachedFairnessTrap(insight: CandidateInsight) {
  return (
    insight.axisDistance >= 6 &&
    insight.centerDistance >= 7.5 &&
    insight.averageDuration >= 34 &&
    insight.spreadDuration <= 15
  );
}

function getFairnessBand(
  insight: CandidateInsight,
  thrillLevel: ThrillLevel,
  participants: Participant[],
) {
  const limit = getFairnessSpreadLimit(thrillLevel, participants);
  const softLimit = Math.min(getFairnessSpreadLimit(5, participants), limit + 5);
  const isDetached = isDetachedFairnessTrap(insight);

  if (insight.spreadDuration <= limit && !isDetached) {
    return 0;
  }

  if (insight.spreadDuration <= softLimit && !isDetached) {
    return 1;
  }

  if (insight.spreadDuration <= limit) {
    return 2;
  }

  if (insight.spreadDuration <= softLimit) {
    return 3;
  }

  return 4;
}

function getFairBalancedSearchScore(insight: CandidateInsight, participants: Participant[]) {
  const longTripPenalty =
    Math.max(0, insight.averageDuration - 48) * 0.85 +
    Math.max(0, insight.farthestDuration - 58) * 0.55;
  const twoPersonCorridorPenalty =
    participants.length === 2
      ? insight.axisDistance * 1.35 + Math.max(0, insight.centerDistance - 7) * 0.65
      : 0;

  return (
    insight.spreadDuration * 1.6 +
    insight.averageDuration * 0.85 +
    insight.farthestDuration * 0.62 +
    insight.centerDistance * 0.8 +
    insight.axisDistance * 1.05 +
    longTripPenalty +
    twoPersonCorridorPenalty +
    getCorridorDriftPenalty(insight) +
    (insight.allReachable ? 0 : 24) +
    (insight.categoryMatched ? 0 : 6)
  );
}

function getCacheKey(
  participants: Participant[],
  insights: CandidateInsight[],
  selectedCategory: MeetCategoryKey,
  selectionMode: SelectionModeKey,
  thrillLevel: ThrillLevel,
  candidateScope: CandidateScopeKey,
  aiConfigSignature: string,
  candidateTargetCount: number,
) {
  const participantKey = participants
    .map(
      (participant) =>
        `${participant.id}:${participant.coordinates.lat.toFixed(3)}:${participant.coordinates.lng.toFixed(3)}:${participant.maxTravelTime}:${participant.travelMode ?? 'transit'}:${participant.gender ?? 'unspecified'}`,
    )
    .join('|');
  const insightKey = insights.map((insight) => insight.candidate.id).join(',');

  return `${selectedCategory}:${selectionMode}:${thrillLevel}:${candidateScope}:${candidateTargetCount}:${aiConfigSignature}:${participantKey}:${insightKey}`;
}

export function useLiveCandidateSearch(
  participants: Participant[],
  insights: CandidateInsight[],
  fallbackCandidateIds: string[],
  selectedCategory: MeetCategoryKey,
  selectionMode: SelectionModeKey,
  thrillLevel: ThrillLevel,
  candidateScope: CandidateScopeKey,
  runtimeAiConfig: RuntimeAiConfig | null,
  aiConfigSignature: string,
  candidateTargetCount: number,
): LiveCandidateSearchResult {
  const normalizedInsights = useMemo(
    () => {
      const isLocalHeavyMode = selectionMode === 'neighborhood' && thrillLevel >= 4;
      const isHouseFrontMode = selectionMode === 'neighborhood' && thrillLevel >= 5;
      const isHotplaceMode = selectionMode === 'hotplace';
      const routeGuardedInsights =
        selectionMode === 'balance'
          ? getPracticalRouteGuardedInsights(
              insights,
              Math.min(4, candidateTargetCount || insights.length),
            )
          : insights;
      const searchInsights = routeGuardedInsights.length ? routeGuardedInsights : insights;
      const fairnessSortedInsights = [...searchInsights].sort((left, right) => {
        const leftBand = getFairnessBand(left, thrillLevel, participants);
        const rightBand = getFairnessBand(right, thrillLevel, participants);

        if (leftBand !== rightBand) {
          return leftBand - rightBand;
        }

        const scoreDiff =
          getFairBalancedSearchScore(left, participants) -
          getFairBalancedSearchScore(right, participants);

        if (Math.abs(scoreDiff) > 1) {
          return scoreDiff;
        }

        if (left.spreadDuration !== right.spreadDuration) {
          return left.spreadDuration - right.spreadDuration;
        }

        if (left.farthestDuration !== right.farthestDuration) {
          return left.farthestDuration - right.farthestDuration;
        }

        return left.averageDuration - right.averageDuration;
      });
      const sortedInsights = isHotplaceMode
        ? [...searchInsights].sort(
            (left, right) =>
              getHotplaceRankingScore(left, thrillLevel) -
              getHotplaceRankingScore(right, thrillLevel),
          )
        : fairnessSortedInsights;
      const baseLimit = Math.min(
        Math.max(
          isHouseFrontMode ? 34 : isLocalHeavyMode || isHotplaceMode ? 30 : 24,
          candidateTargetCount + (isLocalHeavyMode ? participants.length * 5 : isHotplaceMode ? 10 : 6),
        ),
        searchInsights.length,
      );
      const baseInsights = sortedInsights.slice(0, baseLimit);
      const localWildcardInsights = isLocalHeavyMode
        ? fairnessSortedInsights.filter(
            (insight) =>
              (isHouseFrontMode && insight.candidate.id.startsWith('thrill-hyper-')) ||
              insight.candidate.id.startsWith('thrill-local-') ||
              insight.candidate.id.startsWith('participant-near-'),
          )
        : [];

      return ensureParticipantLocalCoverage(
        sortedInsights,
        [...baseInsights, ...localWildcardInsights],
        participants,
        Math.min(
          searchInsights.length,
          baseLimit + localWildcardInsights.length + participants.length,
        ),
        {
          selectionMode,
          thrillLevel,
        },
      );
    },
    [candidateTargetCount, insights, participants, selectionMode, thrillLevel],
  );
  const fallbackCandidateKey = useMemo(
    () => fallbackCandidateIds.join(','),
    [fallbackCandidateIds],
  );
  const cacheKey = useMemo(
    () =>
      [
        getCacheKey(
          participants,
          normalizedInsights,
          selectedCategory,
          selectionMode,
          thrillLevel,
          candidateScope,
          aiConfigSignature,
          candidateTargetCount,
        ),
        fallbackCandidateKey,
      ].join(':fallback:'),
    [
      participants,
      normalizedInsights,
      fallbackCandidateKey,
      selectedCategory,
      selectionMode,
      thrillLevel,
      candidateScope,
      aiConfigSignature,
      candidateTargetCount,
    ],
  );

  const [candidateIds, setCandidateIds] = useState<string[]>(
    liveCandidateCache.get(cacheKey)?.candidateIds ?? [],
  );
  const [status, setStatus] = useState<LiveCandidateStatus>(
    liveCandidateCache.has(cacheKey) ? 'ready' : 'idle',
  );
  const [source, setSource] = useState<string | null>(
    liveCandidateCache.get(cacheKey)?.source ?? null,
  );
  const [message, setMessage] = useState<string | null>(
    liveCandidateCache.get(cacheKey)?.message ?? null,
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!normalizedInsights.length || participants.length < 2) {
      setCandidateIds([]);
      setStatus('idle');
      setSource(null);
      setMessage(null);
      setError(null);
      return () => {
        active = false;
      };
    }

    const cached = liveCandidateCache.get(cacheKey);
    if (cached) {
      setCandidateIds(cached.candidateIds);
      setStatus('ready');
      setSource(cached.source);
      setMessage(cached.message);
      setError(null);
      return () => {
        active = false;
      };
    }

    setStatus('loading');
    setSource(null);
    setMessage(null);
    setError(null);

    fetchLiveCandidates({
      participants,
      insights: normalizedInsights,
      fallbackCandidateIds,
      selectedCategory,
      selectionMode,
      thrillLevel,
      candidateScope,
      runtimeAiConfig,
      candidateTargetCount,
    })
      .then((result) => {
        if (!active) {
          return;
        }

        if (result.candidateIds.length) {
          const cachedResult: CachedResult = {
            candidateIds: result.candidateIds,
            source: result.source ?? null,
            message: result.message ?? null,
          };

          liveCandidateCache.set(cacheKey, cachedResult);
          setCandidateIds(result.candidateIds);
          setStatus('ready');
          setSource(result.source ?? null);
          setMessage(result.message ?? null);
          setError(null);
          return;
        }

        if (selectionMode === 'balance' && fallbackCandidateIds.length) {
          const cachedResult: CachedResult = {
            candidateIds: fallbackCandidateIds,
            source: result.source ?? 'fallback',
            message: '실시간 후보가 부족해서 중간 기준을 자동으로 넓혀 다시 골랐어요.',
          };

          liveCandidateCache.set(cacheKey, cachedResult);
          setCandidateIds(fallbackCandidateIds);
          setStatus('ready');
          setSource(cachedResult.source);
          setMessage(cachedResult.message);
          setError(null);
          return;
        }

        setCandidateIds([]);
        setStatus('error');
        setSource(result.source ?? null);
        setMessage(result.message ?? null);
        setError(result.message ?? '실시간 후보를 만들지 못해 기본 후보를 사용합니다.');
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        if (selectionMode === 'balance' && fallbackCandidateIds.length) {
          const cachedResult: CachedResult = {
            candidateIds: fallbackCandidateIds,
            source: 'fallback',
            message: '후보 조회가 불안정해서 중간 기준을 자동으로 넓혀 다시 골랐어요.',
          };

          liveCandidateCache.set(cacheKey, cachedResult);
          setCandidateIds(fallbackCandidateIds);
          setStatus('ready');
          setSource(cachedResult.source);
          setMessage(cachedResult.message);
          setError(null);
          return;
        }

        setCandidateIds([]);
        setStatus('error');
        setSource(null);
        setMessage(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : '실시간 후보를 가져오지 못했습니다.',
        );
      });

    return () => {
      active = false;
    };
  }, [
    cacheKey,
  ]);

  return {
    candidateIds,
    status,
    source,
    message,
    error,
  };
}
