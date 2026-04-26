import { useEffect, useMemo, useState } from 'react';
import { Candidate, CandidateInsight, Participant, TravelInfo } from '../types';
import {
  applyTravelInfoToCandidateInsight,
  getParticipantEstimatedTravelInfo,
} from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo } from '../lib/odsay-transit';

type VerificationStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'error';

interface VerifiedCandidateInsightsResult {
  insights: CandidateInsight[];
  status: VerificationStatus;
  message: string | null;
  error: string | null;
}

interface VerifiedCandidateResult {
  insight: CandidateInsight;
  liveCount: number;
  routeCount: number;
}

const MAX_VERIFIED_CANDIDATES = 10;
const ROUTE_TIMEOUT_MS = 6500;
const routeCache = new Map<string, TravelInfo>();

function getFallbackRoute(participant: Participant, candidate: Candidate) {
  return getParticipantEstimatedTravelInfo(participant, candidate);
}

function getRouteCacheKey(participant: Participant, candidate: Candidate) {
  return [
    participant.id,
    participant.coordinates.lat.toFixed(5),
    participant.coordinates.lng.toFixed(5),
    participant.travelMode ?? 'transit',
    candidate.id,
    candidate.coordinates.lat.toFixed(5),
    candidate.coordinates.lng.toFixed(5),
  ].join(':');
}

function fetchLiveRoute(participant: Participant, candidate: Candidate) {
  if (participant.travelMode === 'car') {
    return fetchDirectionsTravelInfo(participant, candidate);
  }

  return fetchOdsayTransitTravelInfo(participant, candidate);
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number) {
  return new Promise<T>((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error('실제 경로 응답이 지연되고 있어 예상값으로 보정했어요.'));
    }, timeoutMs);

    promise
      .then(resolve)
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  });
}

async function fetchVerifiedRoute(participant: Participant, candidate: Candidate) {
  const cacheKey = getRouteCacheKey(participant, candidate);
  const cached = routeCache.get(cacheKey);

  if (cached) {
    return cached;
  }

  const route = await withTimeout(fetchLiveRoute(participant, candidate), ROUTE_TIMEOUT_MS);
  routeCache.set(cacheKey, route);

  return route;
}

async function verifyCandidateInsight(
  insight: CandidateInsight,
  participants: Participant[],
): Promise<VerifiedCandidateResult> {
  const results = await Promise.allSettled(
    participants.map((participant) => fetchVerifiedRoute(participant, insight.candidate)),
  );
  const routes = results.map((result, index) => {
    const participant = participants[index];

    if (!participant) {
      return null;
    }

    return result.status === 'fulfilled'
      ? result.value
      : getFallbackRoute(participant, insight.candidate);
  }).filter((route): route is TravelInfo => Boolean(route));
  const liveCount = routes.filter((route) => route.source !== 'estimated').length;
  const verifiedInsight = applyTravelInfoToCandidateInsight(
    insight,
    participants,
    routes,
    'balance',
  );

  return {
    insight: {
      ...verifiedInsight,
      routeVerification: {
        liveRouteCount: liveCount,
        totalRouteCount: routes.length,
        status:
          liveCount === routes.length
            ? 'verified'
            : liveCount > 0
              ? 'partial'
              : 'estimated',
      },
    },
    liveCount,
    routeCount: routes.length,
  };
}

function getVerificationSignature(participants: Participant[], insights: CandidateInsight[]) {
  return JSON.stringify({
    participants: participants.map((participant) => [
      participant.id,
      participant.coordinates.lat.toFixed(5),
      participant.coordinates.lng.toFixed(5),
      participant.travelMode ?? 'transit',
      participant.maxTravelTime,
    ]),
    candidates: insights.slice(0, MAX_VERIFIED_CANDIDATES).map((insight) => [
      insight.candidate.id,
      insight.candidate.coordinates.lat.toFixed(5),
      insight.candidate.coordinates.lng.toFixed(5),
      insight.categoryMatched,
      insight.centerDistance,
      insight.axisDistance,
    ]),
  });
}

export function useFairnessVerifiedCandidateInsights(
  participants: Participant[],
  insights: CandidateInsight[],
): VerifiedCandidateInsightsResult {
  const limitedInsights = useMemo(
    () => insights.slice(0, MAX_VERIFIED_CANDIDATES),
    [insights],
  );
  const verificationSignature = useMemo(
    () => getVerificationSignature(participants, limitedInsights),
    [limitedInsights, participants],
  );
  const [verifiedInsights, setVerifiedInsights] = useState<CandidateInsight[]>(limitedInsights);
  const [status, setStatus] = useState<VerificationStatus>(
    participants.length >= 2 && limitedInsights.length ? 'loading' : 'idle',
  );
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    setVerifiedInsights(limitedInsights);

    if (participants.length < 2 || !limitedInsights.length) {
      setStatus('idle');
      setMessage(null);
      setError(null);
      return () => {
        active = false;
      };
    }

    setStatus('loading');
    setMessage('실제 이동시간으로 공정도를 다시 확인 중이에요.');
    setError(null);

    Promise.all(limitedInsights.map((insight) => verifyCandidateInsight(insight, participants)))
      .then((results) => {
        if (!active) {
          return;
        }

        const nextInsights = results.map((result) => result.insight);
        const totalRouteCount = results.reduce((sum, result) => sum + result.routeCount, 0);
        const liveRouteCount = results.reduce((sum, result) => sum + result.liveCount, 0);

        setVerifiedInsights(nextInsights);

        if (!liveRouteCount) {
          setStatus('error');
          setMessage('실제 경로를 받지 못해 예상 이동시간 기준으로 후보를 보여줘요.');
          setError('실제 경로를 받지 못했어요.');
          return;
        }

        if (liveRouteCount < totalRouteCount) {
          setStatus('partial');
          setMessage('일부 후보는 실제 경로, 일부는 예상값으로 공정도를 다시 계산했어요.');
          setError(null);
          return;
        }

        setStatus('ready');
        setMessage('실제 이동시간 기준으로 공정도를 다시 확인했어요.');
        setError(null);
      })
      .catch((verifyError) => {
        if (!active) {
          return;
        }

        setVerifiedInsights(limitedInsights);
        setStatus('error');
        setMessage('실제 경로 재검증이 지연되어 예상 이동시간 기준으로 후보를 보여줘요.');
        setError(
          verifyError instanceof Error
            ? verifyError.message
            : '실제 경로 재검증을 완료하지 못했어요.',
        );
      });

    return () => {
      active = false;
    };
  }, [verificationSignature]);

  return {
    insights: verifiedInsights,
    status,
    message,
    error,
  };
}
