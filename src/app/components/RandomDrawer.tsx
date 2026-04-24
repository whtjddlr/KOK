import { useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { Crosshair, Layers3, MapPin, MousePointer2, ScanLine, X } from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  DrawPlan,
  DrawProof,
  SelectionModeKey,
  ThrillLevel,
} from '../types';
import { buildDrawPlan } from '../lib/meeting';

interface RandomDrawerProps {
  candidateInsights: CandidateInsight[];
  categoryLabel?: string;
  modeLabel?: string;
  selectionMode?: SelectionModeKey;
  thrillLevel?: ThrillLevel;
  candidateScope?: CandidateScopeKey;
  onComplete: (winner: Candidate, proof: DrawProof) => void;
  onClose: () => void;
}

type DrawPhase = 'choosing' | 'boot' | 'dropping' | 'settling' | 'impact' | 'revealed';
type DrawVariant = 'card-shuffle' | 'shell-game' | 'dart-map';

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
  'shell-game',
  'dart-map',
];

const drawVariantAccents: Record<DrawVariant, string> = {
  'card-shuffle': '#f59e0b',
  'shell-game': '#a78bfa',
  'dart-map': '#ef4444',
};

const drawVariantDisplayLabels: Record<DrawVariant, string> = {
  'card-shuffle': '카드 셔플',
  'shell-game': '야바위',
  'dart-map': '지도 다트',
};

function getRandomVariant(): DrawVariant {
  return drawVariants[Math.floor(Math.random() * drawVariants.length)] ?? 'card-shuffle';
}

