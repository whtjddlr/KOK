import {
  Candidate,
  CandidateInsight,
  Coordinates,
  DrawPlan,
  Participant,
  ParticipantSettlement,
  Settlement,
  TravelInfo,
} from '../types';

const EARTH_RADIUS_KM = 6371;
const TRANSIT_SPEED_KM_PER_MIN = 0.45;
const BASE_FARE = 1500;
const FARE_PER_KM = 110;
const MIN_TRAVEL_MINUTES = 12;
const MAX_SETTLEMENT_ADJUSTMENT = 3000;

function toRadians(value: number) {
  return (value * Math.PI) / 180;
}

export function getDistanceKm(from: Coordinates, to: Coordinates) {
  const latDiff = toRadians(to.lat - from.lat);
  const lngDiff = toRadians(to.lng - from.lng);
  const startLat = toRadians(from.lat);
  const endLat = toRadians(to.lat);

  const haversine =
    Math.sin(latDiff / 2) * Math.sin(latDiff / 2) +
    Math.cos(startLat) *
      Math.cos(endLat) *
      Math.sin(lngDiff / 2) *
      Math.sin(lngDiff / 2);

  return EARTH_RADIUS_KM * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

export function getTravelDistanceFromMinutes(minutes: number) {
  return minutes * TRANSIT_SPEED_KM_PER_MIN;
}

export function getTravelInfo(participant: Participant, candidate: Candidate): TravelInfo {
  const distance = getDistanceKm(participant.coordinates, candidate.coordinates);
  const duration = Math.max(
    MIN_TRAVEL_MINUTES,
    Math.round(distance / TRANSIT_SPEED_KM_PER_MIN + 7),
  );
  const cost = Math.round((BASE_FARE + Math.max(0, distance - 3) * FARE_PER_KM) / 100) * 100;

  return {
    participantId: participant.id,
    participantName: participant.name,
    distance: Math.round(distance * 10) / 10,
    cost,
    duration,
    source: 'estimated',
  };
}

function formatAccessSummary(participants: Participant[], travelInfo: TravelInfo[]) {
  if (!participants.length || !travelInfo.length) {
    return '출발지를 먼저 입력해 주세요.';
  }

  const limitById = participants.reduce<Record<string, number>>((acc, participant) => {
    acc[participant.id] = participant.maxTravelTime;
    return acc;
  }, {});

  const delayed = travelInfo.filter((info) => info.duration > limitById[info.participantId]);
  const maxDuration = Math.max(...travelInfo.map((info) => info.duration));

  if (!delayed.length) {
    return `모든 참여자가 ${maxDuration}분 안에 도착 가능한 교집합 안입니다.`;
  }

  if (delayed.length === 1) {
    const late = delayed[0];
    return `${late.participantName}는 조금 빠듯하지만, 나머지는 무리 없이 합류할 수 있어요.`;
  }

  return '완벽한 교집합은 아니지만, 가장 부담이 덜한 후보로 압축한 결과예요.';
}

export function getCandidateInsights(
  participants: Participant[],
  candidates: Candidate[],
): CandidateInsight[] {
  if (!participants.length) {
    return [];
  }

  return candidates
    .map((candidate) => {
      const travelInfo = participants.map((participant) => getTravelInfo(participant, candidate));
      const averageDistance =
        travelInfo.reduce((sum, info) => sum + info.distance, 0) / travelInfo.length;
      const averageDuration =
        travelInfo.reduce((sum, info) => sum + info.duration, 0) / travelInfo.length;
      const maxDuration = Math.max(...travelInfo.map((info) => info.duration));
      const allReachable = travelInfo.every((info) => {
        const participant = participants.find((item) => item.id === info.participantId);
        return info.duration <= (participant?.maxTravelTime ?? 45);
      });

      return {
        candidate,
        travelInfo,
        averageDistance: Math.round(averageDistance * 10) / 10,
        averageDuration: Math.round(averageDuration),
        maxDuration,
        allReachable,
        accessSummary: formatAccessSummary(participants, travelInfo),
      };
    })
    .sort((left, right) => {
      if (left.allReachable !== right.allReachable) {
        return left.allReachable ? -1 : 1;
      }

      if (left.maxDuration !== right.maxDuration) {
        return left.maxDuration - right.maxDuration;
      }

      return left.averageDuration - right.averageDuration;
    });
}

export function getDrawPool(insights: CandidateInsight[]) {
  if (insights.length <= 4) {
    return {
      pool: insights,
      fallbackNotice: null,
    };
  }

  const reachable = insights.filter((insight) => insight.allReachable);

  if (reachable.length >= 4) {
    return {
      pool: reachable.slice(0, 6),
      fallbackNotice: null,
    };
  }

  if (reachable.length > 0) {
    return {
      pool: insights.slice(0, 6),
      fallbackNotice: '완벽한 교집합이 좁아서 가장 덜 무리한 후보까지 같이 추첨 풀에 넣었어요.',
    };
  }

  return {
    pool: insights.slice(0, 5),
    fallbackNotice: '모두가 여유롭게 만나는 교집합이 없어, 가장 현실적인 후보들로 추첨 범위를 압축했어요.',
  };
}

function weightedPick(pool: CandidateInsight[]) {
  const total = pool.reduce((sum, insight, index) => {
    const spread =
      Math.max(...insight.travelInfo.map((info) => info.duration)) -
      Math.min(...insight.travelInfo.map((info) => info.duration));
    const accessibilityWeight = insight.allReachable ? 1.25 : 0.85;
    const balanceWeight = Math.max(0.7, 1.5 - spread / 30);
    const speedWeight = Math.max(0.7, 1.45 - insight.averageDuration / 50);
    const moodWeight =
      insight.candidate.drawMood === '반전 픽'
        ? 1.12
        : insight.candidate.drawMood === '무드 픽'
          ? 1.06
          : 0.98;
    const rankWeight = Math.max(0.85, 1.2 - index * 0.04);

    return sum + accessibilityWeight * balanceWeight * speedWeight * moodWeight * rankWeight;
  }, 0);

  let cursor = Math.random() * total;

  for (const [index, insight] of pool.entries()) {
    const spread =
      Math.max(...insight.travelInfo.map((info) => info.duration)) -
      Math.min(...insight.travelInfo.map((info) => info.duration));
    const accessibilityWeight = insight.allReachable ? 1.25 : 0.85;
    const balanceWeight = Math.max(0.7, 1.5 - spread / 30);
    const speedWeight = Math.max(0.7, 1.45 - insight.averageDuration / 50);
    const moodWeight =
      insight.candidate.drawMood === '반전 픽'
        ? 1.12
        : insight.candidate.drawMood === '무드 픽'
          ? 1.06
          : 0.98;
    const rankWeight = Math.max(0.85, 1.2 - index * 0.04);
    const weight =
      accessibilityWeight * balanceWeight * speedWeight * moodWeight * rankWeight;

    cursor -= weight;
    if (cursor <= 0) {
      return insight;
    }
  }

  return pool[0];
}

function sampleWithoutRepeat(pool: CandidateInsight[], count: number, excludedIds: string[] = []) {
  const available = pool.filter((insight) => !excludedIds.includes(insight.candidate.id));
  const picked: CandidateInsight[] = [];

  while (available.length && picked.length < count) {
    const index = Math.floor(Math.random() * available.length);
    picked.push(available[index]);
    available.splice(index, 1);
  }

  return picked;
}

export function buildDrawPlan(insights: CandidateInsight[]): DrawPlan {
  const { pool, fallbackNotice } = getDrawPool(insights);
  const winner = weightedPick(pool);
  const runnerUps = sampleWithoutRepeat(pool, 2, [winner.candidate.id]);
  const finalists = [winner, ...runnerUps].slice(0, Math.min(3, pool.length));
  const rapidShuffle = Array.from({ length: Math.max(12, pool.length * 3) }, () => {
    return pool[Math.floor(Math.random() * pool.length)];
  });
  const finalStretch =
    finalists.length >= 3
      ? [
          finalists[1],
          finalists[2],
          winner,
          finalists[1],
          winner,
          finalists[2],
          winner,
          finalists[1],
          winner,
        ]
      : finalists.length === 2
        ? [finalists[1], winner, finalists[1], winner, finalists[1], winner]
        : [winner, winner, winner];

  return {
    winner,
    finalists,
    sequence: [...rapidShuffle, ...finalStretch],
    fallbackNotice,
  };
}

export function buildSettlementPreview(
  winner: Candidate,
  participants: Participant[],
  payments: Record<string, number>,
  totalCost: number,
  travelInfoOverride?: TravelInfo[],
) {
  const travelInfo =
    travelInfoOverride && travelInfoOverride.length
      ? participants.map((participant) => {
          return (
            travelInfoOverride.find((info) => info.participantId === participant.id) ??
            getTravelInfo(participant, winner)
          );
        })
      : participants.map((participant) => getTravelInfo(participant, winner));
  const perPersonBase = participants.length ? totalCost / participants.length : 0;
  const averageTravelCost =
    travelInfo.reduce((sum, info) => sum + info.cost, 0) / Math.max(travelInfo.length, 1);

  const rows: ParticipantSettlement[] = participants.map((participant) => {
    const travelCost =
      travelInfo.find((info) => info.participantId === participant.id)?.cost ?? averageTravelCost;
    const rawAdjustment = travelCost - averageTravelCost;
    const adjustment = Math.max(
      -MAX_SETTLEMENT_ADJUSTMENT,
      Math.min(MAX_SETTLEMENT_ADJUSTMENT, Math.round(rawAdjustment * 0.6)),
    );
    const shouldPay = Math.max(0, Math.round(perPersonBase - adjustment));
    const paid = payments[participant.id] ?? 0;

    return {
      participant,
      travelCost,
      shouldPay,
      paid,
      balance: paid - shouldPay,
    };
  });

  const debtors = rows
    .filter((row) => row.balance < 0)
    .map((row) => ({ name: row.participant.name, remaining: Math.abs(row.balance) }));
  const creditors = rows
    .filter((row) => row.balance > 0)
    .map((row) => ({ name: row.participant.name, remaining: row.balance }));

  const settlements: Settlement[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;

  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    const amount = Math.min(debtor.remaining, creditor.remaining);

    if (amount > 0) {
      settlements.push({
        from: debtor.name,
        to: creditor.name,
        amount,
      });
    }

    debtor.remaining -= amount;
    creditor.remaining -= amount;

    if (debtor.remaining <= 0) {
      debtorIndex += 1;
    }

    if (creditor.remaining <= 0) {
      creditorIndex += 1;
    }
  }

  return {
    travelInfo,
    rows,
    settlements,
    averageTravelCost: Math.round(averageTravelCost),
    totalPaid: Object.values(payments).reduce((sum, amount) => sum + amount, 0),
    totalExpected: Math.round(rows.reduce((sum, row) => sum + row.shouldPay, 0)),
  };
}
