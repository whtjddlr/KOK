import { useEffect, useMemo, useState } from 'react';
import { fetchLiveCandidates } from '../lib/live-candidates';
import { ensureParticipantLocalCoverage } from '../lib/meeting';
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
        `${participant.id}:${participant.coordinates.lat.toFixed(3)}:${participant.coordinates.lng.toFixed(3)}:${participant.maxTravelTime}`,
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
      const baseLimit = Math.min(
        Math.max(isHouseFrontMode ? 34 : isLocalHeavyMode ? 30 : 24, candidateTargetCount + (isLocalHeavyMode ? participants.length * 5 : 6)),
        insights.length,
      );
      const baseInsights = insights.slice(0, baseLimit);
      const localWildcardInsights = isLocalHeavyMode
        ? insights.filter(
            (insight) =>
              (isHouseFrontMode && insight.candidate.id.startsWith('thrill-hyper-')) ||
              insight.candidate.id.startsWith('thrill-local-') ||
              insight.candidate.id.startsWith('participant-near-'),
          )
        : [];

      return ensureParticipantLocalCoverage(
        insights,
        [...baseInsights, ...localWildcardInsights],
        participants,
        Math.min(insights.length, baseLimit + localWildcardInsights.length + participants.length),
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
