import { useEffect, useMemo, useState } from 'react';
import { fetchAiGeneratedCandidates } from '../lib/ai-generated-candidates';
import {
  Candidate,
  MeetCategoryKey,
  Participant,
  RuntimeAiConfig,
  SelectionModeKey,
  ThrillLevel,
} from '../types';

type AiGeneratedCandidateStatus = 'idle' | 'loading' | 'ready' | 'error';

interface AiGeneratedCandidateResult {
  candidates: Candidate[];
  status: AiGeneratedCandidateStatus;
  source: string | null;
  message: string | null;
  error: string | null;
}

interface CachedResult {
  candidates: Candidate[];
  source: string | null;
  message: string | null;
}

const aiGeneratedCandidateCache = new Map<string, CachedResult>();

function getCacheKey(
  participants: Participant[],
  selectedCategory: MeetCategoryKey,
  selectionMode: SelectionModeKey,
  thrillLevel: ThrillLevel,
  candidateTargetCount: number,
  aiConfigSignature: string,
) {
  const participantKey = participants
    .map(
      (participant) =>
        `${participant.id}:${participant.coordinates.lat.toFixed(3)}:${participant.coordinates.lng.toFixed(3)}:${participant.maxTravelTime}:${participant.travelMode ?? 'transit'}:${participant.gender ?? 'unspecified'}`,
    )
    .join('|');

  return [
    selectedCategory,
    selectionMode,
    thrillLevel,
    candidateTargetCount,
    aiConfigSignature,
    participantKey,
  ].join(':');
}

export function useAiGeneratedCandidates(
  participants: Participant[],
  selectedCategory: MeetCategoryKey,
  selectionMode: SelectionModeKey,
  thrillLevel: ThrillLevel,
  candidateTargetCount: number,
  runtimeAiConfig: RuntimeAiConfig | null,
  aiConfigSignature: string,
): AiGeneratedCandidateResult {
  const eligibleParticipants = useMemo(
    () =>
      participants.filter(
        (participant) =>
          Number.isFinite(participant.coordinates.lat) &&
          Number.isFinite(participant.coordinates.lng),
      ),
    [participants],
  );
  const cacheKey = useMemo(
    () =>
      getCacheKey(
        eligibleParticipants,
        selectedCategory,
        selectionMode,
        thrillLevel,
        candidateTargetCount,
        aiConfigSignature,
      ),
    [
      aiConfigSignature,
      candidateTargetCount,
      eligibleParticipants,
      selectedCategory,
      selectionMode,
      thrillLevel,
    ],
  );
  const cachedInitial = aiGeneratedCandidateCache.get(cacheKey);
  const [candidates, setCandidates] = useState<Candidate[]>(cachedInitial?.candidates ?? []);
  const [status, setStatus] = useState<AiGeneratedCandidateStatus>(
    cachedInitial ? 'ready' : 'idle',
  );
  const [source, setSource] = useState<string | null>(cachedInitial?.source ?? null);
  const [message, setMessage] = useState<string | null>(cachedInitial?.message ?? null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (eligibleParticipants.length < 2 || candidateTargetCount <= 0) {
      setCandidates([]);
      setStatus('idle');
      setSource(null);
      setMessage(null);
      setError(null);
      return () => {
        active = false;
      };
    }

    const cached = aiGeneratedCandidateCache.get(cacheKey);

    if (cached) {
      setCandidates(cached.candidates);
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

    fetchAiGeneratedCandidates({
      participants: eligibleParticipants,
      selectedCategory,
      selectionMode,
      thrillLevel,
      candidateTargetCount,
      runtimeAiConfig,
    })
      .then((result) => {
        if (!active) {
          return;
        }

        const cachedResult: CachedResult = {
          candidates: result.candidates,
          source: result.source ?? null,
          message: result.message ?? null,
        };

        aiGeneratedCandidateCache.set(cacheKey, cachedResult);
        setCandidates(result.candidates);
        setStatus('ready');
        setSource(result.source ?? null);
        setMessage(result.message ?? null);
        setError(null);
      })
      .catch((requestError) => {
        if (!active) {
          return;
        }

        setCandidates([]);
        setStatus('error');
        setSource(null);
        setMessage(null);
        setError(
          requestError instanceof Error
            ? requestError.message
            : 'AI 생성 후보를 가져오지 못했습니다.',
        );
      });

    return () => {
      active = false;
    };
  }, [
    cacheKey,
    candidateTargetCount,
    eligibleParticipants,
    runtimeAiConfig,
    selectedCategory,
    selectionMode,
    thrillLevel,
  ]);

  return {
    candidates,
    status,
    source,
    message,
    error,
  };
}
