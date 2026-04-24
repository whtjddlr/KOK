import { useEffect, useMemo, useState } from 'react';
import { Candidate, Participant, TravelInfo } from '../types';
import { getCarTravelInfo, getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo } from '../lib/odsay-transit';

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

function getRouteSignature(participants: Participant[], candidate: Candidate | null) {
  return JSON.stringify({
    candidate: candidate ? [candidate.id, candidate.coordinates.lat, candidate.coordinates.lng] : null,
    participants: participants.map((participant) => [
      participant.id,
      participant.coordinates.lat,
      participant.coordinates.lng,
      participant.travelMode ?? 'transit',
    ]),
  });
}

export function useCandidateTravelRoutes(
  participants: Participant[],
  candidate: Candidate | null,
): CandidateTravelRoutesResult {
  const fallbackRoutes = useMemo(
    () => (candidate ? participants.map((participant) => getFallbackRoute(participant, candidate)) : []),
    [candidate, participants],
  );
  const routeSignature = useMemo(
    () => getRouteSignature(participants, candidate),
    [candidate, participants],
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

        if (!liveCount) {
          setStatus('error');
          setError('실제 경로 응답이 없어 예상 이동 정보로 보여드려요.');
          return;
        }

        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : '일부 경로는 응답이 없어 예상값으로 보정했어요.',
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setRoutes(fallbackRoutes);
        setStatus('error');
        setError('실제 경로 응답이 없어 예상 이동 정보로 보여드려요.');
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
