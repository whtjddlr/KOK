import { useEffect, useMemo, useState } from 'react';
import { Candidate, Participant, TravelInfo } from '../types';
import { getCarTravelInfo, getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo, getTransitServicePeriodKey } from '../lib/odsay-transit';

type RouteStatus = 'idle' | 'loading' | 'ready' | 'partial' | 'error';

interface CandidateTravelRoutesResult {
  routes: TravelInfo[];
  status: RouteStatus;
  error: string | null;
  hasLiveData: boolean;
}

function getFallbackRoute(participant: Participant, candidate: Candidate) {
  return participant.travelMode === 'car'
    ? getCarTravelInfo(participant, candidate)
    : getTravelInfo(participant, candidate);
}

async function fetchRoute(participant: Participant, candidate: Candidate) {
  if (participant.travelMode === 'car') {
    return fetchDirectionsTravelInfo(participant, candidate);
  }

  return fetchOdsayTransitTravelInfo(participant, candidate);
}

function getRouteSignature(
  participants: Participant[],
  candidate: Candidate | null,
  transitServicePeriod: string,
) {
  return JSON.stringify({
    candidate: candidate ? [candidate.id, candidate.coordinates.lat, candidate.coordinates.lng] : null,
    transitPeriod: transitServicePeriod,
    participants: participants.map((participant) => [
      participant.id,
      participant.coordinates.lat,
      participant.coordinates.lng,
      participant.travelMode ?? 'transit',
    ]),
  });
}

function getReasonMessage(reason: unknown) {
  if (reason instanceof Error && reason.message) {
    return reason.message.replace(/ODsay\s*/g, '');
  }

  if (
    reason &&
    typeof reason === 'object' &&
    'message' in reason &&
    typeof (reason as { message?: unknown }).message === 'string'
  ) {
    return (reason as { message: string }).message.replace(/ODsay\s*/g, '');
  }

  return null;
}

function getFirstRouteError(results: PromiseSettledResult<TravelInfo>[]) {
  for (const result of results) {
    if (result.status === 'rejected') {
      const message = getReasonMessage(result.reason);

      if (message) {
        return message;
      }
    }
  }

  return null;
}

function getRouteFallbackMessage(message: string | null, partial: boolean) {
  const hasOdsayNoRoute =
    message?.includes('ODsay 대중교통 경로를 찾지 못했습니다') ||
    message?.includes('대중교통 경로를 찾지 못했습니다') ||
    message?.includes('ODsay 대중교통 경로 응답에 추천 경로가 없습니다') ||
    message?.includes('대중교통 경로 응답에 추천 경로가 없습니다');

  if (hasOdsayNoRoute) {
    return partial
      ? '일부 대중교통 경로는 실시간 응답이 없어 예상값으로 보정했어요.'
      : '대중교통 실시간 경로를 못 받아서 예상 이동시간으로 보정했어요.';
  }

  if (message) {
    return partial
      ? `일부 경로는 예상값으로 보정했어요. ${message}`
      : message;
  }

  return partial
    ? '일부 경로는 응답이 없어 예상값으로 보정했어요.'
    : '실제 경로 응답이 없어 예상 이동 정보로 보여드려요.';
}

export function useCandidateTravelRoutes(
  participants: Participant[],
  candidate: Candidate | null,
): CandidateTravelRoutesResult {
  const transitServicePeriod = getTransitServicePeriodKey();
  const fallbackRoutes = useMemo(
    () => (candidate ? participants.map((participant) => getFallbackRoute(participant, candidate)) : []),
    [candidate, participants],
  );
  const routeSignature = useMemo(
    () => getRouteSignature(participants, candidate, transitServicePeriod),
    [candidate, participants, transitServicePeriod],
  );
  const [routes, setRoutes] = useState<TravelInfo[]>(fallbackRoutes);
  const [status, setStatus] = useState<RouteStatus>(candidate ? 'loading' : 'idle');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    if (!candidate || !participants.length) {
      setRoutes([]);
      setStatus('idle');
      setError(null);
      return () => {
        active = false;
      };
    }

    setRoutes(fallbackRoutes);
    setStatus('loading');
    setError(null);

    Promise.allSettled(participants.map((participant) => fetchRoute(participant, candidate)))
      .then((results) => {
        if (!active) {
          return;
        }

        const merged = results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          }

          return fallbackRoutes[index];
        });
        const liveCount = merged.filter(
          (route) => route.source === 'transit' || route.source === 'directions',
        ).length;

        setRoutes(merged);

        const firstRouteError = getFirstRouteError(results);

        if (!liveCount) {
          setStatus('error');
          setError(getRouteFallbackMessage(firstRouteError, false));
          return;
        }

        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : getRouteFallbackMessage(firstRouteError, true),
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setRoutes(fallbackRoutes);
        setStatus('error');
        setError(getReasonMessage(error) ?? '실제 경로 응답이 없어 예상 이동 정보로 보여드려요.');
      });

    return () => {
      active = false;
    };
  }, [candidate, fallbackRoutes, participants, routeSignature]);

  return {
    routes,
    status,
    error,
    hasLiveData: routes.some((route) => route.source === 'transit' || route.source === 'directions'),
  };
}
