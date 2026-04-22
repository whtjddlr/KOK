import { useEffect, useMemo, useState } from 'react';
import { Candidate, Participant, TravelInfo } from '../types';
import { getTravelInfo } from '../lib/meeting';
import { fetchDirectionsTravelInfo } from '../lib/naver-directions';

type TravelInfoStatus = 'loading' | 'ready' | 'partial' | 'error';

interface WinnerTravelInfoResult {
  travelInfo: TravelInfo[];
  status: TravelInfoStatus;
  error: string | null;
  hasLiveData: boolean;
  hasPartialFallback: boolean;
}

const winnerCache = new Map<string, TravelInfo[]>();

function getWinnerCacheKey(participants: Participant[], winner: Candidate) {
  const participantIds = participants.map((participant) => participant.id).sort().join(',');
  return `${winner.id}:${participantIds}`;
}

export function useWinnerTravelInfo(
  participants: Participant[],
  winner: Candidate,
): WinnerTravelInfoResult {
  const fallbackTravelInfo = useMemo(
    () => participants.map((participant) => getTravelInfo(participant, winner)),
    [participants, winner],
  );
  const cacheKey = useMemo(
    () => getWinnerCacheKey(participants, winner),
    [participants, winner],
  );

  const [travelInfo, setTravelInfo] = useState<TravelInfo[]>(
    winnerCache.get(cacheKey) ?? fallbackTravelInfo,
  );
  const [status, setStatus] = useState<TravelInfoStatus>(
    winnerCache.has(cacheKey) ? 'ready' : 'loading',
  );
  const [error, setError] = useState<string | null>(null);

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

    setTravelInfo(fallbackTravelInfo);
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

          return fallbackTravelInfo[index];
        });

        const liveCount = merged.filter((item) => item.source === 'directions').length;

        if (!liveCount) {
          setTravelInfo(fallbackTravelInfo);
          setStatus('error');
          setError('실시간 이동비를 가져오지 못해 현재는 추정값으로 안내 중입니다.');
          return;
        }

        winnerCache.set(cacheKey, merged);
        setTravelInfo(merged);
        setStatus(liveCount === merged.length ? 'ready' : 'partial');
        setError(
          liveCount === merged.length
            ? null
            : '일부 경로는 실시간 응답이 없어 추정값으로 보정했습니다.',
        );
      })
      .catch(() => {
        if (!active) {
          return;
        }

        setTravelInfo(fallbackTravelInfo);
        setStatus('error');
        setError('실시간 이동비를 가져오지 못해 현재는 추정값으로 안내 중입니다.');
      });

    return () => {
      active = false;
    };
  }, [cacheKey, fallbackTravelInfo, participants, winner]);

  const hasLiveData = travelInfo.some((item) => item.source === 'directions');
  const hasPartialFallback = travelInfo.some((item) => item.source !== 'directions');

  return {
    travelInfo,
    status,
    error,
    hasLiveData,
    hasPartialFallback,
  };
}
