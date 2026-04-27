import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, Layers3, MapPin, MousePointer2, ScanLine, X } from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  DrawPlan,
  DrawProof,
  Participant,
  SelectionModeKey,
  ThrillLevel,
} from '../types';
import { buildDrawPlan } from '../lib/meeting';
import { loadNaverMapSdk } from '../lib/naver-map';

interface RandomDrawerProps {
  candidateInsights: CandidateInsight[];
  categoryLabel?: string;
  modeLabel?: string;
  selectionMode?: SelectionModeKey;
  thrillLevel?: ThrillLevel;
  candidateScope?: CandidateScopeKey;
  participants?: Participant[];
  drawSeed?: string;
  lockedWinner?: CandidateInsight | null;
  canChoose?: boolean;
  autoChoose?: boolean;
  sharedSelectedSlotIndex?: number | null;
  sharedChoicePlayAt?: string | null;
  initialLadderBars?: LadderBar[] | null;
  waitingMessage?: string;
  onChoice?: (slotIndex: number, state?: { ladderBars: LadderBar[] }) => void;
  onLadderBarsChange?: (bars: LadderBar[]) => void;
  onComplete: (winner: Candidate, proof: DrawProof) => void;
  onClose: () => void;
}

type DrawPhase = 'choosing' | 'boot' | 'dropping' | 'settling' | 'impact' | 'revealed';
type DrawVariant = 'card-shuffle' | 'shell-game' | 'ladder-game' | 'spin-wheel' | 'dart-map';

type PlacedCandidate = {
  insight: CandidateInsight;
  x: number;
  y: number;
};

type DrawChoiceSlot = {
  id: string;
  label: string;
  insight: CandidateInsight;
  x: number;
  y: number;
};

type DrawChoiceLock = {
  seed: string;
  code: string;
  slots: DrawChoiceSlot[];
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

const drawVariants: DrawVariant[] = [
  'card-shuffle',
  'ladder-game',
  'spin-wheel',
];

const drawVariantAccents: Record<DrawVariant, string> = {
  'card-shuffle': '#f59e0b',
  'shell-game': '#a78bfa',
  'ladder-game': '#22c55e',
  'spin-wheel': '#5dd9d0',
  'dart-map': '#ef4444',
};

const drawVariantDisplayLabels: Record<DrawVariant, string> = {
  'card-shuffle': '카드 셔플',
  'shell-game': '야바위',
  'ladder-game': '사다리타기',
  'spin-wheel': '돌림판',
  'dart-map': '지도 사인펜',
};

function getRandomVariant(): DrawVariant {
  return drawVariants[Math.floor(Math.random() * drawVariants.length)] ?? 'card-shuffle';
}

function getSeededVariant(seed: string): DrawVariant {
  return drawVariants[Math.floor(seededNumber(seed, 'variant') * drawVariants.length)] ?? 'card-shuffle';
}

function getChoiceDisplayLabel(variant: DrawVariant, slot: DrawChoiceSlot, index: number) {
  if (variant === 'shell-game') {
    return ['왼쪽', '가운데', '오른쪽'][index] ?? `${slot.label}번`;
  }

  if (variant === 'card-shuffle') {
    return `카드 ${slot.label}`;
  }

  if (variant === 'ladder-game') {
    return `사다리 ${slot.label}`;
  }

  if (variant === 'spin-wheel') {
    return `칸 ${slot.label}`;
  }

  if (variant === 'dart-map') {
    return `사인펜 ${slot.label}`;
  }

  return `${slot.label}번`;
}

function hashText(value: string) {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).toUpperCase().padStart(8, '0');
}

function seededNumber(seed: string, key: number | string) {
  return parseInt(hashText(`${seed}:${key}`).slice(0, 8), 16) / 0xffffffff;
}

function getLadderColumnX(index: number, count: number) {
  if (count <= 0) {
    return 50;
  }

  return ((index + 0.5) * 100) / count;
}

export type LadderBar = {
  id: string;
  leftIndex: number;
  source?: 'auto' | 'user';
  y: number;
};

type LadderPathSegment =
  | { type: 'vertical'; x: number; y1: number; y2: number }
  | { type: 'horizontal'; x1: number; x2: number; y: number };

function getLadderBars(lock: DrawChoiceLock): LadderBar[] {
  const count = lock.slots.length;

  if (count <= 1) {
    return [];
  }

  const rowCount = Math.max(4, Math.min(7, count + 2));
  let previousLeftIndex = -10;

  return Array.from({ length: rowCount }, (_, rowIndex) => {
    const candidates = Array.from({ length: count - 1 }, (_, index) => index).filter(
      (index) => Math.abs(index - previousLeftIndex) > 0,
    );
    const leftIndex =
      candidates[
        Math.floor(seededNumber(lock.seed, `ladder-bar-${rowIndex}`) * candidates.length)
      ] ?? 0;
    previousLeftIndex = leftIndex;

    return {
      id: `${lock.seed}-${rowIndex}-${leftIndex}`,
      leftIndex,
      source: 'auto',
      y: 16 + (rowIndex * 68) / Math.max(rowCount - 1, 1),
    };
  });
}

function sortLadderBars(bars: LadderBar[]) {
  return [...bars].sort((first, second) => first.y - second.y);
}

function getLadderBarsSignature(bars: LadderBar[]) {
  return sortLadderBars(bars)
    .map((bar) => `${bar.id}:${bar.leftIndex}:${bar.y}:${bar.source ?? 'auto'}`)
    .join('|');
}

function getLadderResultIndex(
  lock: DrawChoiceLock,
  startIndex: number,
  bars: LadderBar[] = getLadderBars(lock),
) {
  const count = lock.slots.length;
  let currentIndex = clamp(Math.round(startIndex), 0, Math.max(count - 1, 0));

  sortLadderBars(bars).forEach((bar) => {
    if (bar.leftIndex === currentIndex) {
      currentIndex += 1;
    } else if (bar.leftIndex + 1 === currentIndex) {
      currentIndex -= 1;
    }
  });

  return clamp(currentIndex, 0, Math.max(count - 1, 0));
}

function getLadderResultSlot(
  lock: DrawChoiceLock,
  startIndex: number,
  bars: LadderBar[] = getLadderBars(lock),
) {
  return lock.slots[getLadderResultIndex(lock, startIndex, bars)] ?? lock.slots[startIndex] ?? null;
}

function getLadderPathSegments(
  lock: DrawChoiceLock,
  startIndex: number,
  bars: LadderBar[] = getLadderBars(lock),
): LadderPathSegment[] {
  const count = lock.slots.length;
  let currentIndex = clamp(Math.round(startIndex), 0, Math.max(count - 1, 0));
  let currentX = getLadderColumnX(currentIndex, count);
  let lastY = 0;
  const segments: LadderPathSegment[] = [];

  sortLadderBars(bars).forEach((bar) => {
    const nextIndex =
      bar.leftIndex === currentIndex
        ? currentIndex + 1
        : bar.leftIndex + 1 === currentIndex
          ? currentIndex - 1
          : currentIndex;
    const nextX = getLadderColumnX(nextIndex, count);

    segments.push({ type: 'vertical', x: currentX, y1: lastY, y2: bar.y });

    if (nextIndex !== currentIndex) {
      segments.push({ type: 'horizontal', x1: currentX, x2: nextX, y: bar.y });
      currentIndex = nextIndex;
      currentX = nextX;
    }

    lastY = bar.y;
  });

  segments.push({ type: 'vertical', x: currentX, y1: lastY, y2: 100 });

  return segments;
}

function getLadderBarFromPoint(lock: DrawChoiceLock, x: number, y: number): LadderBar | null {
  const count = lock.slots.length;

  if (count <= 1) {
    return null;
  }

  let closestLeftIndex = 0;
  let closestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < count - 1; index += 1) {
    const centerX = (getLadderColumnX(index, count) + getLadderColumnX(index + 1, count)) / 2;
    const distance = Math.abs(x - centerX);

    if (distance < closestDistance) {
      closestDistance = distance;
      closestLeftIndex = index;
    }
  }

  const snappedY = Math.round(clamp(y, 12, 88) / 4) * 4;

  return {
    id: `user-${closestLeftIndex}-${snappedY}-${Date.now().toString(36)}`,
    leftIndex: closestLeftIndex,
    source: 'user',
    y: snappedY,
  };
}

function shouldAddLadderBar(bars: LadderBar[], nextBar: LadderBar) {
  return !bars.some(
    (bar) =>
      Math.abs(bar.y - nextBar.y) < 5 &&
      Math.abs(bar.leftIndex - nextBar.leftIndex) <= 1,
  );
}

const wheelColors = [
  '#ff7b6b',
  '#f59e0b',
  '#22c55e',
  '#5dd9d0',
  '#60a5fa',
  '#a78bfa',
  '#f472b6',
  '#84cc16',
  '#fb7185',
  '#38bdf8',
];

function getShortestAngleDelta(from: number, to: number) {
  return ((((to - from) % 360) + 540) % 360) - 180;
}

function getPointerAngle(event: ReactPointerEvent<HTMLElement>, element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  const centerX = rect.left + rect.width / 2;
  const centerY = rect.top + rect.height / 2;

  return (Math.atan2(event.clientY - centerY, event.clientX - centerX) * 180) / Math.PI + 90;
}

function getWheelSelectedIndex(rotation: number, count: number) {
  if (count <= 0) {
    return 0;
  }

  const segmentAngle = 360 / count;
  const normalizedRotation = ((rotation % 360) + 360) % 360;

  return Math.floor(((360 - normalizedRotation) % 360) / segmentAngle);
}

function getWheelRotationForIndex(index: number, count: number, nearRotation = 0) {
  if (count <= 0) {
    return 0;
  }

  const segmentAngle = 360 / count;
  const targetRotation = -(index * segmentAngle + segmentAngle / 2);

  return targetRotation + Math.round((nearRotation - targetRotation) / 360) * 360;
}

function getWheelBackground(count: number) {
  if (count <= 0) {
    return '#f8fafc';
  }

  const segmentAngle = 360 / count;
  const stops = Array.from({ length: count }, (_, index) => {
    const start = index * segmentAngle;
    const end = (index + 1) * segmentAngle;
    const color = wheelColors[index % wheelColors.length];

    return `${color} ${start}deg ${end}deg`;
  });

  return `conic-gradient(${stops.join(', ')})`;
}

function createChoiceSeed() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getChoiceCount(variant: DrawVariant, sourceLength: number) {
  if (variant === 'dart-map') {
    return Math.min(6, Math.max(sourceLength, 1));
  }

  return Math.max(sourceLength, 1);
}

function buildChoiceLock(
  insights: CandidateInsight[],
  variant: DrawVariant,
  seedOverride?: string,
): DrawChoiceLock {
  const seed = seedOverride ?? createChoiceSeed();
  const uniqueInsights = getUniqueInsights(insights);
  const source = uniqueInsights.length ? uniqueInsights : insights;
  const count = getChoiceCount(variant, source.length);
  const shuffled = [...source].sort((a, b) => {
    const aValue = seededNumber(seed, `${a.candidate.id}:${a.candidate.name}`);
    const bValue = seededNumber(seed, `${b.candidate.id}:${b.candidate.name}`);

    return aValue - bValue;
  });
  const slots = Array.from({ length: count }, (_, index) => {
    const insight = shuffled[index % shuffled.length] ?? source[0];
    const angle = (Math.PI * 2 * index) / Math.max(count, 1) - Math.PI / 2;

    return {
      id: `${variant}-${index}`,
      label: `${index + 1}`,
      insight,
      x: clamp(50 + Math.cos(angle) * 31 + (seededNumber(seed, index) - 0.5) * 7, 13, 87),
      y: clamp(51 + Math.sin(angle) * 27 + (seededNumber(seed, index + 11) - 0.5) * 7, 16, 84),
    };
  });
  const code = hashText(
    JSON.stringify({
      seed,
      variant,
      slots: slots.map((slot) => ({
        label: slot.label,
        candidateId: slot.insight.candidate.id,
      })),
    }),
  );

  return { seed, code, slots };
}

function layoutCandidates(insights: CandidateInsight[]): PlacedCandidate[] {
  if (!insights.length) {
    return [];
  }

  const latitudes = insights.map((item) => item.candidate.coordinates.lat);
  const longitudes = insights.map((item) => item.candidate.coordinates.lng);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latRange = Math.max(maxLat - minLat, 0.012);
  const lngRange = Math.max(maxLng - minLng, 0.012);

  return insights.map((insight, index) => {
    const xBase = ((insight.candidate.coordinates.lng - minLng) / lngRange) * 100;
    const yBase = (1 - (insight.candidate.coordinates.lat - minLat) / latRange) * 100;
    const jitterX = Math.sin(index * 1.9) * 4.2;
    const jitterY = Math.cos(index * 1.4) * 3.6;

    return {
      insight,
      x: clamp(13 + xBase * 0.74 + jitterX, 11, 89),
      y: clamp(15 + yBase * 0.68 + jitterY, 14, 84),
    };
  });
}

