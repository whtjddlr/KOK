import { useEffect, useMemo, useState } from 'react';
import { Candidate, Participant, TravelInfo } from '../types';
import { getCarTravelInfo, getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';
import { fetchOdsayTransitTravelInfo } from '../lib/odsay-transit';

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

function getWinnerCacheKey(participants: Participant[], winner: Candidate) {
  const participantIds = participants.map((participant) => participant.id).sort().join(',');
  return `${winner.id}:${participantIds}`;
}

export function useWinnerTravelInfo(
  participants: Participant[],
  winner: Candidate,
): WinnerTravelInfoResult {
  const transitTravelInfo = useMemo(
    () => participants.map((participant) => getTravelInfo(participant, winner)),
    [participants, winner],
  );
  const fallbackCarTravelInfo = useMemo(
    () => participants.map((participant) => getCarTravelInfo(participant, winner)),
    [participants, winner],
  );
  const cacheKey = useMemo(
    () => getWinnerCacheKey(participants, winner),
    [participants, winner],
  );

  const [travelInfo, setTravelInfo] = useState<TravelInfo[]>(
    winnerCache.get(cacheKey) ?? fallbackCarTravelInfo,
  );
  const [liveTransitTravelInfo, setLiveTransitTravelInfo] = useState<TravelInfo[]>(
    winnerTransitCache.get(cacheKey) ?? transitTravelInfo,
  );
  const [status, setStatus] = useState<TravelInfoStatus>(
    winnerCache.has(cacheKey) ? 'ready' : 'loading',
  );
  const [transitStatus, setTransitStatus] = useState<TravelInfoStatus>(
    winnerTransitCache.has(cacheKey) ? 'ready' : 'loading',
  );
  const [error, setError] = useState<string | null>(null);
  const [transitError, setTransitError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
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

        if (!liveCount) {
          setLiveTransitTravelInfo(transitTravelInfo);
          setTransitStatus('error');
          setTransitError('ODsay 대중교통 경로를 가져오지 못해 예상값으로 안내 중입니다.');
          return;
        }

        winnerTransitCache.set(cacheKey, merged);
        setLiveTransitTravelInfo(merged);
        setTransitStatus(liveCount === merged.length ? 'ready' : 'partial');
        setTransitError(
          liveCount === merged.length
            ? null
            : '일부 대중교통 경로는 응답이 없어 예상값으로 보정했습니다.',
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setLiveTransitTravelInfo(transitTravelInfo);
        setTransitStatus('error');
        setTransitError('ODsay 대중교통 경로를 가져오지 못해 예상값으로 안내 중입니다.');
      });

    return () => {
      active = false;
    };
  }, [cacheKey, participants, transitTravelInfo, winner]);

  useEffect(() => {
    let active = true;
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

        if (!liveCount) {
          setTravelInfo(fallbackCarTravelInfo);
          setStatus('error');
          setError('자동차 경로를 가져오지 못해 현재는 예상값으로 안내 중입니다.');
          return;
        }

        winnerCache.set(cacheKey, merged);
        setTravelInfo(merged);
        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : '일부 자동차 경로는 응답이 없어 예상값으로 보정했습니다.',
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setTravelInfo(fallbackCarTravelInfo);
        setStatus('error');
        setError('자동차 경로를 가져오지 못해 현재는 예상값으로 안내 중입니다.');
      });

    return () => {
      active = false;
    };
  }, [cacheKey, fallbackCarTravelInfo, participants, winner]);

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
