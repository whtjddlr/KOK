import { useEffect, useMemo, useState } from 'react';
import { Candidate, Participant, TravelInfo, WinnerRouteSnapshot } from '../types';
import { getCarTravelInfo, getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo, getTransitServicePeriodKey } from '../lib/odsay-transit';
import { isWinnerRouteSnapshotForInput } from '../lib/route-snapshot';

type TravelInfoStatus = 'loading' | 'ready' | 'partial' | 'error';

interface WinnerTravelInfoResult {
  travelInfo: TravelInfo[];
  transitTravelInfo: TravelInfo[];
  carTravelInfo: TravelInfo[];
  status: TravelInfoStatus;
  transitStatus: TravelInfoStatus;
  error: string | null;
  transitError: string | null;
  hasLiveData: boolean;
  hasTransitLiveData: boolean;
  hasPartialFallback: boolean;
}

const winnerCache = new Map<string, TravelInfo[]>();
const winnerTransitCache = new Map<string, TravelInfo[]>();

function getWinnerCacheKey(
  participants: Participant[],
  winner: Candidate,
  transitServicePeriod: string,
) {
  const participantKey = participants
    .map((participant) =>
      [
        participant.id,
        participant.coordinates.lat.toFixed(6),
        participant.coordinates.lng.toFixed(6),
        participant.travelMode ?? 'transit',
      ].join(':'),
    )
    .sort()
    .join('|');

  return [
    winner.id,
    winner.coordinates.lat.toFixed(6),
    winner.coordinates.lng.toFixed(6),
    transitServicePeriod,
    participantKey,
  ].join(':');
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

function getTransitFallbackMessage(message: string | null, partial: boolean) {
  const hasOdsayNoRoute =
    message?.includes('ODsay 대중교통 경로를 찾지 못했습니다') ||
    message?.includes('대중교통 경로를 찾지 못했습니다') ||
    message?.includes('ODsay 대중교통 경로 응답에 추천 경로가 없습니다') ||
    message?.includes('대중교통 경로 응답에 추천 경로가 없습니다');

  if (hasOdsayNoRoute) {
    return partial
      ? '일부 경로는 예상이에요.'
      : '대중교통은 예상이에요.';
  }

  if (message) {
    return partial ? '일부 경로는 예상이에요.' : '대중교통은 예상이에요.';
  }

  return partial ? '일부 경로는 예상이에요.' : '대중교통은 예상이에요.';
}

export function useWinnerTravelInfo(
  participants: Participant[],
  winner: Candidate,
  routeSnapshot?: WinnerRouteSnapshot | null,
): WinnerTravelInfoResult {
  const transitServicePeriod = getTransitServicePeriodKey();
  const syncedRouteSnapshot = useMemo(
    () =>
      isWinnerRouteSnapshotForInput(routeSnapshot, participants, winner)
        ? routeSnapshot
        : null,
    [participants, routeSnapshot, winner],
  );
  const transitTravelInfo = useMemo(
    () => participants.map((participant) => getTravelInfo(participant, winner)),
    [participants, winner],
  );
  const fallbackCarTravelInfo = useMemo(
    () => participants.map((participant) => getCarTravelInfo(participant, winner)),
    [participants, winner],
  );
  const cacheKey = useMemo(
    () => getWinnerCacheKey(participants, winner, transitServicePeriod),
    [participants, transitServicePeriod, winner],
  );

  const [travelInfo, setTravelInfo] = useState<TravelInfo[]>(
    syncedRouteSnapshot?.carTravelInfo ?? winnerCache.get(cacheKey) ?? fallbackCarTravelInfo,
  );
  const [liveTransitTravelInfo, setLiveTransitTravelInfo] = useState<TravelInfo[]>(
    syncedRouteSnapshot?.transitTravelInfo ?? winnerTransitCache.get(cacheKey) ?? transitTravelInfo,
  );
  const [status, setStatus] = useState<TravelInfoStatus>(
    syncedRouteSnapshot?.carStatus ?? (winnerCache.has(cacheKey) ? 'ready' : 'loading'),
  );
  const [transitStatus, setTransitStatus] = useState<TravelInfoStatus>(
    syncedRouteSnapshot?.transitStatus ??
      (winnerTransitCache.has(cacheKey) ? 'ready' : 'loading'),
  );
  const [error, setError] = useState<string | null>(syncedRouteSnapshot?.carError ?? null);
  const [transitError, setTransitError] = useState<string | null>(
    syncedRouteSnapshot?.transitError ?? null,
  );

  useEffect(() => {
    let active = true;

    if (syncedRouteSnapshot) {
      setLiveTransitTravelInfo(syncedRouteSnapshot.transitTravelInfo);
      setTransitStatus(syncedRouteSnapshot.transitStatus);
      setTransitError(syncedRouteSnapshot.transitError);
      return () => {
        active = false;
      };
    }

    const cached = winnerTransitCache.get(cacheKey);

    if (cached) {
      setLiveTransitTravelInfo(cached);
      setTransitStatus('ready');
      setTransitError(null);
      return () => {
        active = false;
      };
    }

    setLiveTransitTravelInfo(transitTravelInfo);
    setTransitStatus('loading');
    setTransitError(null);

    Promise.allSettled(
      participants.map((participant) => fetchOdsayTransitTravelInfo(participant, winner)),
    )
      .then((results) => {
        if (!active) {
          return;
        }

        const merged = results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          }

          return transitTravelInfo[index];
        });
        const liveCount = merged.filter((item) => item.source === 'transit').length;
        const firstRouteError = getFirstRouteError(results);

        if (!liveCount) {
          setLiveTransitTravelInfo(transitTravelInfo);
          setTransitStatus('error');
          setTransitError(getTransitFallbackMessage(firstRouteError, false));
          return;
        }

        winnerTransitCache.set(cacheKey, merged);
        setLiveTransitTravelInfo(merged);
        setTransitStatus(liveCount === merged.length ? 'ready' : 'partial');
        setTransitError(
          liveCount === merged.length
            ? null
            : getTransitFallbackMessage(firstRouteError, true),
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setLiveTransitTravelInfo(transitTravelInfo);
        setTransitStatus('error');
        setTransitError('대중교통은 예상이에요.');
      });

    return () => {
      active = false;
    };
  }, [cacheKey, participants, syncedRouteSnapshot, transitTravelInfo, winner]);

  useEffect(() => {
    let active = true;

    if (syncedRouteSnapshot) {
      setTravelInfo(syncedRouteSnapshot.carTravelInfo);
      setStatus(syncedRouteSnapshot.carStatus);
      setError(syncedRouteSnapshot.carError);
      return () => {
        active = false;
      };
    }

    const cached = winnerCache.get(cacheKey);

    if (cached) {
      setTravelInfo(cached);
      setStatus('ready');
      setError(null);
      return () => {
        active = false;
      };
    }

    setTravelInfo(fallbackCarTravelInfo);
    setStatus('loading');
    setError(null);

    Promise.allSettled(
      participants.map((participant) => fetchDirectionsTravelInfo(participant, winner)),
    )
      .then((results) => {
        if (!active) {
          return;
        }

        const merged = results.map((result, index) => {
          if (result.status === 'fulfilled') {
            return result.value;
          }

          return fallbackCarTravelInfo[index];
        });

        const liveCount = merged.filter((item) => item.source === 'directions').length;
        const firstRouteError = getFirstRouteError(results);

        if (!liveCount) {
          setTravelInfo(fallbackCarTravelInfo);
          setStatus('error');
          setError('자동차는 예상이에요.');
          return;
        }

        winnerCache.set(cacheKey, merged);
        setTravelInfo(merged);
        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : '일부 경로는 예상이에요.',
        );
      })
      .catch((error) => {
        if (!active) {
          return;
        }

        setTravelInfo(fallbackCarTravelInfo);
        setStatus('error');
        setError('자동차는 예상이에요.');
      });

    return () => {
      active = false;
    };
  }, [cacheKey, fallbackCarTravelInfo, participants, syncedRouteSnapshot, winner]);

  const hasLiveData = travelInfo.some((item) => item.source === 'directions');
  const hasTransitLiveData = liveTransitTravelInfo.some((item) => item.source === 'transit');
  const hasPartialFallback = travelInfo.some((item) => item.source !== 'directions');

  return {
    travelInfo,
    transitTravelInfo: liveTransitTravelInfo,
    carTravelInfo: travelInfo,
    status,
    transitStatus,
    error,
    transitError,
    hasLiveData,
    hasTransitLiveData,
    hasPartialFallback,
  };
}
