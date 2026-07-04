import { useEffect, useMemo, useRef, useState } from 'react';
import { Candidate, Participant, TravelInfo } from '../types';
import { getCarTravelInfo, getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo, getTransitServicePeriodKey } from '../lib/odsay-transit';
import {
  getEstimatedRouteFallbackMessage,
  getFirstRouteError,
} from '../lib/route-snapshot';

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

function mergeStableRoutes(currentRoutes: TravelInfo[], fallbackRoutes: TravelInfo[]) {
  const currentByParticipant = new Map(
    currentRoutes.map((route) => [route.participantId, route] as const),
  );

  return fallbackRoutes.map((fallbackRoute) => {
    const currentRoute = currentByParticipant.get(fallbackRoute.participantId);

    if (
      currentRoute &&
      currentRoute.source !== 'estimated' &&
      currentRoute.mode === fallbackRoute.mode
    ) {
      return currentRoute;
    }

    return fallbackRoute;
  });
}

export function useCandidateTravelRoutes(
  participants: Participant[],
  candidate: Candidate | null,
): CandidateTravelRoutesResult {
  const transitServicePeriod = getTransitServicePeriodKey();
  const routeReuseKey = candidate
    ? [
        candidate.id,
        candidate.coordinates.lat.toFixed(6),
        candidate.coordinates.lng.toFixed(6),
        transitServicePeriod,
      ].join(':')
    : '';
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
  const routeReuseKeyRef = useRef(routeReuseKey);

  useEffect(() => {
    let active = true;

    if (!candidate || !participants.length) {
      routeReuseKeyRef.current = routeReuseKey;
      setRoutes([]);
      setStatus('idle');
      setError(null);
      return () => {
        active = false;
      };
    }

    const canReuseCurrentRoutes = routeReuseKeyRef.current === routeReuseKey;
    routeReuseKeyRef.current = routeReuseKey;
    setRoutes((currentRoutes) =>
      canReuseCurrentRoutes ? mergeStableRoutes(currentRoutes, fallbackRoutes) : fallbackRoutes,
    );
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
          setError(getEstimatedRouteFallbackMessage(firstRouteError, false));
          return;
        }

        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : getEstimatedRouteFallbackMessage(firstRouteError, true),
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setRoutes((currentRoutes) =>
          canReuseCurrentRoutes ? mergeStableRoutes(currentRoutes, fallbackRoutes) : fallbackRoutes,
        );
        setStatus('error');
        setError('예상 경로예요.');
      });

    return () => {
      active = false;
    };
  }, [candidate, fallbackRoutes, participants, routeReuseKey, routeSignature]);

  return {
    routes,
    status,
    error,
    hasLiveData: routes.some((route) => route.source === 'transit' || route.source === 'directions'),
  };
}