function getUniqueInsights(insights: CandidateInsight[]) {
  const seen = new Set<string>();

  return insights.filter((insight) => {
    if (seen.has(insight.candidate.id)) {
      return false;
    }

    seen.add(insight.candidate.id);
    return true;
  });
}

function getUniqueVisiblePoints(points: PlacedCandidate[]) {
  const seen = new Set<string>();

  return points.filter((point) => {
    const key = point.insight.candidate.id;
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

function getPointForInsight(points: PlacedCandidate[], insight: CandidateInsight) {
  return points.find((point) => point.insight.candidate.id === insight.candidate.id) ?? points[0] ?? null;
}

function getPinCameraState(activePoint: PlacedCandidate | null, phase: DrawPhase) {
  if (!activePoint) {
    return { x: '0%', y: '0%', scale: 1 };
  }

  return {
    x: `${(50 - activePoint.x) * 0.24}%`,
    y: `${(50 - activePoint.y) * 0.18}%`,
    scale: phase === 'impact' ? 1.12 : phase === 'revealed' ? 1.08 : 1.02,
  };
}

function PinMarker({
  active = false,
  winner = false,
  landed = false,
}: {
  active?: boolean;
  winner?: boolean;
  landed?: boolean;
}) {
  return (
    <div className="relative flex flex-col items-center">
      {(active || winner) && (
        <motion.div
          className="absolute top-8 h-10 w-10 rounded-full bg-[#ff7b6b]/24"
          animate={{ scale: [0.55, 1.8, 1.15], opacity: [0.6, 0.04, 0.2] }}
          transition={{
            duration: winner ? 1.1 : 0.7,
            repeat: winner ? 2 : 0,
            ease: 'easeOut',
          }}
        />
      )}
      <div
        className={`relative flex h-12 w-12 items-center justify-center rounded-full shadow-[0_14px_28px_rgba(31,42,68,0.18)] ${
          winner
            ? 'bg-[#ff7b6b] text-white'
            : active
              ? 'bg-[#1f2a44] text-white'
              : landed
                ? 'bg-white text-[#1f2a44]'
                : 'bg-[#f5f1eb] text-[#6b7280]'
        }`}
      >
        <MapPin className="h-6 w-6" strokeWidth={2.4} />
      </div>
      <div
        className={`mt-[-2px] h-2.5 w-2.5 rotate-45 rounded-[3px] ${
          winner ? 'bg-[#ff7b6b]' : active ? 'bg-[#1f2a44]' : 'bg-white'
        }`}
      />
    </div>
  );
}

function PinDropStage({
  phase,
  currentInsight,
  plan,
  placedCandidates,
  visiblePoints,
  activePoint,
  winnerPoint,
  cameraState,
  landedIds,
  dropKey,
  progress,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  plan: DrawPlan;
  placedCandidates: PlacedCandidate[];
  visiblePoints: PlacedCandidate[];
  activePoint: PlacedCandidate | null;
  winnerPoint: PlacedCandidate | null;
  cameraState: { x: string; y: string; scale: number };
  landedIds: Set<string>;
  dropKey: number;
  progress: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#e7edf2] bg-[#eef3f7] shadow-inner">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(31,42,68,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(31,42,68,0.06)_1px,transparent_1px)] bg-[size:34px_34px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_18%,rgba(255,123,107,0.12),transparent_28%),radial-gradient(circle_at_78%_72%,rgba(78,205,196,0.14),transparent_25%)]" />

      <div className="relative h-[25rem] overflow-hidden sm:h-[29rem]">
        <motion.div
          className="absolute inset-0"
          animate={cameraState}
          transition={{ duration: phase === 'impact' ? 0.26 : 0.38, ease: 'easeOut' }}
        >
          <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
            <path
              d="M7 24 L20 15 L35 19 L47 13 L61 21 L76 15 L91 27 L87 43 L92 60 L80 80 L63 88 L49 82 L31 90 L15 79 L12 61 L7 45 Z"
              fill="rgba(255,255,255,0.62)"
              stroke="rgba(31,42,68,0.08)"
              strokeWidth="0.8"
            />
            <path
              d="M9 54 C21 45, 32 58, 45 51 S71 38, 91 48"
              fill="none"
              stroke="rgba(78,205,196,0.48)"
              strokeWidth="2.6"
              strokeLinecap="round"
            />
            <path
              d="M15 34 L27 30 L40 36 L54 30 L69 36 L83 32"
              fill="none"
              stroke="rgba(31,42,68,0.15)"
              strokeWidth="0.9"
              strokeDasharray="2 3"
            />
            <path
              d="M17 72 L31 64 L45 69 L59 61 L74 67 L88 60"
              fill="none"
              stroke="rgba(31,42,68,0.13)"
              strokeWidth="0.9"
              strokeDasharray="2 3"
            />
            <text x="43" y="49" fontSize="3.2" fill="rgba(31,42,68,0.28)">
              RIVER
            </text>
          </svg>

          {visiblePoints.map((point) => {
            const isActive = point.insight.candidate.id === currentInsight.candidate.id;
            const isWinner = point.insight.candidate.id === plan.winner.candidate.id;
            const hasLanded = landedIds.has(point.insight.candidate.id);
            const showWinner = phase === 'revealed' && isWinner;

            return (
              <div
                key={`landed-${point.insight.candidate.id}`}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${point.x}%`, top: `${point.y}%` }}
              >
                <motion.div
                  animate={{
                    opacity: showWinner ? 1 : hasLanded ? 0.56 : 0.18,
                    scale: showWinner ? 1.18 : hasLanded ? 0.86 : 0.68,
                  }}
                  transition={{ duration: 0.22 }}
                >
                  <PinMarker landed={hasLanded} winner={showWinner} />
                </motion.div>

                {(isActive || showWinner) && (
                  <motion.div
                    initial={{ opacity: 0, y: 5, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="absolute left-1/2 top-full mt-1 -translate-x-1/2 rounded-full bg-white/95 px-3 py-1.5 text-xs text-[#1f2a44] shadow-sm"
                  >
                    {point.insight.candidate.name}
                  </motion.div>
                )}
              </div>
            );
          })}

          <AnimatePresence mode="wait">
            {activePoint && phase !== 'revealed' ? (
              <motion.div
                key={`falling-${currentInsight.candidate.id}-${dropKey}`}
                className="absolute -translate-x-1/2 -translate-y-full"
                style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }}
                initial={{ y: -420, scale: 0.86, opacity: 0 }}
                animate={{ y: 0, scale: phase === 'impact' ? 1.22 : 1.02, opacity: 1 }}
                exit={{ opacity: 0, scale: 0.8 }}
                transition={{
                  type: 'spring',
                  stiffness: phase === 'impact' ? 320 : 250,
                  damping: phase === 'impact' ? 15 : 19,
                  mass: 0.72,
                }}
              >
                <PinMarker active winner={phase === 'impact'} />
              </motion.div>
            ) : null}
          </AnimatePresence>
        </motion.div>

        {(phase === 'impact' || phase === 'revealed') && winnerPoint ? (
          <motion.div
            key={`impact-${dropKey}`}
            initial={{ opacity: 0.7, scale: 0.22 }}
            animate={{ opacity: 0, scale: 3 }}
            transition={{ duration: 0.58, ease: 'easeOut' }}
            className="absolute h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ff7b6b] bg-[#ff7b6b]/20"
            style={{ left: `${winnerPoint.x}%`, top: `${winnerPoint.y}%` }}
          />
        ) : null}

        {phase === 'revealed' && (
          <DrawStatusCard phase={phase} currentInsight={currentInsight} progress={progress} />
        )}
      </div>
    </div>
  );
}

function CardShuffleStage({
  phase,
  currentInsight,
  plan,
  progress,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  plan: DrawPlan;
  progress: number;
}) {
  const cards = plan.finalists.length ? plan.finalists : [plan.winner];
  const displayCards = Array.from({ length: Math.max(5, cards.length) }, (_, index) => cards[index % cards.length]);
  const activeCandidate = phase === 'revealed' ? plan.winner : currentInsight;

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#e8e0d6] bg-[#171f35] shadow-inner">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_18%,rgba(255,123,107,0.24),transparent_28%),radial-gradient(circle_at_78%_70%,rgba(78,205,196,0.2),transparent_24%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(135deg,rgba(255,255,255,0.08)_1px,transparent_1px)] bg-[size:28px_28px]" />

      <div className="relative h-[25rem] overflow-hidden sm:h-[29rem]">
        <div className="absolute inset-x-6 top-6 flex items-center justify-between text-xs text-white/54">
          <span>SHUFFLE</span>
          <span>{displayCards.length} CARDS</span>
        </div>

        <div className="absolute inset-0 flex items-center justify-center">
          {displayCards.map((insight, index) => {
            const isWinner = phase === 'revealed' && insight.candidate.id === plan.winner.candidate.id;
            const offset = index - (displayCards.length - 1) / 2;

            return (
              <motion.div
                key={`${insight.candidate.id}-${index}`}
                className={`absolute h-56 w-40 rounded-[1.6rem] border p-4 shadow-[0_28px_55px_rgba(0,0,0,0.28)] ${
                  isWinner
                    ? 'border-[#ff7b6b] bg-[#ff7b6b] text-white'
                    : 'border-white/24 bg-white text-[#1f2a44]'
                }`}
                initial={{ x: offset * 54, y: 18, rotate: offset * 9, opacity: 0 }}
                animate={{
                  x:
                    phase === 'revealed'
                      ? isWinner
                        ? 0
                        : offset * 84
                      : [offset * 64, offset * -42, offset * 58],
                  y: phase === 'revealed' ? (isWinner ? -10 : 42) : [22, -18, 16],
                  rotate: phase === 'revealed' ? (isWinner ? 0 : offset * 12) : [offset * 8, offset * -14, offset * 10],
                  scale: isWinner ? 1.18 : phase === 'revealed' ? 0.82 : 0.98,
                  opacity: phase === 'revealed' && !isWinner ? 0.32 : 1,
                }}
                transition={{ duration: phase === 'revealed' ? 0.42 : 0.72, ease: 'easeInOut' }}
              >
                <div className="mb-8 flex items-center justify-between text-xs opacity-70">
                  <span>RANDOM</span>
                  <Layers3 className="h-4 w-4" />
                </div>
                <div className="mt-10 text-center">
                  <div className="text-2xl font-semibold tracking-[-0.04em]">
                    {isWinner ? insight.candidate.name : '?'}
                  </div>
                  <div className="mt-2 text-xs opacity-70">
                    {isWinner ? '선택 완료' : '뒤집는 중'}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>

        {phase !== 'revealed' && (
          <motion.div
            className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-white/12 px-5 py-2 text-sm text-white backdrop-blur-sm"
            animate={{ scale: [1, 1.05, 1], opacity: [0.72, 1, 0.72] }}
            transition={{ duration: 0.72, repeat: 2 }}
          >
            {activeCandidate.candidate.name}
          </motion.div>
        )}

        {phase === 'revealed' && (
          <DrawStatusCard phase={phase} currentInsight={plan.winner} progress={progress} />
        )}
      </div>
    </div>
  );
}

function DartMapStage({
  phase,
  currentInsight,
  plan,
  visiblePoints,
  activePoint,
  winnerPoint,
  progress,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  plan: DrawPlan;
  visiblePoints: PlacedCandidate[];
  activePoint: PlacedCandidate | null;
  winnerPoint: PlacedCandidate | null;
  progress: number;
}) {
  const targetPoint = phase === 'impact' || phase === 'revealed' ? winnerPoint : activePoint;

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#e4e8ee] bg-[#edf5ef] shadow-inner">
      <div className="absolute inset-0 bg-[linear-gradient(rgba(31,42,68,0.06)_1px,transparent_1px),linear-gradient(90deg,rgba(31,42,68,0.06)_1px,transparent_1px)] bg-[size:32px_32px]" />
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_48%_48%,rgba(255,255,255,0.72),transparent_18%),radial-gradient(circle_at_20%_30%,rgba(78,205,196,0.18),transparent_25%),radial-gradient(circle_at_78%_65%,rgba(255,123,107,0.16),transparent_24%)]" />

      <div className="relative h-[25rem] overflow-hidden sm:h-[29rem]">
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
          <path d="M8 30 C23 16, 36 25, 47 21 S74 8, 91 25 L88 78 C71 91, 55 77, 42 84 S20 92, 9 70 Z" fill="rgba(255,255,255,0.56)" stroke="rgba(31,42,68,0.1)" />
          <path d="M12 62 C28 48, 36 68, 51 55 S73 42, 89 56" fill="none" stroke="rgba(78,205,196,0.5)" strokeWidth="2.2" strokeLinecap="round" />
          <path d="M18 38 L36 33 L50 39 L66 31 L84 36" fill="none" stroke="rgba(31,42,68,0.15)" strokeWidth="1" strokeDasharray="2 3" />
        </svg>

        {visiblePoints.map((point) => {
          const isWinner = phase === 'revealed' && point.insight.candidate.id === plan.winner.candidate.id;
          const isActive = point.insight.candidate.id === currentInsight.candidate.id;

          return (
            <div
              key={`dart-point-${point.insight.candidate.id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <motion.div
                className={`h-5 w-5 rounded-full border-4 shadow-sm ${
                  isWinner
                    ? 'border-[#ff7b6b] bg-white'
                    : isActive
                      ? 'border-[#1f2a44] bg-white'
                      : 'border-white bg-[#1f2a44]/52'
                }`}
                animate={{ scale: isWinner ? [1, 1.55, 1.08] : isActive ? 1.2 : 1 }}
                transition={{ duration: 0.45, repeat: isWinner ? 2 : 0 }}
              />
            </div>
          );
        })}

        {targetPoint && (
          <motion.div
            key={`dart-${currentInsight.candidate.id}-${phase}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${targetPoint.x}%`, top: `${targetPoint.y}%` }}
            initial={{ x: -360, y: -260, rotate: -38, opacity: 0 }}
            animate={{
              x: 0,
              y: 0,
              rotate: phase === 'impact' || phase === 'revealed' ? 0 : -12,
              opacity: 1,
              scale: phase === 'impact' || phase === 'revealed' ? 1.12 : 0.96,
            }}
            transition={{ type: 'spring', stiffness: 180, damping: 16, mass: 0.7 }}
          >
            <div className="relative">
              <MousePointer2 className="h-16 w-16 fill-[#ff7b6b] text-[#ff7b6b] drop-shadow-[0_14px_24px_rgba(255,123,107,0.28)]" />
              <Crosshair className="absolute -bottom-2 -right-2 h-8 w-8 rounded-full bg-white p-1.5 text-[#1f2a44] shadow-sm" />
            </div>
          </motion.div>
        )}

        {(phase === 'impact' || phase === 'revealed') && winnerPoint && (
          <motion.div
            initial={{ opacity: 0.75, scale: 0.2 }}
            animate={{ opacity: 0, scale: 3.4 }}
            transition={{ duration: 0.6, ease: 'easeOut' }}
            className="absolute h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ff7b6b] bg-[#ff7b6b]/16"
            style={{ left: `${winnerPoint.x}%`, top: `${winnerPoint.y}%` }}
          />
        )}

        {phase === 'revealed' && (
          <DrawStatusCard phase={phase} currentInsight={plan.winner} progress={progress} />
        )}
      </div>
    </div>
  );
}

function RadarStage({
  phase,
  currentInsight,
  plan,
  visiblePoints,
  winnerPoint,
  progress,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  plan: DrawPlan;
  visiblePoints: PlacedCandidate[];
  winnerPoint: PlacedCandidate | null;
  progress: number;
}) {
  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#233050] bg-[#10182b] shadow-inner">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(78,205,196,0.14),transparent_58%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:34px_34px]" />

      <div className="relative h-[25rem] overflow-hidden sm:h-[29rem]">
        <div className="absolute left-1/2 top-1/2 h-80 w-80 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#4ecdc4]/20" />
        <div className="absolute left-1/2 top-1/2 h-56 w-56 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#4ecdc4]/20" />
        <div className="absolute left-1/2 top-1/2 h-32 w-32 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#4ecdc4]/20" />

        <motion.div
          className="absolute left-1/2 top-1/2 h-[34rem] w-1 origin-top rounded-full bg-[linear-gradient(180deg,#4ecdc4,transparent)]"
          animate={{ rotate: phase === 'revealed' ? 520 : 1440 }}
          transition={{ duration: phase === 'revealed' ? 0.6 : 3.8, ease: 'easeOut' }}
        />

        {visiblePoints.map((point) => {
          const isActive = point.insight.candidate.id === currentInsight.candidate.id;
          const isWinner = phase === 'revealed' && point.insight.candidate.id === plan.winner.candidate.id;

          return (
            <div
              key={`radar-${point.insight.candidate.id}`}
              className="absolute -translate-x-1/2 -translate-y-1/2"
              style={{ left: `${point.x}%`, top: `${point.y}%` }}
            >
              <motion.div
                className={`h-4 w-4 rounded-full ${
                  isWinner ? 'bg-[#ff7b6b]' : isActive ? 'bg-[#4ecdc4]' : 'bg-white/40'
                }`}
                animate={{
                  scale: isWinner ? [1, 1.9, 1.2] : isActive ? [1, 1.35, 1] : 1,
                  opacity: isWinner ? 1 : isActive ? 0.95 : 0.48,
                }}
                transition={{ duration: 0.5, repeat: isWinner ? 2 : isActive ? 2 : 0 }}
              />
              {(isActive || isWinner) && (
                <div className="absolute left-1/2 top-full mt-2 -translate-x-1/2 whitespace-nowrap rounded-full bg-white px-3 py-1 text-xs text-[#1f2a44] shadow-sm">
                  {point.insight.candidate.name}
                </div>
              )}
            </div>
          );
        })}

        {phase === 'revealed' && winnerPoint && (
          <motion.div
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${winnerPoint.x}%`, top: `${winnerPoint.y}%` }}
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <ScanLine className="h-20 w-20 text-[#ff7b6b] drop-shadow-[0_0_22px_rgba(255,123,107,0.48)]" />
          </motion.div>
        )}

        {phase === 'revealed' && (
          <DrawStatusCard phase={phase} currentInsight={plan.winner} progress={progress} />
        )}
      </div>
    </div>
  );
}

function ShellGameStage({
  phase,
  currentInsight,
  plan,
  progress,
  selectedLabel,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  plan: DrawPlan;
  progress: number;
  selectedLabel: string;
}) {
  const selectedIndex = Math.max(Number(selectedLabel) - 1, 0);

  return (
    <div className="relative overflow-hidden rounded-[1.75rem] border border-[#e7ddff] bg-[#f7f2ff] shadow-inner">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_18%,rgba(167,139,250,0.22),transparent_30%),radial-gradient(circle_at_82%_72%,rgba(255,123,107,0.16),transparent_24%)]" />
      <div className="relative h-[25rem] overflow-hidden sm:h-[29rem]">
        <div className="absolute inset-x-4 top-8 grid grid-cols-3 gap-4">
          {Array.from({ length: 3 }, (_, index) => {
            const isPicked = index === selectedIndex;

            return (
              <motion.div
                key={index}
                className="relative flex flex-col items-center"
                animate={{
                  x: phase === 'revealed' ? 0 : index % 2 === 0 ? [0, 18, -10, 0] : [0, -18, 10, 0],
                  y: phase === 'revealed' && isPicked ? -22 : 0,
                }}
                transition={{ duration: 0.7, repeat: phase === 'revealed' ? 0 : 2, repeatDelay: 0.12 }}
              >
                <div
                  className={`h-36 w-full rounded-b-[4rem] rounded-t-[1.4rem] shadow-[0_24px_48px_rgba(31,42,68,0.18)] ${
                    isPicked && phase === 'revealed' ? 'bg-[#a78bfa]' : 'bg-white'
                  }`}
                />
                <div className="mt-3 rounded-full bg-[#1f2a44]/10 px-3 py-1 text-xs text-[#1f2a44]">
                  {index + 1}
                </div>
                {isPicked && phase === 'revealed' && (
                  <motion.div
                    initial={{ opacity: 0, y: 8, scale: 0.94 }}
                    animate={{ opacity: 1, y: 0, scale: 1 }}
                    className="absolute top-40 rounded-2xl bg-white px-4 py-3 text-center shadow-sm"
                  >
                    <div className="text-lg font-semibold tracking-[-0.03em] text-[#1a1a2e]">
                      {plan.winner.candidate.name}
                    </div>
                    <div className="mt-1 text-xs text-[#8a94a2]">선택한 컵</div>
                  </motion.div>
                )}
              </motion.div>
            );
          })}
        </div>

        {phase !== 'revealed' && (
          <div className="absolute bottom-24 left-1/2 -translate-x-1/2 rounded-full bg-white/86 px-5 py-2 text-sm text-[#1f2a44] shadow-sm">
            {currentInsight.candidate.name}
          </div>
        )}

        {phase === 'revealed' && (
          <DrawStatusCard phase={phase} currentInsight={plan.winner} progress={progress} />
        )}
      </div>
    </div>
  );
}

function DrawVariantIcon({
  variant,
  className = 'h-5 w-5',
}: {
  variant: DrawVariant;
  className?: string;
}) {
  if (variant === 'card-shuffle') {
    return <Layers3 className={className} />;
  }

  if (variant === 'dart-map') {
    return <Crosshair className={className} />;
  }

  if (variant === 'ladder-game') {
    return <ScanLine className={className} />;
  }

  if (variant === 'spin-wheel') {
    return <Crosshair className={className} />;
  }

  return <MapPin className={className} />;
}

function CardBackGraphic({
  label,
  accent,
}: {
  label: string;
  accent: string;
}) {
  return (
    <div className="relative mx-auto h-48 w-32 [perspective:900px]">
      <motion.div
        className="absolute inset-0 rounded-[1.35rem] bg-white shadow-[0_24px_60px_rgba(0,0,0,0.34)] [transform-style:preserve-3d]"
        whileHover={{ rotateY: -10, rotateX: 8, y: -10 }}
        transition={{ type: 'spring', stiffness: 260, damping: 18 }}
      >
        <div
          className="absolute inset-[0.45rem] overflow-hidden rounded-[1rem]"
          style={{
            background: `radial-gradient(circle at 22% 18%, rgba(255,255,255,0.5), transparent 28%), linear-gradient(145deg, ${accent}, #1f2a44 72%)`,
          }}
        >
          <div className="absolute inset-0 opacity-35 [background:radial-gradient(circle_at_center,transparent_0_28%,rgba(255,255,255,0.9)_29%,transparent_31%),linear-gradient(45deg,rgba(255,255,255,0.18)_1px,transparent_1px)] bg-[size:26px_26px,12px_12px]" />
          <motion.div
            className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/45"
            animate={{ x: ['0%', '330%'], opacity: [0, 0.8, 0] }}
            transition={{ duration: 1.2, repeat: 1, repeatDelay: 1.4 }}
          />
          <div className="absolute left-3 top-3 text-xs font-semibold text-white/80">{label}</div>
          <div className="absolute bottom-3 right-3 rotate-180 text-xs font-semibold text-white/80">{label}</div>
          <div className="absolute left-1/2 top-1/2 flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/45 bg-white/12 text-3xl text-white">
            ?
          </div>
        </div>
      </motion.div>
    </div>
  );
}

function TarotChoiceCard({
  slot,
  index,
  accent,
  compact = false,
  active = false,
  revealed = false,
  dimmed = false,
  onChoose,
}: {
  slot: DrawChoiceSlot;
  index: number;
  accent: string;
  compact?: boolean;
  active?: boolean;
  revealed?: boolean;
  dimmed?: boolean;
  onChoose?: (index: number) => void;
}) {
  const choiceLabel = getChoiceDisplayLabel('card-shuffle', slot, index);
  const showFront = revealed;
  const ranks = ['A', 'K', 'Q', 'J', '10', '9', '8', '7', '6', '5'];
  const suits = ['♠', '♥', '♦', '♣'];
  const rank = ranks[index % ranks.length] ?? `${index + 1}`;
  const suit = suits[index % suits.length] ?? '♠';
  const isRedSuit = suit === '♥' || suit === '♦';

  return (
    <motion.button
      type="button"
      onClick={() => onChoose?.(index)}
      disabled={!onChoose}
      className={`group relative aspect-[5/7] w-full text-left [perspective:900px] transition-opacity ${
        dimmed ? 'opacity-35' : 'opacity-100'
      } ${compact ? 'max-h-40' : ''}`}
      initial={{ opacity: 0, y: 10 }}
      animate={{
        opacity: dimmed ? 0.35 : 1,
        y: active && !revealed ? -3 : 0,
        scale: active ? 1.02 : 1,
      }}
      whileHover={onChoose ? { y: -3, scale: 1.015 } : undefined}
      transition={{
        delay: onChoose ? index * 0.035 : 0,
        duration: 0.28,
      }}
      aria-label={`${choiceLabel} 선택`}
    >
      <motion.div
        className={`relative h-full rounded-[1.05rem] border bg-white p-1.5 shadow-[0_14px_28px_rgba(31,42,68,0.12)] [transform-style:preserve-3d] ${
          active && revealed ? 'border-[#1f2a44]' : 'border-[#e8edf3]'
        }`}
        animate={{ rotateY: showFront ? 180 : 0 }}
        transition={{ duration: 0.82, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="absolute inset-0 overflow-hidden rounded-[1.05rem] bg-white p-2 [backface-visibility:hidden]"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div
            className="relative h-full overflow-hidden rounded-[0.78rem] bg-[#1f2a44]"
            style={{
              boxShadow: `inset 0 0 0 1px ${accent}22`,
            }}
          >
            <div className="absolute inset-[0.48rem] rounded-[0.55rem] border border-white/20" />
            <div className="absolute inset-[1rem] rounded-[0.45rem] border border-white/10" />
            <div className="absolute left-3 top-2.5 text-center text-[13px] font-black leading-none text-white">
              <div>{rank}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: isRedSuit ? '#ff7b6b' : '#ffffff' }}>
                {suit}
              </div>
            </div>
            <div className="absolute bottom-2.5 right-3 rotate-180 text-center text-[13px] font-black leading-none text-white">
              <div>{rank}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: isRedSuit ? '#ff7b6b' : '#ffffff' }}>
                {suit}
              </div>
            </div>
            <div className="absolute left-1/2 top-1/2 flex h-12 w-12 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border border-white/20 bg-white/10 text-2xl font-black text-white">
              ?
            </div>
            {active && !revealed ? (
              <motion.div
                className="absolute inset-0"
                style={{ boxShadow: `inset 0 0 0 3px ${accent}` }}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.18 }}
              />
            ) : null}
          </div>
        </div>

        <div
          className={`absolute inset-0 flex flex-col justify-between rounded-[1.05rem] border p-3 text-center [backface-visibility:hidden] ${
            active && revealed ? 'bg-[#1f2a44] text-white' : 'bg-white text-[#1f2a44]'
          }`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div
            className={`text-left text-base font-black leading-none ${active && revealed ? 'text-white/80' : isRedSuit ? 'text-[#ff7b6b]' : 'text-[#1f2a44]'}`}
          >
            <div>{rank}</div>
            <div className="mt-0.5 text-sm">{suit}</div>
          </div>
          <motion.div
            className="min-w-0"
            initial={false}
            animate={{ opacity: showFront ? 1 : 0, y: showFront ? 0 : 8 }}
            transition={{ delay: 0.45, duration: 0.45 }}
          >
            <div className="line-clamp-2 text-base font-black leading-tight tracking-[-0.05em]">
              {slot.insight.candidate.name}
            </div>
          </motion.div>
          <div className={`self-end rotate-180 text-base font-black leading-none ${active && revealed ? 'text-white/80' : isRedSuit ? 'text-[#ff7b6b]' : 'text-[#1f2a44]'}`}>
            <div>{rank}</div>
            <div className="mt-0.5 text-sm">{suit}</div>
          </div>
        </div>
      </motion.div>
    </motion.button>
  );
}