function getChoiceDisplayLabel(variant: DrawVariant, slot: DrawChoiceSlot, index: number) {
  if (variant === 'shell-game') {
    return ['왼쪽', '가운데', '오른쪽'][index] ?? `${slot.label}번`;
  }

  if (variant === 'card-shuffle') {
    return `카드 ${slot.label}`;
  }

  if (variant === 'dart-map') {
    return `타깃 ${slot.label}`;
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

function createChoiceSeed() {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function getChoiceCount(variant: DrawVariant) {
  if (variant === 'shell-game') {
    return 3;
  }

  if (variant === 'card-shuffle') {
    return 8;
  }

  if (variant === 'dart-map') {
    return 6;
  }

  return 3;
}

function buildChoiceLock(insights: CandidateInsight[], variant: DrawVariant): DrawChoiceLock {
  const seed = createChoiceSeed();
  const uniqueInsights = getUniqueInsights(insights);
  const source = uniqueInsights.length ? uniqueInsights : insights;
  const count = Math.min(getChoiceCount(variant), Math.max(source.length, 1));
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
            repeat: winner ? Infinity : 0,
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
                    {isWinner ? insight.candidate.district : '뒤집는 중'}
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
            transition={{ duration: 0.72, repeat: Infinity }}
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
                transition={{ duration: 0.45, repeat: isWinner ? Infinity : 0 }}
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
                transition={{ duration: 0.5, repeat: isWinner ? Infinity : isActive ? Infinity : 0 }}
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
                transition={{ duration: 0.7, repeat: phase === 'revealed' ? 0 : Infinity, repeatDelay: 0.12 }}
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
            transition={{ duration: 1.2, repeat: Infinity, repeatDelay: 1.4 }}
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
        transition={{ duration: 1.05, repeat: active ? Infinity : 0, repeatDelay: 0.16 }}
      >
        <div className="absolute inset-x-2 top-2 h-9 rounded-[50%] bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.96),rgba(181,166,145,0.88))] shadow-inner" />
        <div className="absolute left-5 top-8 h-20 w-5 rounded-full bg-white/55 blur-[1px]" />
        <div className="absolute bottom-3 left-1/2 h-5 w-20 -translate-x-1/2 rounded-[50%] bg-black/10 blur-sm" />
      </motion.div>
      <div className="mt-3 rounded-full bg-white/12 px-3 py-1 text-xs text-white/85">{label}</div>
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

function DrawChoiceStage({
  variant,
  lock,
  onChoose,
}: {
  variant: DrawVariant;
  lock: DrawChoiceLock;
  onChoose: (index: number) => void;
}) {
  const accent = drawVariantAccents[variant];
  const isMapChoice = variant === 'dart-map' || variant === 'radar-scan';
  const title =
    variant === 'card-shuffle'
      ? '한 장 뽑기'
      : variant === 'shell-game'
        ? '하나 고르기'
        : '한 곳 찍기';
  const action =
    variant === 'card-shuffle'
      ? '이 카드 뽑기'
      : variant === 'shell-game'
        ? '이 컵 열기'
        : '여기로 던지기';

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-[#f5f1eb] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.5)]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_45%,rgba(255,123,107,0.2),transparent_34%),radial-gradient(circle_at_82%_80%,rgba(93,217,208,0.14),transparent_28%)]" />
      <div className="absolute inset-0 opacity-40 bg-[linear-gradient(135deg,rgba(255,255,255,0.5)_1px,transparent_1px)] bg-[size:30px_30px]" />
      <motion.div
        className="absolute -left-20 top-16 h-44 w-44 rounded-full blur-3xl"
        style={{ backgroundColor: `${accent}55` }}
        animate={{ x: [0, 34, -10, 0], y: [0, 24, -12, 0], opacity: [0.32, 0.62, 0.4] }}
        transition={{ duration: 3.4, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute -right-16 bottom-8 h-36 w-36 rounded-full bg-white/18 blur-3xl"
        animate={{ scale: [1, 1.25, 1], opacity: [0.22, 0.48, 0.22] }}
        transition={{ duration: 2.8, repeat: Infinity, ease: 'easeInOut' }}
      />

      <div className="relative min-h-[25rem] px-4 py-5 sm:min-h-[29rem] sm:px-6">
        <div className="mb-5 flex items-start justify-center gap-4 text-center">
          <div>
            <div className="mt-2 text-3xl font-black tracking-[-0.06em] text-[#1f2a44]">
              {title}
            </div>
            <div className="mt-2 text-sm font-medium text-[#76777e]">
              운명의 선택지 하나를 골라보세요
            </div>
          </div>
          <div
            className="hidden h-16 w-16 items-center justify-center rounded-3xl text-[#1f2a44] sm:flex"
            style={{ backgroundColor: `${accent}22` }}
          >
            <DrawVariantIcon variant={variant} className="h-7 w-7" />
          </div>
        </div>

        {isMapChoice ? (
          <div className="relative h-[18rem] overflow-hidden rounded-[1.5rem] border border-white/12 bg-[#dfe8df] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.32)]">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
              <path d="M0 52 C18 42, 32 60, 46 50 S75 36, 100 48 L100 100 L0 100 Z" fill="rgba(100,181,176,0.32)" />
              <path d="M7 20 L28 10 L46 19 L64 9 L91 22 L86 42 L94 65 L77 86 L54 79 L31 91 L10 76 L15 54 Z" fill="rgba(255,255,255,0.64)" stroke="rgba(31,42,68,0.1)" strokeWidth="0.8" />
              <path d="M10 39 L29 34 L43 42 L61 32 L82 38" fill="none" stroke="rgba(31,42,68,0.17)" strokeWidth="1.1" strokeDasharray="3 3" />
              <path d="M15 70 L33 60 L51 68 L69 56 L88 63" fill="none" stroke="rgba(31,42,68,0.13)" strokeWidth="1.1" strokeDasharray="3 3" />
              <path d="M12 55 C28 44, 37 66, 52 53 S74 39, 91 53" fill="none" stroke="rgba(78,205,196,0.62)" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
            <motion.div
              className="pointer-events-none absolute right-5 top-4"
              animate={{ x: [0, -12, 0], y: [0, 7, 0], rotate: [-28, -20, -28] }}
              transition={{ duration: 1.6, repeat: Infinity, ease: 'easeInOut' }}
            >
              <DartGraphic compact />
            </motion.div>

            {lock.slots.map((slot, index) => {
              const choiceLabel = getChoiceDisplayLabel(variant, slot, index);

              return (
                <motion.button
                  key={slot.id}
                  type="button"
                  onClick={() => onChoose(index)}
                  className="absolute flex h-16 w-16 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[5px] border-white bg-white text-sm font-semibold text-[#1f2a44] shadow-[0_18px_35px_rgba(0,0,0,0.22)] transition-transform active:scale-95"
                  style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                  animate={{ scale: [1, 1.12, 1] }}
                  transition={{ delay: index * 0.12, duration: 1.2, repeat: Infinity }}
                  aria-label={`${action} ${choiceLabel}`}
                >
                  <motion.span
                    className="absolute inset-[-12px] rounded-full border"
                    style={{ borderColor: accent }}
                    animate={{ scale: [0.7, 1.5], opacity: [0.6, 0] }}
                    transition={{ delay: index * 0.12, duration: 1.2, repeat: Infinity }}
                  />
                  <span className="absolute inset-1 rounded-full border-4" style={{ borderColor: accent }} />
                  <span className="absolute inset-4 rounded-full" style={{ backgroundColor: accent }} />
                  <span className="relative text-white">{slot.label}</span>
                </motion.button>
              );
            })}
          </div>
        ) : variant === 'card-shuffle' ? (
          <div className="relative h-[19rem] overflow-x-auto overflow-y-visible px-3 py-8 [perspective:1200px]">
            <div
              className="relative mx-auto h-56"
              style={{
                width: `${Math.max(23, lock.slots.length * 5.2 + 8)}rem`,
              }}
            >
              {lock.slots.map((slot, index) => {
                const choiceLabel = getChoiceDisplayLabel(variant, slot, index);
                const center = (lock.slots.length - 1) / 2;
                const offset = index - center;

                return (
                  <motion.button
                    key={slot.id}
                    type="button"
                    onClick={() => onChoose(index)}
                    className="group absolute top-3 w-36 origin-bottom overflow-visible transition-transform active:scale-95"
                    style={{
                      left: `${index * 5.2}rem`,
                      zIndex: index + 1,
                    }}
                    initial={{ opacity: 0, y: 34, rotate: offset * 3.2 }}
                    animate={{
                      opacity: 1,
                      y: Math.abs(offset) * 5,
                      rotate: offset * 3.2,
                    }}
                    whileHover={{
                      y: -24,
                      rotate: 0,
                      scale: 1.06,
                      zIndex: 50,
                    }}
                    transition={{ delay: index * 0.045, type: 'spring', stiffness: 230, damping: 20 }}
                    aria-label={`${action} ${choiceLabel}`}
                  >
                    <CardBackGraphic label={choiceLabel} accent={accent} />
                  </motion.button>
                );
              })}
            </div>
          </div>
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
                  onClick={() => onChoose(index)}
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
                  whileHover={{ y: -8, rotate: 0 }}
                  transition={{
                    delay: index * 0.06,
                    duration: variant === 'shell-game' ? 1.05 : 0.34,
                    repeat: variant === 'shell-game' ? Infinity : 0,
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
      </div>
    </div>
  );
}

function PickedChoiceStage({
  variant,
  slot,
  choiceLabel,
  lock,
  phase,
}: {
  variant: DrawVariant;
  slot: DrawChoiceSlot;
  choiceLabel: string;
  lock: DrawChoiceLock;
  phase: DrawPhase;
}) {
  const accent = drawVariantAccents[variant];
  const candidate = slot.insight.candidate;
  const isRevealed = phase === 'revealed';

  return (
    <div className="relative overflow-hidden rounded-[2rem] border border-white/80 bg-[#f5f1eb] shadow-inner">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_42%,rgba(255,123,107,0.2),transparent_34%),radial-gradient(circle_at_82%_80%,rgba(93,217,208,0.14),transparent_28%)]" />
      <div className="absolute inset-0 opacity-50 bg-[linear-gradient(135deg,rgba(255,255,255,0.5)_1px,transparent_1px)] bg-[size:30px_30px]" />
      {isRevealed ? (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/55"
            initial={{ scale: 0.3, opacity: 0.65 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.78, ease: 'easeOut' }}
          />
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / 12;

            return (
              <motion.div
                key={index}
                className="absolute left-1/2 top-1/2 h-2 w-2 rounded-full bg-white"
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

      <div className="relative flex min-h-[25rem] flex-col justify-between px-4 py-5 sm:min-h-[29rem] sm:px-6">
        <div className="flex items-center justify-between gap-3">
          <div className="hidden rounded-full bg-white/10 px-3 py-1.5 text-xs text-white/70">
            LOCK {lock.code}
          </div>
          <div className="inline-flex items-center gap-2 rounded-full bg-white px-3 py-1.5 text-xs font-semibold text-[#1f2a44] shadow-sm">
            <DrawVariantIcon variant={variant} className="h-3.5 w-3.5" />
            {choiceLabel}
          </div>
        </div>

        <div className="flex flex-1 items-center justify-center py-8">
          {variant === 'shell-game' ? (
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
          ) : variant === 'dart-map' ? (
            <div className="relative h-[18rem] w-full max-w-xl overflow-hidden rounded-[1.5rem] border border-white/12 bg-[#eef3f7]">
              <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 h-full w-full">
                <path d="M0 52 C18 42, 32 60, 46 50 S75 36, 100 48 L100 100 L0 100 Z" fill="rgba(100,181,176,0.32)" />
                <path d="M7 20 L28 10 L46 19 L64 9 L91 22 L86 42 L94 65 L77 86 L54 79 L31 91 L10 76 L15 54 Z" fill="rgba(255,255,255,0.66)" stroke="rgba(31,42,68,0.1)" strokeWidth="0.8" />
                <path d="M10 39 L29 34 L43 42 L61 32 L82 38" fill="none" stroke="rgba(31,42,68,0.17)" strokeWidth="1.1" strokeDasharray="3 3" />
                <path d="M15 70 L33 60 L51 68 L69 56 L88 63" fill="none" stroke="rgba(31,42,68,0.13)" strokeWidth="1.1" strokeDasharray="3 3" />
                <path d="M12 55 C28 44, 37 66, 52 53 S74 39, 91 53" fill="none" stroke="rgba(78,205,196,0.62)" strokeWidth="2.4" strokeLinecap="round" />
              </svg>
              <motion.div
                className="absolute flex h-20 w-20 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[6px] border-white bg-white text-white shadow-[0_20px_42px_rgba(0,0,0,0.22)]"
                style={{ left: `${slot.x}%`, top: `${slot.y}%` }}
                initial={{ scale: 1.4, opacity: 0 }}
                animate={{ scale: isRevealed ? 1 : [1.2, 0.9, 1], opacity: 1 }}
                transition={{ duration: 0.56 }}
              >
                <motion.span
                  className="absolute inset-[-28px] rounded-full border-2"
                  style={{ borderColor: accent }}
                  initial={{ scale: 0.25, opacity: 0.8 }}
                  animate={{ scale: isRevealed ? 1.8 : 1.2, opacity: isRevealed ? 0 : 0.24 }}
                  transition={{ duration: 0.62, ease: 'easeOut' }}
                />
                <span className="absolute inset-2 rounded-full border-[5px]" style={{ borderColor: accent }} />
                <span className="absolute inset-6 rounded-full" style={{ backgroundColor: accent }} />
              </motion.div>
              <motion.div
                className="absolute"
                initial={{
                  left: '105%',
                  top: '106%',
                  rotate: -36,
                  scale: 1.45,
                  opacity: 0,
                }}
                animate={{
                  left: `${slot.x}%`,
                  top: `${slot.y}%`,
                  rotate: -28,
                  scale: isRevealed ? 0.82 : 1,
                  opacity: 1,
                }}
                transition={{ duration: 0.58, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="-translate-x-[62%] -translate-y-[48%]">
                  <DartGraphic />
                </div>
              </motion.div>
              {isRevealed ? (
                <motion.div
                  initial={{ opacity: 0, y: 18, scale: 0.96 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  className="absolute bottom-4 left-4 right-4 rounded-2xl bg-white px-4 py-3 text-center text-[#1a1a2e] shadow-sm"
                >
                  {candidate.name}
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
                transition={{ duration: 0.78, repeat: isRevealed ? 0 : Infinity, repeatDelay: 0.4 }}
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
  onComplete,
  onClose,
}: RandomDrawerProps) {
  const [variant] = useState<DrawVariant>(() => getRandomVariant());
  const [choiceLock] = useState<DrawChoiceLock>(() => buildChoiceLock(candidateInsights, variant));
  const [selectedSlotIndex, setSelectedSlotIndex] = useState<number | null>(null);
  const selectedChoice =
    selectedSlotIndex === null ? null : choiceLock.slots[selectedSlotIndex] ?? null;
  const selectedChoiceLabel =
    selectedChoice === null
      ? '-'
      : getChoiceDisplayLabel(variant, selectedChoice, selectedSlotIndex ?? 0);
  const plan = useMemo(
    () =>
      buildDrawPlan(
        candidateInsights,
        selectionMode,
        thrillLevel,
        candidateScope,
        selectedChoice?.insight ?? null,
      ),
    [
      candidateInsights,
      candidateScope,
      selectedChoice?.insight,
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

  const placedCandidates = useMemo(() => layoutCandidates(candidateInsights), [candidateInsights]);
  const visiblePoints = useMemo(() => getUniqueVisiblePoints(placedCandidates), [placedCandidates]);
  const activePoint = getPointForInsight(placedCandidates, currentInsight);
  const winnerPoint = getPointForInsight(placedCandidates, plan.winner);
  const cameraState = useMemo(() => getPinCameraState(activePoint, phase), [activePoint, phase]);
  const progress = plan.sequence.length ? (stepIndex + 1) / plan.sequence.length : 0;
  const variantLabel = variant ? drawVariantDisplayLabels[variant] : '게임 선택';

  useEffect(() => {
    if (selectedSlotIndex === null) {
      setPhase('choosing');
      return;
    }

    let cancelled = false;
    let timeoutId = 0;
    autoCompleteRef.current = false;

    setPhase('impact');
    setStepIndex(0);
    setCurrentInsight(plan.winner);
    setDropKey(0);
    setLandedIds(new Set([plan.winner.candidate.id]));

    timeoutId = window.setTimeout(() => {
      if (!cancelled) {
        setPhase('revealed');
      }
    }, 620);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [plan.winner, selectedSlotIndex]);

  useEffect(() => {
    if (phase !== 'revealed' || autoCompleteRef.current) {
      return;
    }

    autoCompleteRef.current = true;
    const timeoutId = window.setTimeout(() => {
      onComplete(plan.winner.candidate, {
        variantLabel,
        choiceLabel: selectedChoiceLabel,
        lockCode: choiceLock.code,
      });
    }, 900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [choiceLock.code, onComplete, phase, plan.winner.candidate, selectedChoiceLabel, variantLabel]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto px-4 py-4 sm:items-center"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_50%_38%,rgba(255,123,107,0.18),transparent_30rem),linear-gradient(180deg,rgba(245,241,235,0.98),rgba(251,248,251,0.98))]"
        onClick={phase === 'choosing' || phase === 'revealed' ? onClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        className="relative my-auto w-full max-w-3xl"
      >
        <button
          type="button"
          onClick={phase === 'choosing' || phase === 'revealed' ? onClose : undefined}
          className={`absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${
            phase === 'choosing' || phase === 'revealed'
              ? 'border-[#e8edf3] bg-white text-[#1f2a44]'
              : 'border-white/40 bg-white/30 text-[#1f2a44]/35'
          }`}
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-hidden rounded-[2.25rem] border border-white/80 bg-[#fbf8fb] shadow-[0_28px_80px_rgba(31,42,68,0.16)]">
          <div className="px-5 pb-2 pt-4 sm:px-6">
            <div className="flex items-center justify-between gap-3 pr-12">
              <div className="inline-flex items-center gap-2 rounded-full bg-[#f5f1eb] px-3 py-2 text-xs font-semibold text-[#1f2a44] shadow-sm">
                {variant === 'card-shuffle' && <Layers3 className="h-3.5 w-3.5 text-[#ff7b6b]" />}
                {variant === 'shell-game' && <MapPin className="h-3.5 w-3.5 text-[#a78bfa]" />}
                {variant === 'dart-map' && <Crosshair className="h-3.5 w-3.5 text-[#ff7b6b]" />}
                {variantLabel}
              </div>
            </div>
          </div>

          <div className="p-3 sm:p-5">
            {phase === 'choosing' ? (
              <DrawChoiceStage
                variant={variant}
                lock={choiceLock}
                onChoose={(index) => {
                  setSelectedSlotIndex(index);
                }}
              />
            ) : selectedChoice ? (
              <PickedChoiceStage
                variant={variant}
                slot={selectedChoice}
                choiceLabel={selectedChoiceLabel}
                lock={choiceLock}
                phase={phase}
              />
            ) : (
              <DrawChoiceStage
                variant={variant}
                lock={choiceLock}
                onChoose={(index) => {
                  setSelectedSlotIndex(index);
                }}
              />
            )}

            <AnimatePresence mode="wait">
              {phase === 'revealed' ? (
                <motion.div
                  key="result"
                  initial={{ opacity: 0, y: 10, scale: 0.98 }}
                  animate={{ opacity: 1, y: 0, scale: 1 }}
                  exit={{ opacity: 0, y: -12 }}
                  className="mt-3 rounded-[1.25rem] bg-white px-5 py-5 text-center shadow-sm"
                >
                  <div className="text-4xl font-semibold tracking-[-0.04em] text-[#1a1a2e]">
                    {plan.winner.candidate.name}
                  </div>
                  <div className="mt-2 text-sm text-[#8a94a2]">
                    {plan.winner.candidate.district} · 평균 {plan.winner.averageDuration}분
                  </div>
                  <div className="mt-4 hidden rounded-full bg-[#f5f1eb] px-3 py-1.5 text-xs text-[#6b7280]">
                    선택 {selectedChoiceLabel} · 잠금 코드 {choiceLock.code}
                  </div>
                </motion.div>
              ) : null}
            </AnimatePresence>

          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