function TarotCardGrid({
  lock,
  accent,
  selectedIndex = null,
  revealed = false,
  onChoose,
}: {
  lock: DrawChoiceLock;
  accent: string;
  selectedIndex?: number | null;
  revealed?: boolean;
  onChoose?: (index: number) => void;
}) {
  const compact = lock.slots.length >= 7;

  return (
    <div className="max-h-[calc(100vh-5rem)] overflow-y-auto px-1 py-2">
      <div
        className={`mx-auto grid max-w-3xl grid-cols-2 gap-3 sm:gap-4 ${
          lock.slots.length <= 4 ? 'sm:grid-cols-4' : 'sm:grid-cols-5'
        }`}
      >
        {lock.slots.map((slot, index) => {
          const active = selectedIndex === index;

          return (
            <TarotChoiceCard
              key={slot.id}
              slot={slot}
              index={index}
              accent={accent}
              compact={compact}
              active={active}
              revealed={revealed}
              dimmed={selectedIndex !== null && !active && !revealed}
              onChoose={onChoose}
            />
          );
        })}
      </div>
    </div>
  );
}

function WheelFace({
  lock,
  accent,
  rotation,
  selectedIndex = null,
  revealed = false,
  dragStrength = 0,
  isDragging = false,
  isSpinning = false,
  spinDuration = 0.5,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: {
  lock: DrawChoiceLock;
  accent: string;
  rotation: number;
  selectedIndex?: number | null;
  revealed?: boolean;
  dragStrength?: number;
  isDragging?: boolean;
  isSpinning?: boolean;
  spinDuration?: number;
  onPointerDown?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (event: ReactPointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (event: ReactPointerEvent<HTMLDivElement>) => void;
}) {
  const count = Math.max(lock.slots.length, 1);
  const selectedSlot = selectedIndex === null ? null : lock.slots[selectedIndex] ?? null;

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 -translate-y-2 border-x-[13px] border-t-[24px] border-x-transparent border-t-[#1f2a44] drop-shadow-[0_8px_12px_rgba(31,42,68,0.2)]" />
      <div
        role={onPointerDown ? 'slider' : 'img'}
        aria-label="드래그해서 돌림판 돌리기"
        tabIndex={onPointerDown ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        className={`relative mx-auto flex h-72 w-72 touch-none select-none items-center justify-center rounded-full border-[10px] border-white bg-white shadow-[0_28px_70px_rgba(31,42,68,0.18)] ${
          onPointerDown ? 'cursor-grab active:cursor-grabbing' : ''
        }`}
      >
        <motion.div
          className="absolute inset-0 overflow-hidden rounded-full"
          style={{ background: getWheelBackground(count) }}
          animate={{ rotate: rotation }}
          transition={
            isDragging
              ? { duration: 0 }
              : isSpinning
                ? { duration: spinDuration, ease: [0.16, 1, 0.3, 1] }
                : { duration: 0.42, ease: 'easeOut' }
          }
        >
          {lock.slots.map((slot, index) => {
            const angle = (360 / count) * index + 180 / count;
            const active = selectedIndex === index;

            return (
              <div
                key={`wheel-label-${slot.id}`}
                className={`absolute left-1/2 top-1/2 flex h-8 w-8 items-center justify-center rounded-full text-xs font-black shadow-sm ${
                  active && revealed ? 'bg-[#1f2a44] text-white' : 'bg-white/88 text-[#1f2a44]'
                }`}
                style={{
                  transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(-6.8rem) rotate(${-angle}deg)`,
                }}
              >
                {index + 1}
              </div>
            );
          })}
          <div className="absolute inset-[4.15rem] rounded-full border border-white/45 bg-white/16" />
        </motion.div>

        <div className="relative z-10 flex h-28 w-28 flex-col items-center justify-center rounded-full border border-white/80 bg-white/94 px-3 text-center shadow-[0_18px_38px_rgba(31,42,68,0.18)]">
          {revealed && selectedSlot ? (
            <motion.div
              initial={{ opacity: 0, y: 8, scale: 0.96 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              transition={{ duration: 0.5 }}
              className="min-w-0"
            >
              <div className="text-[10px] font-black" style={{ color: accent }}>
                {selectedIndex !== null ? `${selectedIndex + 1}번` : '결과'}
              </div>
              <div className="mt-1 line-clamp-2 text-base font-black leading-tight tracking-[-0.05em] text-[#1f2a44]">
                {selectedSlot.insight.candidate.name}
              </div>
            </motion.div>
          ) : isSpinning ? (
            <>
              <div className="text-xs font-bold text-[#8a94a2]">돌아가는 중</div>
              <motion.div
                className="mt-2 h-2 w-14 overflow-hidden rounded-full bg-[#f0edf0]"
                animate={{ opacity: [0.65, 1, 0.65] }}
                transition={{ duration: 0.75, repeat: 2 }}
              >
                <div className="h-full rounded-full" style={{ width: '70%', backgroundColor: accent }} />
              </motion.div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-[#8a94a2]">
                {isDragging ? '힘 조절 중' : '드래그'}
              </div>
              <div className="mt-1 text-2xl font-black text-[#1f2a44]">돌림</div>
            </>
          )}
        </div>
      </div>

      <div className="mx-auto mt-4 max-w-xs rounded-2xl bg-white/82 px-4 py-3 shadow-sm">
        <div className="flex items-center justify-between text-xs font-bold text-[#76777e]">
          <span>세기</span>
          <span>{Math.round(dragStrength * 100)}%</span>
        </div>
        <div className="mt-2 h-2 overflow-hidden rounded-full bg-[#e7edf2]">
          <motion.div
            className="h-full rounded-full"
            style={{ backgroundColor: accent }}
            animate={{ width: `${Math.max(dragStrength * 100, isDragging ? 8 : 0)}%` }}
            transition={{ duration: 0.14 }}
          />
        </div>
      </div>

      {revealed ? (
        <div className="mt-3 max-h-24 overflow-y-auto rounded-2xl bg-white/70 p-2">
          <div className="grid grid-cols-2 gap-1.5">
            {lock.slots.map((slot, index) => (
              <div
                key={`wheel-option-${slot.id}`}
                className={`min-w-0 rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                  selectedIndex === index
                    ? 'bg-[#1f2a44] text-white'
                    : 'bg-white text-[#1f2a44]'
                }`}
              >
                <span className="mr-1 font-black">{index + 1}</span>
                <span className="align-middle">{slot.insight.candidate.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-3 rounded-2xl bg-white/70 px-4 py-3 text-center text-xs font-semibold text-[#76777e] shadow-sm">
          잡고 끌었다 놓으면 회전 세기가 정해져요.
        </div>
      )}
    </div>
  );
}

function SpinWheelChoice({
  lock,
  accent,
  onChoose,
}: {
  lock: DrawChoiceLock;
  accent: string;
  onChoose?: (index: number) => void;
}) {
  const dragRef = useRef({ lastAngle: 0, totalDelta: 0 });
  const rotationRef = useRef(0);
  const strengthRef = useRef(0);
  const frameRef = useRef<number | null>(null);
  const pendingRotationRef = useRef(0);
  const isDraggingRef = useRef(false);
  const isSpinningRef = useRef(false);
  const timeoutRef = useRef<number | null>(null);
  const [rotation, setRotation] = useState(0);
  const [dragStrength, setDragStrength] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [isSpinning, setIsSpinning] = useState(false);
  const [spinDuration, setSpinDuration] = useState(0.5);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(
    () => () => {
      if (frameRef.current !== null) {
        window.cancelAnimationFrame(frameRef.current);
      }

      if (timeoutRef.current !== null) {
        window.clearTimeout(timeoutRef.current);
      }
    },
    [],
  );

  const updateRotation = (nextRotation: number) => {
    rotationRef.current = nextRotation;
    pendingRotationRef.current = nextRotation;

    if (frameRef.current !== null) {
      return;
    }

    frameRef.current = window.requestAnimationFrame(() => {
      frameRef.current = null;
      setRotation(pendingRotationRef.current);
    });
  };

  const updateStrength = (nextStrength: number) => {
    if (Math.abs(nextStrength - strengthRef.current) < 0.025 && nextStrength < 1) {
      return;
    }

    strengthRef.current = nextStrength;
    setDragStrength(nextStrength);
  };

  const finishSpin = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!isDraggingRef.current || isSpinningRef.current) {
      return;
    }

    event.currentTarget.releasePointerCapture?.(event.pointerId);
    isDraggingRef.current = false;
    setIsDragging(false);

    const totalDelta = dragRef.current.totalDelta;
    const direction = totalDelta >= 0 ? 1 : -1;
    const strength = clamp(Math.abs(totalDelta) / 520, 0.25, 1);
    const bonus = seededNumber(lock.seed, `wheel-${Math.round(rotationRef.current)}-${Math.round(totalDelta)}`) * 180;
    const rawFinalRotation = rotationRef.current + direction * (900 + strength * 1900 + bonus);
    const nextSelectedIndex = getWheelSelectedIndex(rawFinalRotation, lock.slots.length);
    const finalRotation = getWheelRotationForIndex(nextSelectedIndex, lock.slots.length, rawFinalRotation);
    const duration = clamp(2.1 + strength * 2.4, 2.1, 4.6);

    setDragStrength(strength);
    setSpinDuration(duration);
    isSpinningRef.current = true;
    setIsSpinning(true);
    setSelectedIndex(nextSelectedIndex);
    updateRotation(finalRotation);

    timeoutRef.current = window.setTimeout(() => {
      onChoose?.(nextSelectedIndex);
    }, duration * 1000 + 120);
  };

  return (
    <WheelFace
      lock={lock}
      accent={accent}
      rotation={rotation}
      selectedIndex={selectedIndex}
      dragStrength={dragStrength}
      isDragging={isDragging}
      isSpinning={isSpinning}
      spinDuration={spinDuration}
      onPointerDown={(event) => {
        if (isSpinning || !onChoose) {
          return;
        }

        event.currentTarget.setPointerCapture?.(event.pointerId);
        const startAngle = getPointerAngle(event, event.currentTarget);
        dragRef.current = { lastAngle: startAngle, totalDelta: 0 };
        isDraggingRef.current = true;
        strengthRef.current = 0;
        setSelectedIndex(null);
        setDragStrength(0);
        setIsDragging(true);
      }}
      onPointerMove={(event) => {
        if (!isDragging || isSpinning) {
          return;
        }

        const nextAngle = getPointerAngle(event, event.currentTarget);
        const delta = getShortestAngleDelta(dragRef.current.lastAngle, nextAngle);
        const nextRotation = rotationRef.current + delta;
        dragRef.current = {
          lastAngle: nextAngle,
          totalDelta: dragRef.current.totalDelta + delta,
        };
        updateRotation(nextRotation);
        updateStrength(clamp(Math.abs(dragRef.current.totalDelta) / 520, 0.05, 1));
      }}
      onPointerUp={finishSpin}
      onPointerCancel={finishSpin}
    />
  );
}

function CupGraphic({
  label,
  active = true,
}: {
  label: string;
  active?: boolean;
}) {
  return (
    <div className="relative mx-auto flex h-44 w-36 flex-col items-center justify-end">
      <motion.div
        className="relative h-32 w-32 rounded-b-[4.5rem] rounded-t-[1.4rem] shadow-[0_26px_55px_rgba(0,0,0,0.28)]"
        style={{
          background:
            'linear-gradient(115deg, rgba(255,255,255,0.98), rgba(226,218,206,0.98) 42%, rgba(151,135,115,0.98))',
          opacity: active ? 1 : 0.48,
        }}
        animate={active ? { x: [0, 12, -10, 0], rotate: [0, 4, -4, 0] } : { opacity: 0.48 }}
        transition={{ duration: 1.05, repeat: active ? 2 : 0, repeatDelay: 0.16 }}
      >
        <div className="absolute inset-x-2 top-2 h-9 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.96),rgba(181,166,145,0.88))] shadow-inner" />
        <div className="absolute left-5 top-8 h-20 w-5 rounded-full bg-white/55 blur-[1px]" />
        <div className="absolute bottom-3 left-1/2 h-5 w-20 -translate-x-1/2 rounded-[50%] bg-black/10 blur-sm" />
      </motion.div>
      <div className="mt-3 rounded-full bg-white/12 px-3 py-1 text-xs text-white/85">{label}</div>
    </div>
  );
}

function LadderBoard({
  lock,
  accent,
  bars,
  selectedIndex = null,
  revealed = false,
  onBarsChange,
  onChoose,
}: {
  lock: DrawChoiceLock;
  accent: string;
  bars: LadderBar[];
  selectedIndex?: number | null;
  revealed?: boolean;
  onBarsChange?: (bars: LadderBar[]) => void;
  onChoose?: (index: number) => void;
}) {
  const count = lock.slots.length;
  const sortedBars = useMemo(() => sortLadderBars(bars), [bars]);
  const resultIndex =
    selectedIndex === null ? null : getLadderResultIndex(lock, selectedIndex, sortedBars);
  const pathSegments =
    selectedIndex === null ? [] : getLadderPathSegments(lock, selectedIndex, sortedBars);
  const canEditBars = Boolean(onBarsChange && selectedIndex === null && !revealed);
  const isDense = count >= 6;
  const isVeryDense = count >= 8;
  const topButtonClass = isVeryDense
    ? 'h-9 text-xs'
    : isDense
      ? 'h-9 text-xs'
      : 'h-10 text-sm';
  const resultChipClass = isVeryDense
    ? 'h-10 px-1 text-[9px]'
    : isDense
      ? 'h-10 px-1 text-[10px]'
      : 'h-11 px-2 text-[11px]';
  const hiddenResultChipClass = isVeryDense
    ? 'h-10 text-xs'
    : isDense
      ? 'h-10 text-sm'
      : 'h-11 text-sm';
  const boardHeightClass = isVeryDense ? 'h-[25rem] sm:h-[29rem]' : 'h-[26rem] sm:h-[30rem]';
  const slotGridStyle = {
    gridTemplateColumns: `repeat(${Math.max(count, 1)}, minmax(0, 1fr))`,
  };
  const addBarFromPointer = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!canEditBars || !onBarsChange) {
      return;
    }

    const rect = event.currentTarget.getBoundingClientRect();
    const x = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * 100;
    const y = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * 100;
    const nextBar = getLadderBarFromPoint(lock, x, y);

    if (!nextBar || !shouldAddLadderBar(sortedBars, nextBar)) {
      return;
    }

    onBarsChange(sortLadderBars([...sortedBars, nextBar]));
  };

  return (
    <div className={`relative mx-auto w-full max-w-4xl overflow-visible bg-transparent ${boardHeightClass}`}>
      <div
        className="absolute inset-x-0 top-0 z-10 grid gap-2 px-1"
        style={slotGridStyle}
      >
          {lock.slots.map((slot, index) => {
            const active = selectedIndex === index;

            return (
              <button
                key={slot.id}
                type="button"
                onClick={() => onChoose?.(index)}
                disabled={!onChoose}
                className={`flex min-w-0 items-center justify-center rounded-xl border font-bold shadow-sm transition-transform active:scale-95 ${topButtonClass} ${
                  active
                    ? 'border-[#1f2a44] bg-[#1f2a44] text-white'
                    : 'border-[#dbe3ea] bg-white text-[#1f2a44] disabled:text-[#1f2a44]'
                }`}
              >
                <span className="block truncate px-1">{slot.label}</span>
              </button>
            );
          })}
      </div>

      <div className="absolute inset-x-0 bottom-16 top-14 z-0">
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          className={`h-full w-full touch-none overflow-visible ${
              canEditBars ? 'cursor-crosshair' : ''
            }`}
            onPointerDown={(event) => {
              event.currentTarget.setPointerCapture?.(event.pointerId);
              addBarFromPointer(event);
            }}
            onPointerMove={(event) => {
              if (event.buttons === 1) {
                addBarFromPointer(event);
              }
            }}
          >
            <rect width="100" height="100" fill="transparent" />
            {lock.slots.map((slot, index) => {
              const x = getLadderColumnX(index, count);

              return (
                <line
                  key={`column-${slot.id}`}
                  x1={x}
                  x2={x}
                  y1="0"
                  y2="100"
                  stroke="rgba(31,42,68,0.38)"
                  strokeWidth="1.35"
                  strokeLinecap="round"
                />
              );
            })}

            {sortedBars.map((bar) => {
              const x1 = getLadderColumnX(bar.leftIndex, count);
              const x2 = getLadderColumnX(bar.leftIndex + 1, count);

              return (
                <line
                  key={bar.id}
                  x1={x1}
                  x2={x2}
                  y1={bar.y}
                  y2={bar.y}
                  stroke="rgba(31,42,68,0.38)"
                  strokeWidth="1.55"
                  strokeLinecap="round"
                />
              );
            })}

            {pathSegments.map((segment, index) => {
              const path =
                segment.type === 'vertical'
                  ? `M ${segment.x} ${segment.y1} L ${segment.x} ${segment.y2}`
                  : `M ${segment.x1} ${segment.y} L ${segment.x2} ${segment.y}`;

              return (
                <motion.path
                  key={`${segment.type}-${index}`}
                  d={path}
                  fill="none"
                  stroke={accent}
                  strokeWidth="3.2"
                  strokeLinecap="round"
                  initial={revealed ? false : { pathLength: 0, opacity: 0.1 }}
                  animate={{
                    pathLength: 1,
                    opacity: 1,
                  }}
                  transition={{ duration: 0.9, delay: index * 0.22, ease: 'easeInOut' }}
                />
              );
            })}
          </svg>
      </div>

      <div
        className="absolute inset-x-0 bottom-0 z-10 grid gap-2 px-1"
        style={slotGridStyle}
      >
          {lock.slots.map((slot, index) => {
            const active = resultIndex === index;

            return (
              <div
                key={`result-${slot.id}`}
              className={`flex min-w-0 items-center justify-center overflow-hidden rounded-xl border text-center font-semibold leading-tight shadow-sm ${
                  revealed ? resultChipClass : hiddenResultChipClass
                } ${
                  active && revealed
                    ? 'border-[#1f2a44] bg-[#1f2a44] text-white'
                    : revealed
                      ? 'border-[#dbe3ea] bg-white text-[#1f2a44]'
                      : 'border-[#edf2f5] bg-white text-[#8a94a2]'
                }`}
              >
                {revealed ? (
                  <motion.span
                    className="line-clamp-2"
                    initial={active ? { clipPath: 'inset(0 100% 0 0)', opacity: 0 } : { opacity: 0 }}
                    animate={active ? { clipPath: 'inset(0 0% 0 0)', opacity: 1 } : { opacity: 1 }}
                    transition={{
                      delay: active ? 0.55 : 0.9,
                      duration: active ? 1.05 : 0.35,
                      ease: 'easeOut',
                    }}
                  >
                    {slot.insight.candidate.name}
                  </motion.span>
                ) : (
                  <span className="text-base">?</span>
                )}
              </div>
            );
          })}
      </div>
    </div>
  );
}

function DartGraphic({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`relative ${compact ? 'h-12 w-16' : 'h-20 w-28'} rotate-[-28deg]`}>
      <div className="absolute left-5 top-1/2 h-1.5 w-16 -translate-y-1/2 rounded-full bg-[#1f2a44] shadow-[0_8px_18px_rgba(0,0,0,0.24)]" />
      <div className="absolute right-2 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[6px] border-l-[18px] border-y-transparent border-l-[#f8fafc]" />
      <div className="absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-[11px] border-r-[28px] border-y-transparent border-r-[#ff7b6b]" />
      <div className="absolute left-1 top-[calc(50%-13px)] h-0 w-0 border-x-[11px] border-b-[16px] border-x-transparent border-b-[#ffd166]" />
      <div className="absolute left-1 top-[calc(50%-3px)] h-0 w-0 border-x-[11px] border-t-[16px] border-x-transparent border-t-[#4ecdc4]" />
    </div>
  );
}

function MarkerPenGraphic({ compact = false }: { compact?: boolean }) {
  return (
    <div className={`relative ${compact ? 'h-12 w-28' : 'h-16 w-40'}`}>
      <div
        className={`absolute left-0 top-1/2 h-0 w-0 -translate-y-1/2 border-y-transparent ${
          compact
            ? 'border-y-[6px] border-r-[18px] border-r-[#1f2a44]'
            : 'border-y-[8px] border-r-[24px] border-r-[#1f2a44]'
        }`}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-r-full rounded-l-md bg-[#1f2a44] shadow-[0_18px_34px_rgba(31,42,68,0.24)] ${
          compact ? 'left-4 h-5 w-20' : 'left-5 h-7 w-28'
        }`}
      >
        <div className="absolute inset-y-1 left-5 right-3 rounded-full bg-white/12" />
        <div className="absolute bottom-1.5 left-6 right-8 h-1 rounded-full bg-white/22" />
      </div>
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-r-full bg-[#ff7b6b] ${
          compact ? 'left-[5.7rem] h-7 w-8' : 'left-[7.5rem] h-9 w-11'
        }`}
      />
      <div
        className={`absolute top-1/2 -translate-y-1/2 rounded-full border border-white/70 bg-[#f8fafc] ${
          compact ? 'left-[6.9rem] h-6 w-4' : 'left-[9.2rem] h-8 w-5'
        }`}
      />
    </div>
  );
}

function MapSnapshotLayer({
  points,
  winnerId,
  activeId,
  showLabelLimit = 7,
}: {
  points: PlacedCandidate[];
  winnerId?: string | null;
  activeId?: string | null;
  showLabelLimit?: number;
}) {
  return (
    <div className="absolute inset-0 overflow-hidden rounded-[1.5rem] bg-[#f6f2e9]">
      <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
        <path
          d="M-8 62 C12 51, 22 69, 38 58 S62 45, 78 54 S101 47, 110 56 L110 100 L-8 100 Z"
          fill="rgba(122,190,214,0.42)"
        />
        <path
          d="M12 9 C25 3, 39 8, 43 20 C47 34, 30 43, 19 37 C8 31, 0 16, 12 9 Z"
          fill="rgba(116,180,107,0.22)"
        />
        <path
          d="M66 7 C79 5, 91 14, 93 27 C95 42, 75 46, 67 34 C60 24, 55 11, 66 7 Z"
          fill="rgba(116,180,107,0.2)"
        />
        <path
          d="M-3 33 C15 26, 29 39, 44 34 S73 18, 103 27"
          fill="none"
          stroke="rgba(243,167,61,0.8)"
          strokeWidth="3.2"
          strokeLinecap="round"
        />
        <path
          d="M-3 33 C15 26, 29 39, 44 34 S73 18, 103 27"
          fill="none"
          stroke="rgba(255,247,230,0.92)"
          strokeWidth="1.35"
          strokeLinecap="round"
        />
        <path
          d="M5 78 C24 68, 38 78, 53 68 S78 54, 100 62"
          fill="none"
          stroke="rgba(243,167,61,0.72)"
          strokeWidth="2.6"
          strokeLinecap="round"
        />
        <path
          d="M16 -5 C21 18, 28 35, 20 58 S19 82, 31 105"
          fill="none"
          stroke="rgba(243,167,61,0.55)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <path
          d="M58 -5 C52 18, 60 39, 55 57 S48 78, 56 105"
          fill="none"
          stroke="rgba(243,167,61,0.45)"
          strokeWidth="1.8"
          strokeLinecap="round"
        />
        <path
          d="M6 48 L19 41 L32 47 L47 39 L63 45 L79 37 L93 43"
          fill="none"
          stroke="rgba(31,42,68,0.14)"
          strokeWidth="0.9"
          strokeDasharray="2 3"
        />
        <path
          d="M8 18 L22 23 L36 18 L51 25 L66 19 L84 24"
          fill="none"
          stroke="rgba(31,42,68,0.11)"
          strokeWidth="0.8"
          strokeDasharray="2 3"
        />
        <text x="13" y="33" fontSize="5" fontWeight="700" fill="rgba(31,42,68,0.3)">
          은평
        </text>
        <text x="39" y="45" fontSize="5" fontWeight="700" fill="rgba(31,42,68,0.28)">
          종로
        </text>
        <text x="65" y="52" fontSize="5" fontWeight="700" fill="rgba(31,42,68,0.28)">
          성동
        </text>
        <text x="45" y="78" fontSize="5" fontWeight="700" fill="rgba(31,42,68,0.28)">
          용산
        </text>
      </svg>

      <div className="absolute left-3 top-3 rounded-full bg-white/86 px-3 py-1.5 text-[11px] font-semibold text-[#1f2a44] shadow-sm">
        후보 지도 캡처
      </div>
      <div className="absolute bottom-3 left-3 rounded-full bg-white/88 px-3 py-1.5 text-xs text-[#6b7280] shadow-sm">
        Zoom 11
      </div>

      {points.map((point, index) => {
        const candidateId = point.insight.candidate.id;
        const isWinner = candidateId === winnerId;
        const isActive = candidateId === activeId;
        const showLabel = isWinner || isActive || index < showLabelLimit;

        return (
          <div
            key={`snapshot-${candidateId}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: `${point.x}%`, top: `${point.y}%` }}
          >
            <motion.div
              className={`relative flex h-6 w-6 items-center justify-center rounded-full border-[3px] shadow-[0_8px_18px_rgba(31,42,68,0.16)] ${
                isWinner
                  ? 'border-white bg-[#ff7b6b]'
                  : isActive
                    ? 'border-white bg-[#1f2a44]'
                    : 'border-white bg-[#4f7cff]'
              }`}
              animate={{
                scale: isWinner ? [1, 1.34, 1.08] : isActive ? [1, 1.18, 1] : 1,
              }}
              transition={{ duration: 0.6, repeat: isWinner ? 2 : 0 }}
            >
              <span className="text-[10px] font-bold text-white">{index + 1}</span>
              {isWinner && (
                <motion.span
                  className="absolute inset-[-12px] rounded-full border-2 border-[#ff7b6b]"
                  initial={{ scale: 0.3, opacity: 0.65 }}
                  animate={{ scale: 1.9, opacity: 0 }}
                  transition={{ duration: 0.8, repeat: 2, ease: 'easeOut' }}
                />
              )}
            </motion.div>

            {showLabel && (
              <div
                className={`absolute left-1/2 top-full mt-1 -translate-x-1/2 whitespace-nowrap rounded-full px-2.5 py-1 text-[11px] shadow-sm ${
                  isWinner ? 'bg-[#ff7b6b] text-white' : 'bg-white/92 text-[#1f2a44]'
                }`}
              >
                {point.insight.candidate.name}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function escapeMapLabel(value: string) {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function createLiveCandidateMarkerIcon(
  name: string,
  index: number,
  state: 'normal' | 'active' | 'winner',
) {
  const isWinner = state === 'winner';
  const isActive = state === 'active';
  const markerColor = isWinner ? '#ff7b6b' : isActive ? '#1f2a44' : '#2f6df6';
  const label = escapeMapLabel(name);

  return {
    content: `
      <div style="display:flex;flex-direction:column;align-items:center;gap:5px;transform:translateY(-8px);">
        <div style="position:relative;display:flex;align-items:center;justify-content:center;width:${isWinner ? 34 : 28}px;height:${isWinner ? 34 : 28}px;border-radius:9999px;background:${markerColor};color:white;border:3px solid rgba(255,255,255,0.96);box-shadow:0 12px 26px rgba(31,42,68,0.22);font-size:12px;font-weight:800;">
          ${index + 1}
          ${isWinner ? '<span style="position:absolute;inset:-12px;border:2px solid rgba(255,123,107,0.72);border-radius:9999px;"></span>' : ''}
        </div>
        <div style="max-width:124px;padding:4px 8px;border-radius:9999px;background:${isWinner ? 'rgba(255,123,107,0.96)' : 'rgba(255,255,255,0.94)'};color:${isWinner ? '#ffffff' : '#1f2a44'};font-size:11px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 8px 18px rgba(31,42,68,0.12);">
          ${label}
        </div>
      </div>
    `,
    size: new window.naver.maps.Size(140, isWinner ? 68 : 60),
    anchor: new window.naver.maps.Point(70, isWinner ? 34 : 30),
  };
}

function LiveCandidateMapLayer({
  points,
  winnerId,
  activeId,
}: {
  points: PlacedCandidate[];
  winnerId?: string | null;
  activeId?: string | null;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<any>(null);
  const overlaysRef = useRef<any[]>([]);
  const [sdkError, setSdkError] = useState<string | null>(null);
  const [sdkReady, setSdkReady] = useState(false);
  const pointSignature = useMemo(
    () =>
      JSON.stringify(
        points.map((point) => [
          point.insight.candidate.id,
          point.insight.candidate.coordinates.lat,
          point.insight.candidate.coordinates.lng,
        ]),
      ),
    [points],
  );

  useEffect(() => {
    let mounted = true;
    let resizeObserver: ResizeObserver | null = null;

    loadNaverMapSdk()
      .then((maps) => {
        if (!mounted || !containerRef.current) {
          return;
        }

        const initializeOrResizeMap = () => {
          if (!containerRef.current) {
            return false;
          }

          const rect = containerRef.current.getBoundingClientRect();
          const width = Math.max(1, Math.round(rect.width));
          const height = Math.max(1, Math.round(rect.height));

          if (width <= 1 || height <= 1) {
            return false;
          }

          const firstPoint = points[0]?.insight.candidate.coordinates ?? { lat: 37.5665, lng: 126.978 };

          if (!mapRef.current) {
            mapRef.current = new maps.Map(containerRef.current, {
              center: new maps.LatLng(firstPoint.lat, firstPoint.lng),
              zoom: 11,
              minZoom: 8,
              maxZoom: 17,
              size: new maps.Size(width, height),
              zoomControl: false,
              mapDataControl: false,
              scaleControl: false,
              logoControl: false,
              keyboardShortcuts: false,
              scrollWheel: false,
              draggable: false,
              pinchZoom: false,
              disableDoubleTapZoom: true,
              disableDoubleClickZoom: true,
            });
          } else {
            mapRef.current.setSize(new maps.Size(width, height));
          }

          setSdkReady(true);
          return true;
        };

        if (!initializeOrResizeMap() && containerRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            if (initializeOrResizeMap()) {
              resizeObserver?.disconnect();
            }
          });
          resizeObserver.observe(containerRef.current);
          return;
        }

        if (containerRef.current && typeof ResizeObserver !== 'undefined') {
          resizeObserver = new ResizeObserver(() => {
            initializeOrResizeMap();
          });
          resizeObserver.observe(containerRef.current);
        }
      })
      .catch((error: Error) => {
        if (mounted) {
          setSdkError(error.message);
        }
      });

    return () => {
      mounted = false;
      resizeObserver?.disconnect();
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [pointSignature, points]);

  useEffect(() => {
    if (!sdkReady || !mapRef.current || !window.naver?.maps || !points.length) {
      return;
    }

    const map = mapRef.current;
    const maps = window.naver.maps;

    overlaysRef.current.forEach((overlay) => overlay.setMap(null));
    overlaysRef.current = [];

    const bounds = new maps.LatLngBounds();

    points.forEach((point, index) => {
      const candidate = point.insight.candidate;
      const position = new maps.LatLng(candidate.coordinates.lat, candidate.coordinates.lng);
      const state =
        candidate.id === winnerId
          ? 'winner'
          : candidate.id === activeId
            ? 'active'
            : 'normal';

      bounds.extend(position);

      const marker = new maps.Marker({
        map,
        position,
        title: candidate.name,
        icon: createLiveCandidateMarkerIcon(candidate.name, index, state),
      });

      overlaysRef.current.push(marker);
    });

    if (points.length > 1) {
      map.fitBounds(bounds, {
        top: 46,
        right: 34,
        bottom: 64,
        left: 34,
      });
    } else {
      const only = points[0].insight.candidate.coordinates;
      map.setCenter(new maps.LatLng(only.lat, only.lng));
      map.setZoom(12);
    }

    return () => {
      overlaysRef.current.forEach((overlay) => overlay.setMap(null));
      overlaysRef.current = [];
    };
  }, [activeId, pointSignature, points, sdkReady, winnerId]);

  if (sdkError) {
    return <MapSnapshotLayer points={points} winnerId={winnerId} activeId={activeId} />;
  }

  return (
    <div className="absolute inset-0 overflow-hidden rounded-[1.5rem] bg-[#eef3f7]">
      <div ref={containerRef} className="absolute inset-0" />
      {!sdkReady && (
        <MapSnapshotLayer points={points} winnerId={winnerId} activeId={activeId} />
      )}
      <div className="pointer-events-none absolute left-3 top-3 rounded-full bg-white/90 px-3 py-1.5 text-[11px] font-semibold text-[#1f2a44] shadow-sm">
        실시간 후보 지도
      </div>
    </div>
  );
}

function DrawChoiceStage({
  variant,
  lock,
  ladderBars,
  candidatePoints = [],
  onLadderBarsChange,
  onChoose,
  waitingMessage,
}: {
  variant: DrawVariant;
  lock: DrawChoiceLock;
  ladderBars: LadderBar[];
  candidatePoints?: PlacedCandidate[];
  onLadderBarsChange?: (bars: LadderBar[]) => void;
  onChoose?: (index: number) => void;
  waitingMessage?: string;
}) {
  const accent = drawVariantAccents[variant];
  const isMapChoice = variant === 'dart-map';
  const isLadder = variant === 'ladder-game';
  const fallbackMapPoints: PlacedCandidate[] = lock.slots.map((slot) => ({
    insight: slot.insight,
    x: slot.x,
    y: slot.y,
  }));
  const mapPoints = candidatePoints.length ? candidatePoints : fallbackMapPoints;
  const canChoose = Boolean(onChoose);
  const action =
    variant === 'card-shuffle'
      ? '이 카드 뽑기'
      : variant === 'shell-game'
        ? '이 컵 열기'
        : variant === 'ladder-game'
          ? '이 사다리 타기'
          : variant === 'spin-wheel'
            ? '돌림판 돌리기'
            : '사인펜 찍기';

  return (
    <div className="relative overflow-visible">
      <div
        className={
          isLadder
            ? 'relative min-h-[22rem] p-1.5 sm:min-h-[24rem] sm:p-2'
            : variant === 'spin-wheel'
              ? 'relative min-h-[24rem] px-2 py-4 sm:min-h-[26rem] sm:px-4'
              : 'relative px-1 py-2 sm:px-2'
        }
      >
        {isMapChoice ? (
          <div className="relative h-[19rem] overflow-hidden rounded-[1.5rem] border border-white/70 bg-[#dfe8df] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.42)]">
            <LiveCandidateMapLayer points={mapPoints} />
            <motion.div
              className="pointer-events-none absolute right-6 top-5 origin-left"
              animate={{ x: [0, -12, 0], y: [0, 7, 0], rotate: [-26, -18, -26] }}
              transition={{ duration: 1.6, repeat: 2, ease: 'easeInOut' }}
            >
              <MarkerPenGraphic compact />
            </motion.div>

            <button
              type="button"
              onClick={() => onChoose?.(Math.floor(Math.random() * lock.slots.length))}
              disabled={!canChoose}
              className="absolute bottom-4 left-1/2 inline-flex h-12 -translate-x-1/2 items-center justify-center gap-2 rounded-full bg-[#1f2a44] px-5 text-sm font-semibold text-white shadow-[0_18px_34px_rgba(31,42,68,0.22)] transition-transform active:scale-95 disabled:opacity-50"
            >
              <Crosshair className="h-4 w-4" />
              {action}
            </button>
          </div>
        ) : variant === 'card-shuffle' ? (
          <TarotCardGrid lock={lock} accent={accent} onChoose={onChoose} />
        ) : variant === 'ladder-game' ? (
          <LadderBoard
            lock={lock}
            accent={accent}
            bars={ladderBars}
            onBarsChange={onLadderBarsChange}
            onChoose={onChoose}
          />
        ) : variant === 'spin-wheel' ? (
          <SpinWheelChoice lock={lock} accent={accent} onChoose={onChoose} />
        ) : (
          <div
            className={`grid gap-3 ${
              variant === 'shell-game' ? 'sm:grid-cols-3' : 'sm:grid-cols-5'
            }`}
          >
            {lock.slots.map((slot, index) => {
              const choiceLabel = getChoiceDisplayLabel(variant, slot, index);

              return (
                <motion.button
                  key={slot.id}
                  type="button"
                  onClick={() => onChoose?.(index)}
                  disabled={!canChoose}
                  className={`group relative min-h-[10rem] overflow-hidden border p-4 text-left transition-transform active:scale-95 ${
                    variant === 'shell-game'
                      ? 'rounded-[1.4rem] border-white/0 bg-transparent shadow-none'
                      : variant === 'card-shuffle'
                        ? 'rounded-[1.4rem] border-white/0 bg-transparent shadow-none'
                        : 'rounded-[1.4rem] border-white/20 bg-white shadow-[0_18px_42px_rgba(0,0,0,0.22)]'
                  }`}
                  initial={{ opacity: 0, y: 22, rotate: variant === 'shell-game' ? 0 : index % 2 === 0 ? -2 : 2 }}
                  animate={{
                    opacity: 1,
                    y: variant === 'shell-game' ? [0, -10, 0] : 0,
                    x: variant === 'shell-game' ? [0, index % 2 === 0 ? 10 : -10, 0] : 0,
                    rotate: variant === 'card-shuffle' ? (index % 2 === 0 ? -2 : 2) : 0,
                  }}
                  whileHover={canChoose ? { y: -8, rotate: 0 } : undefined}
                  transition={{
                    delay: index * 0.06,
                    duration: variant === 'shell-game' ? 1.05 : 0.34,
                    repeat: variant === 'shell-game' ? 2 : 0,
                    repeatDelay: 0.15,
                  }}
                  aria-label={`${action} ${choiceLabel}`}
                >
                  {variant === 'card-shuffle' ? (
                    <CardBackGraphic label={choiceLabel} accent={accent} />
                  ) : variant === 'shell-game' ? (
                    <CupGraphic label={choiceLabel} />
                  ) : (
                    <DartGraphic />
                  )}
                </motion.button>
              );
            })}
          </div>
        )}

        {!canChoose && waitingMessage ? (
          <div className="absolute inset-x-4 bottom-4 z-20 rounded-2xl border border-white/80 bg-white/95 px-4 py-3 text-center text-sm font-semibold text-[#1f2a44] shadow-[0_18px_42px_rgba(31,42,68,0.14)]">
            {waitingMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PickedChoiceStage({
  variant,
  slot,
  selectedIndex = 0,
  choiceLabel,
  lock,
  ladderBars,
  plan,
  candidatePoints = [],
  winnerPoint,
  phase,
}: {
  variant: DrawVariant;
  slot: DrawChoiceSlot;
  selectedIndex?: number;
  choiceLabel: string;
  lock: DrawChoiceLock;
  ladderBars: LadderBar[];
  plan: DrawPlan;
  candidatePoints?: PlacedCandidate[];
  winnerPoint: PlacedCandidate | null;
  phase: DrawPhase;
}) {
  const accent = drawVariantAccents[variant];
  const candidate = variant === 'dart-map' ? plan.winner.candidate : slot.insight.candidate;
  const isRevealed = phase === 'revealed';
  const fallbackWinnerPoint = {
    insight: plan.winner,
    x: slot.x,
    y: slot.y,
  };
  const mapWinnerPoint = winnerPoint ?? fallbackWinnerPoint;
  const mapPoints = candidatePoints.length ? candidatePoints : [fallbackWinnerPoint];
  const isLadder = variant === 'ladder-game';

  return (
    <div className="relative overflow-visible">
      {isRevealed ? (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#22c55e]/15"
            initial={{ scale: 0.3, opacity: 0.65 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.78, ease: 'easeOut' }}
          />
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / 12;

            return (
              <motion.div
                key={index}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[#22c55e]/40"
                initial={{ x: 0, y: 0, scale: 0.6, opacity: 0.9 }}
                animate={{
                  x: Math.cos(angle) * 150,
                  y: Math.sin(angle) * 120,
                  scale: 0,
                  opacity: 0,
                }}
                transition={{ duration: 0.72, delay: index * 0.015, ease: 'easeOut' }}
              />
            );
          })}
        </>
      ) : null}

      <div
        className={`relative flex flex-col ${
          isLadder
            ? 'min-h-[21.75rem] p-1.5 sm:min-h-[23.5rem] sm:p-2'
            : variant === 'spin-wheel'
              ? 'min-h-[24rem] justify-between px-2 py-4 sm:min-h-[26rem] sm:px-4'
              : 'min-h-[20rem] justify-between px-1 py-2 sm:min-h-[22rem] sm:px-2'
        }`}
      >
        <div className={`${isLadder ? 'flex flex-1 items-stretch justify-center' : 'flex flex-1 items-center justify-center'}`}>
          {variant === 'card-shuffle' ? (
            <div className="w-full max-w-3xl">
              <TarotCardGrid
                lock={lock}
                accent={accent}
                selectedIndex={selectedIndex}
                revealed={isRevealed}
              />
            </div>
          ) : variant === 'shell-game' ? (
            <div className="grid w-full max-w-xl grid-cols-3 gap-3">
              {Array.from({ length: 3 }, (_, index) => {
                const active = `${index + 1}` === slot.label;

                return (
                  <motion.div
                    key={index}
                    className="relative flex flex-col items-center"
                    animate={{
                      y: active ? (isRevealed ? -34 : [-4, -18, -4]) : 0,
                      opacity: active ? 1 : 0.36,
                    }}
                    transition={{ duration: 0.54, repeat: active && !isRevealed ? 1 : 0 }}
                  >
                    <div className="relative h-40 w-full">
                      <div
                        className={`absolute left-1/2 top-0 h-32 w-32 -translate-x-1/2 rounded-b-[4.5rem] rounded-t-[1.4rem] shadow-[0_26px_55px_rgba(0,0,0,0.3)] ${
                          active && isRevealed ? 'opacity-100' : active ? 'opacity-95' : 'opacity-45'
                        }`}
                        style={{
                          background:
                            'linear-gradient(115deg, rgba(255,255,255,0.98), rgba(226,218,206,0.98) 42%, rgba(151,135,115,0.98))',
                        }}
                      >
                        <div className="absolute inset-x-2 top-2 h-9 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.96),rgba(181,166,145,0.88))] shadow-inner" />
                        <div className="absolute left-5 top-8 h-20 w-5 rounded-full bg-white/55 blur-[1px]" />
                      </div>
                      {active && isRevealed ? (
                        <motion.div
                          className="absolute bottom-1 left-1/2 h-8 w-8 -translate-x-1/2 rounded-full"
                          style={{ backgroundColor: accent }}
                          initial={{ scale: 0.2, opacity: 0 }}
                          animate={{ scale: [0.2, 1.35, 1], opacity: 1 }}
                          transition={{ duration: 0.38 }}
                        />
                      ) : null}
                    </div>
                    {active && isRevealed ? (
                      <motion.div
                        initial={{ opacity: 0, y: 18, scale: 0.86 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        transition={{ type: 'spring', stiffness: 380, damping: 18 }}
                        className="absolute top-36 rounded-2xl px-4 py-3 text-center text-white shadow-[0_18px_42px_rgba(0,0,0,0.22)]"
                        style={{ backgroundColor: accent }}
                      >
                        {candidate.name}
                      </motion.div>
                    ) : null}
                  </motion.div>
                );
              })}
            </div>
          ) : variant === 'ladder-game' ? (
            <div className="w-full">
              <LadderBoard
                lock={lock}
                accent={accent}
                bars={ladderBars}
                selectedIndex={selectedIndex}
                revealed={isRevealed}
              />
            </div>
          ) : variant === 'spin-wheel' ? (
            <div className="w-full max-w-xl">
              <WheelFace
                lock={lock}
                accent={accent}
                rotation={getWheelRotationForIndex(selectedIndex, lock.slots.length)}
                selectedIndex={selectedIndex}
                revealed={isRevealed}
                dragStrength={1}
              />
            </div>
          ) : variant === 'dart-map' ? (
            <div className="relative h-[20rem] w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-white/70 bg-[#dfe8df] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.42)]">
              <motion.div
                className="absolute inset-3 origin-center overflow-hidden rounded-[1.5rem]"
                initial={{ rotate: -4, scale: 0.96 }}
                animate={
                  isRevealed
                    ? { rotate: -1.5, x: 0, y: 0, scale: 1 }
                    : {
                        rotate: [-6, 18, -21, 15, -8, 3, -1.5],
                        x: [0, -10, 9, -7, 5, -2, 0],
                        y: [0, 6, -6, 4, -3, 1, 0],
                        scale: [0.96, 1.01, 0.97, 1.01, 0.99, 1],
                      }
                }
                transition={{ duration: isRevealed ? 0.38 : 2.05, ease: 'easeInOut' }}
              >
                <LiveCandidateMapLayer
                  points={mapPoints}
                  winnerId={isRevealed ? plan.winner.candidate.id : null}
                  activeId={!isRevealed ? plan.winner.candidate.id : null}
                />
              </motion.div>

              <motion.div
                className="absolute z-20 origin-left"
                style={{ transformOrigin: '0% 50%' }}
                initial={{
                  left: '58%',
                  top: '-10%',
                  rotate: -34,
                  scale: 1.18,
                  opacity: 0,
                }}
                animate={
                  isRevealed
                    ? {
                        left: `${mapWinnerPoint.x}%`,
                        top: `${mapWinnerPoint.y}%`,
                        rotate: -24,
                        scale: 0.92,
                        opacity: 1,
                      }
                    : {
                        left: ['58%', '42%', '70%', '34%', `${mapWinnerPoint.x}%`],
                        top: ['-10%', '34%', '22%', '62%', `${mapWinnerPoint.y}%`],
                        rotate: [-34, 12, -28, 18, -24],
                        scale: [1.18, 1.05, 1.12, 1.02, 0.94],
                        opacity: [0, 1, 1, 1, 1],
                      }
                }
                transition={{ duration: isRevealed ? 0.34 : 2.05, ease: [0.16, 1, 0.3, 1] }}
              >
                <MarkerPenGraphic />
              </motion.div>

              {(phase === 'impact' || isRevealed) && (
                <motion.div
                  className="absolute z-10 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[#ff7b6b] bg-[#ff7b6b]/18"
                  style={{ left: `${mapWinnerPoint.x}%`, top: `${mapWinnerPoint.y}%` }}
                  initial={{ opacity: 0.8, scale: 0.18 }}
                  animate={{ opacity: 0, scale: 2.8 }}
                  transition={{ duration: 0.68, ease: 'easeOut' }}
                />
              )}

              {isRevealed ? (
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="absolute bottom-4 left-4 right-4 z-30 rounded-2xl bg-white/94 px-4 py-3 text-center text-[#1a1a2e] shadow-sm backdrop-blur-sm"
                >
                  <div className="text-xs font-semibold text-[#ff7b6b]">사인펜이 찍은 곳</div>
                  <div className="mt-1 text-xl font-bold tracking-[-0.04em]">{candidate.name}</div>
                </motion.div>
              ) : null}
            </div>
          ) : (
            <motion.div
              className="relative w-full max-w-sm overflow-hidden rounded-[1.6rem] bg-white p-5 text-center shadow-[0_28px_70px_rgba(0,0,0,0.26)] [transform-style:preserve-3d]"
              initial={{ y: 18, rotate: variant === 'card-shuffle' ? -4 : 0 }}
              animate={{
                y: isRevealed ? 0 : [0, -16, 0],
                rotate: variant === 'card-shuffle' ? (isRevealed ? 0 : [-4, 4, 0]) : 0,
                rotateY: variant === 'card-shuffle' && isRevealed ? [180, 0] : 0,
              }}
              transition={{ duration: 0.58 }}
            >
              <motion.div
                className="absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/70"
                animate={{ x: ['0%', '330%'], opacity: [0, 0.8, 0] }}
                transition={{ duration: 0.78, repeat: isRevealed ? 0 : 1, repeatDelay: 0.4 }}
              />
              <div
                className="absolute inset-0"
                style={{
                  background:
                    variant === 'card-shuffle'
                      ? `radial-gradient(circle at 20% 18%, rgba(255,255,255,0.62), transparent 26%), linear-gradient(145deg, #ffffff, ${accent}20)`
                      : `linear-gradient(135deg, transparent, ${accent}18)`,
                }}
              />
              {variant === 'card-shuffle' ? (
                <div className="absolute inset-3 rounded-[1.2rem] border border-[#1f2a44]/10" />
              ) : null}
              <div className="text-xs text-[#8a94a2]">{choiceLabel}</div>
              <div className="relative mt-8 text-5xl font-semibold tracking-[-0.05em] text-[#1a1a2e]">
                {isRevealed ? candidate.name : '?'}
              </div>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

function DrawStatusCard({
  phase,
  currentInsight,
  progress,
}: {
  phase: DrawPhase;
  currentInsight: CandidateInsight;
  progress: number;
}) {
  return (
    <div className="absolute bottom-4 left-4 right-4">
      <div className="rounded-2xl bg-white/88 px-4 py-3 shadow-sm backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="min-w-0">
            <div className="truncate text-lg text-[#1a1a2e]">
              {currentInsight.candidate.name}
            </div>
          </div>
        </div>
        <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-[#e7ded2]">
          <motion.div
            className="h-full rounded-full bg-[linear-gradient(90deg,#1f2a44,#ff7b6b)]"
            animate={{
              width: `${phase === 'revealed' ? 100 : Math.max(progress * 100, 4)}%`,
            }}
            transition={{ duration: 0.16 }}
          />
        </div>
      </div>
    </div>
  );
}

export function RandomDrawer({
  candidateInsights,
  selectionMode = 'balance',
  thrillLevel = 1,
  candidateScope = 'standard',
  participants = [],
  drawSeed,
  lockedWinner = null,
  canChoose = true,
  autoChoose = false,
  sharedSelectedSlotIndex = null,
  sharedChoicePlayAt = null,
  initialLadderBars = null,
  waitingMessage,
  onChoice,
  onLadderBarsChange,
  onComplete,
  onClose,
}: RandomDrawerProps) {
  const [variant] = useState<DrawVariant>(() =>
    drawSeed ? getSeededVariant(drawSeed) : getRandomVariant(),
  );
  const [choiceLock] = useState<DrawChoiceLock>(() =>
    buildChoiceLock(candidateInsights, variant, drawSeed),
  );
  const [ladderBars, setLadderBars] = useState<LadderBar[]>(() =>
    initialLadderBars ? sortLadderBars(initialLadderBars) : getLadderBars(choiceLock),
  );
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const [pendingSelectedSlotIndex, setPendingSelectedSlotIndex] = useState<number | null>(null);
  const pendingChoiceTimerRef = useRef<number | null>(null);
  const autoChoiceIndex = useMemo(
    () =>
      choiceLock.slots.length
        ? Math.floor(seededNumber(choiceLock.seed, 'auto-choice') * choiceLock.slots.length)
        : 0,
    [choiceLock],
  );
  const selectedStartSlot =
    selectedSlotIndex === null ? null : choiceLock.slots[selectedSlotIndex] ?? null;
  const selectedChoice =
    selectedSlotIndex === null
      ? null
      : variant === 'ladder-game'
        ? getLadderResultSlot(choiceLock, selectedSlotIndex, ladderBars)
        : selectedStartSlot;
  const selectedChoiceLabel =
    selectedSlotIndex === null || selectedStartSlot === null
      ? '-'
      : variant === 'dart-map'
        ? '지도판 사인펜'
        : getChoiceDisplayLabel(variant, selectedStartSlot, selectedSlotIndex);
  const lockedChoiceInsight =
    lockedWinner ?? (variant === 'dart-map' ? null : selectedChoice?.insight ?? null);
  const plan = useMemo(
    () =>
      buildDrawPlan(
        candidateInsights,
        selectionMode,
        thrillLevel,
        candidateScope,
        lockedChoiceInsight,
        participants,
        drawSeed,
      ),
    [
      candidateInsights,
      candidateScope,
      drawSeed,
      lockedChoiceInsight,
      participants,
      selectionMode,
      thrillLevel,
    ],
  );
  const [phase, setPhase] = useState<DrawPhase>('choosing');
  const [currentInsight, setCurrentInsight] = useState<CandidateInsight>(
    plan.sequence[0] ?? plan.winner,
  );
  const [stepIndex, setStepIndex] = useState(-1);
  const [dropKey, setDropKey] = useState(0);
  const [landedIds, setLandedIds] = useState<Set<string>>(() => new Set());
  const autoCompleteRef = useRef(false);
  const completePayloadRef = useRef({
    lockCode: choiceLock.code,
    onComplete,
    selectedChoiceLabel,
    variant,
    variantLabel: drawVariantDisplayLabels[variant],
    winner: plan.winner.candidate,
  });

  const placedCandidates = useMemo(() => layoutCandidates(candidateInsights), [candidateInsights]);
  const visiblePoints = useMemo(() => getUniqueVisiblePoints(placedCandidates), [placedCandidates]);
  const activePoint = getPointForInsight(placedCandidates, currentInsight);
  const winnerPoint = getPointForInsight(placedCandidates, plan.winner);
  const cameraState = useMemo(() => getPinCameraState(activePoint, phase), [activePoint, phase]);
  const progress = plan.sequence.length ? (stepIndex + 1) / plan.sequence.length : 0;
  const variantLabel = variant ? drawVariantDisplayLabels[variant] : '게임 선택';
  const winnerCandidateId = plan.winner.candidate.id;
  const isLadderVariant = variant === 'ladder-game';
  const clearPendingChoiceTimer = () => {
    if (pendingChoiceTimerRef.current !== null) {
      window.clearTimeout(pendingChoiceTimerRef.current);
      pendingChoiceTimerRef.current = null;
    }
  };
  const scheduleSlotSelection = (index: number, playAt?: string | null) => {
    if (index < 0 || index >= choiceLock.slots.length) {
      return;
    }

    clearPendingChoiceTimer();

    const playAtMs = playAt ? Date.parse(playAt) : NaN;
    const delayMs = Number.isFinite(playAtMs) ? Math.max(0, playAtMs - Date.now()) : 0;

    if (delayMs <= 30) {
      setPendingSelectedSlotIndex(null);
      setSelectedSlotIndex((current) => current ?? index);
      return;
    }

    setPendingSelectedSlotIndex(index);
    pendingChoiceTimerRef.current = window.setTimeout(() => {
      pendingChoiceTimerRef.current = null;
      setPendingSelectedSlotIndex(null);
      setSelectedSlotIndex((current) => current ?? index);
    }, delayMs);
  };
  const updateLadderBars = (bars: LadderBar[]) => {
    const nextBars = sortLadderBars(bars);

    if (getLadderBarsSignature(ladderBars) === getLadderBarsSignature(nextBars)) {
      return;
    }

    setLadderBars(nextBars);
    onLadderBarsChange?.(nextBars);
  };
  const chooseSlot = (index: number) => {
    if (index < 0 || index >= choiceLock.slots.length) {
      return;
    }

    onChoice?.(index, { ladderBars: sortLadderBars(ladderBars) });
    if (!onChoice) {
      scheduleSlotSelection(index);
    }
  };

  useEffect(() => {
    return () => {
      clearPendingChoiceTimer();
    };
  }, []);

  useEffect(() => {
    completePayloadRef.current = {
      lockCode: choiceLock.code,
      onComplete,
      selectedChoiceLabel,
      variant,
      variantLabel,
      winner: plan.winner.candidate,
    };
  });

  useEffect(() => {
    if (!initialLadderBars || selectedSlotIndex !== null) {
      return;
    }

    const nextBars = sortLadderBars(initialLadderBars);
    setLadderBars((current) =>
      getLadderBarsSignature(current) === getLadderBarsSignature(nextBars) ? current : nextBars,
    );
  }, [initialLadderBars, selectedSlotIndex]);

  useEffect(() => {
    if (
      sharedSelectedSlotIndex === null ||
      sharedSelectedSlotIndex < 0 ||
      sharedSelectedSlotIndex >= choiceLock.slots.length
    ) {
      return;
    }

    scheduleSlotSelection(sharedSelectedSlotIndex, sharedChoicePlayAt);
  }, [choiceLock.slots.length, sharedChoicePlayAt, sharedSelectedSlotIndex]);

  useEffect(() => {
    if (!autoChoose || selectedSlotIndex !== null || !choiceLock.slots.length) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      chooseSlot(autoChoiceIndex);
    }, 850);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [autoChoiceIndex, autoChoose, choiceLock.slots.length, selectedSlotIndex]);

  useEffect(() => {
    if (selectedSlotIndex === null) {
      setPhase('choosing');
      return;
    }

    let cancelled = false;
    const timeoutIds: number[] = [];
    autoCompleteRef.current = false;

    setPhase(variant === 'dart-map' ? 'boot' : 'impact');
    setStepIndex(0);
    setCurrentInsight(plan.winner);
    setDropKey((current) => current + 1);
    setLandedIds(new Set([plan.winner.candidate.id]));

    if (variant === 'dart-map') {
      timeoutIds.push(
        window.setTimeout(() => {
          if (!cancelled) {
            setPhase('dropping');
          }
        }, 140),
        window.setTimeout(() => {
          if (!cancelled) {
            setPhase('settling');
          }
        }, 1120),
        window.setTimeout(() => {
          if (!cancelled) {
            setPhase('impact');
          }
        }, 1880),
        window.setTimeout(() => {
          if (!cancelled) {
            setPhase('revealed');
          }
        }, 2520),
      );

      return () => {
        cancelled = true;
        timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
      };
    }

    timeoutIds.push(window.setTimeout(() => {
      if (!cancelled) {
        setPhase('revealed');
      }
    }, variant === 'spin-wheel' ? 180 : variant === 'ladder-game' ? 3900 : 1550));

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [selectedSlotIndex, variant, winnerCandidateId]);

  useEffect(() => {
    if (phase !== 'revealed' || autoCompleteRef.current) {
      return;
    }

    autoCompleteRef.current = true;
    const timeoutId = window.setTimeout(() => {
      const payload = completePayloadRef.current;

      payload.onComplete(payload.winner, {
        variantLabel: payload.variantLabel,
        choiceLabel: payload.selectedChoiceLabel,
        lockCode: payload.lockCode,
      });
    }, variant === 'dart-map' ? 1400 : variant === 'ladder-game' ? 2300 : variant === 'spin-wheel' ? 900 : 1900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase, variant]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto px-2 py-2 sm:items-center"
    >
      <div
        className="absolute inset-0 bg-white/82 backdrop-blur-sm"
        onClick={phase === 'choosing' || phase === 'revealed' ? onClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        className={`relative my-auto w-full ${isLadderVariant ? 'max-w-2xl' : 'max-w-4xl'}`}
      >
        <button
          type="button"
          onClick={phase === 'choosing' || phase === 'revealed' ? onClose : undefined}
          className={`fixed right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-colors ${
            phase === 'choosing' || phase === 'revealed'
              ? 'border-[#e8edf3] bg-white text-[#1f2a44]'
              : 'border-white/40 bg-white/30 text-[#1f2a44]/35'
          }`}
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div>
          <div className={isLadderVariant ? 'p-1.5 sm:p-2' : 'p-2 sm:p-3'}>
            {phase === 'choosing' ? (
              <DrawChoiceStage
                variant={variant}
                lock={choiceLock}
                ladderBars={ladderBars}
                candidatePoints={visiblePoints}
                onLadderBarsChange={canChoose && !autoChoose ? updateLadderBars : undefined}
                onChoose={
                  canChoose && !autoChoose && pendingSelectedSlotIndex === null
                    ? (index) => {
                        chooseSlot(index);
                      }
                    : undefined
                }
                waitingMessage={waitingMessage}
              />
            ) : selectedChoice ? (
              <PickedChoiceStage
                variant={variant}
                slot={selectedChoice}
                selectedIndex={selectedSlotIndex ?? 0}
                choiceLabel={selectedChoiceLabel}
                lock={choiceLock}
                ladderBars={ladderBars}
                plan={plan}
                candidatePoints={visiblePoints}
                winnerPoint={winnerPoint}
                phase={phase}
              />
            ) : (
              <DrawChoiceStage
                variant={variant}
                lock={choiceLock}
                ladderBars={ladderBars}
                candidatePoints={visiblePoints}
                onLadderBarsChange={canChoose && !autoChoose ? updateLadderBars : undefined}
                onChoose={
                  canChoose && !autoChoose && pendingSelectedSlotIndex === null
                    ? (index) => {
                        chooseSlot(index);
                      }
                    : undefined
                }
                waitingMessage={waitingMessage}
              />
            )}

          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
