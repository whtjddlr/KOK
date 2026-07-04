import { useEffect, useMemo, useRef, useState } from 'react';
import type { PointerEvent as ReactPointerEvent } from 'react';
import { motion } from 'motion/react';
import { X } from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  DrawProof,
  Participant,
  SelectionModeKey,
  ThrillLevel,
} from '../types';
import { buildDrawPlan } from '../lib/meeting';

interface RandomDrawerProps {
  candidateInsights: CandidateInsight[];
  selectionMode?: SelectionModeKey;
  thrillLevel?: ThrillLevel;
  candidateScope?: CandidateScopeKey;
  participants?: Participant[];
  drawSeed?: string;
  canChoose?: boolean;
  sharedSelectedSlotIndex?: number | null;
  sharedChoicePlayAt?: string | null;
  initialLadderBars?: LadderBar[] | null;
  waitingMessage?: string;
  onChoice?: (slotIndex: number, state?: { ladderBars: LadderBar[] }) => void;
  onLadderBarsChange?: (bars: LadderBar[]) => void;
  onComplete: (winner: Candidate, proof: DrawProof) => void;
  onClose: () => void;
}

type DrawPhase = 'choosing' | 'impact' | 'revealed';
type DrawVariant = 'card-shuffle' | 'ladder-game' | 'spin-wheel';

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
  'ladder-game': '#FF6B5F',
  'spin-wheel': '#E85F55',
};

const drawVariantDisplayLabels: Record<DrawVariant, string> = {
  'card-shuffle': '카드 셔플',
  'ladder-game': '사다리타기',
  'spin-wheel': '돌림판',
};

function getRandomVariant(): DrawVariant {
  return drawVariants[Math.floor(Math.random() * drawVariants.length)] ?? 'card-shuffle';
}

function getSeededVariant(seed: string): DrawVariant {
  return drawVariants[Math.floor(seededNumber(seed, 'variant') * drawVariants.length)] ?? 'card-shuffle';
}

function getChoiceDisplayLabel(variant: DrawVariant, slot: DrawChoiceSlot, index: number) {
  if (variant === 'card-shuffle') {
    return `카드 ${slot.label}`;
  }

  if (variant === 'ladder-game') {
    return `사다리 ${slot.label}`;
  }

  if (variant === 'spin-wheel') {
    return `칸 ${slot.label}`;
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
  '#FF6B5F',
  '#f59e0b',
  '#FF6B5F',
  '#E85F55',
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

function getChoiceCount(sourceLength: number) {
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
  const count = getChoiceCount(source.length);
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
        className={`relative h-full rounded-[1.05rem] border bg-white p-1.5 shadow-[0_14px_28px_rgba(20,35,29,0.12)] [transform-style:preserve-3d] ${
          active && revealed ? 'border-[#16241D]' : 'border-[#E4EFE9]'
        }`}
        animate={{ rotateY: showFront ? 180 : 0 }}
        transition={{ duration: 0.82, ease: [0.16, 1, 0.3, 1] }}
      >
        <div
          className="absolute inset-0 overflow-hidden rounded-[1.05rem] bg-white p-2 [backface-visibility:hidden]"
          style={{ backfaceVisibility: 'hidden' }}
        >
          <div
            className="relative h-full overflow-hidden rounded-[0.78rem] bg-[#16241D]"
            style={{
              boxShadow: `inset 0 0 0 1px ${accent}22`,
            }}
          >
            <div className="absolute inset-[0.48rem] rounded-[0.55rem] border border-white/20" />
            <div className="absolute inset-[1rem] rounded-[0.45rem] border border-white/10" />
            <div className="absolute left-3 top-2.5 text-center text-[13px] font-black leading-none text-white">
              <div>{rank}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: isRedSuit ? '#FF6B5F' : '#ffffff' }}>
                {suit}
              </div>
            </div>
            <div className="absolute bottom-2.5 right-3 rotate-180 text-center text-[13px] font-black leading-none text-white">
              <div>{rank}</div>
              <div className="mt-0.5 text-[11px]" style={{ color: isRedSuit ? '#FF6B5F' : '#ffffff' }}>
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
            active && revealed ? 'bg-[#16241D] text-white' : 'bg-white text-[#16241D]'
          }`}
          style={{
            backfaceVisibility: 'hidden',
            transform: 'rotateY(180deg)',
          }}
        >
          <div
            className={`text-left text-base font-black leading-none ${active && revealed ? 'text-white/80' : isRedSuit ? 'text-[#FF6B5F]' : 'text-[#16241D]'}`}
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
          <div className={`self-end rotate-180 text-base font-black leading-none ${active && revealed ? 'text-white/80' : isRedSuit ? 'text-[#FF6B5F]' : 'text-[#16241D]'}`}>
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
  const wheelSize = 'min(18rem, 72vw, 43dvh)';
  const wheelLabelRadius = 'min(6.8rem, 26vw, 16dvh)';
  const wheelCenterSize = 'min(7rem, 28vw, 16dvh)';

  return (
    <div className="relative mx-auto w-full max-w-sm">
      <div className="absolute left-1/2 top-0 z-20 h-0 w-0 -translate-x-1/2 -translate-y-2 border-x-[13px] border-t-[24px] border-x-transparent border-t-[#16241D] drop-shadow-[0_8px_12px_rgba(20,35,29,0.2)]" />
      <div
        role={onPointerDown ? 'slider' : 'img'}
        aria-label="드래그해서 돌림판 돌리기"
        tabIndex={onPointerDown ? 0 : -1}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        style={{ height: wheelSize, width: wheelSize }}
        className={`relative mx-auto flex touch-none select-none items-center justify-center rounded-full border-[10px] border-white bg-white shadow-[0_28px_70px_rgba(20,35,29,0.18)] ${
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
                  active && revealed ? 'bg-[#16241D] text-white' : 'bg-white/88 text-[#16241D]'
                }`}
                style={{
                  transform: `translate(-50%, -50%) rotate(${angle}deg) translateY(calc(${wheelLabelRadius} * -1)) rotate(${-angle}deg)`,
                }}
              >
                {index + 1}
              </div>
            );
          })}
          <div className="absolute inset-[4.15rem] rounded-full border border-white/45 bg-white/16" />
        </motion.div>

        <div
          style={{ height: wheelCenterSize, width: wheelCenterSize }}
          className="relative z-10 flex flex-col items-center justify-center rounded-full border border-white/80 bg-white/94 px-3 text-center shadow-[0_18px_38px_rgba(20,35,29,0.18)]"
        >
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
              <div className="mt-1 line-clamp-2 text-sm font-black leading-tight tracking-[-0.05em] text-[#16241D] sm:text-base">
                {selectedSlot.insight.candidate.name}
              </div>
            </motion.div>
          ) : isSpinning ? (
            <>
              <div className="text-xs font-bold text-[#9AA8A1]">돌아가는 중</div>
              <motion.div
                className="mt-2 h-2 w-14 overflow-hidden rounded-full bg-[#F0F5F2]"
                animate={{ opacity: [0.65, 1, 0.65] }}
                transition={{ duration: 0.75, repeat: 2 }}
              >
                <div className="h-full rounded-full" style={{ width: '70%', backgroundColor: accent }} />
              </motion.div>
            </>
          ) : (
            <>
              <div className="text-xs font-bold text-[#9AA8A1]">
                {isDragging ? '힘 조절 중' : '드래그'}
              </div>
              <div className="mt-1 text-xl font-black text-[#16241D] sm:text-2xl">돌림</div>
            </>
          )}
        </div>
      </div>

      {!revealed && (
        <div className="mx-auto mt-3 max-w-xs rounded-2xl bg-white/82 px-4 py-2.5 shadow-sm">
          <div className="flex items-center justify-between text-xs font-bold text-[#6E7C75]">
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
      )}

      {revealed ? (
        <div className="mt-3 overflow-x-auto rounded-2xl bg-white/70 p-2">
          <div className="flex min-w-max gap-1.5">
            {lock.slots.map((slot, index) => (
              <div
                key={`wheel-option-${slot.id}`}
                className={`max-w-[9rem] shrink-0 truncate rounded-full px-2.5 py-1.5 text-[11px] font-semibold ${
                  selectedIndex === index
                    ? 'bg-[#16241D] text-white'
                    : 'bg-white text-[#16241D]'
                }`}
              >
                <span className="mr-1 font-black">{index + 1}</span>
                <span className="align-middle">{slot.insight.candidate.name}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="mt-2 rounded-2xl bg-white/70 px-4 py-2.5 text-center text-xs font-semibold text-[#6E7C75] shadow-sm">
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
                    ? 'border-[#16241D] bg-[#16241D] text-white'
                    : 'border-[#E4EFE9] bg-white text-[#16241D] disabled:text-[#16241D]'
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
                  stroke="rgba(20,35,29,0.38)"
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
                  stroke="rgba(20,35,29,0.38)"
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
                    ? 'border-[#16241D] bg-[#16241D] text-white'
                    : revealed
                      ? 'border-[#E4EFE9] bg-white text-[#16241D]'
                      : 'border-[#E4EFE9] bg-white text-[#9AA8A1]'
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

function DrawChoiceStage({
  variant,
  lock,
  ladderBars,
  onLadderBarsChange,
  onChoose,
  waitingMessage,
}: {
  variant: DrawVariant;
  lock: DrawChoiceLock;
  ladderBars: LadderBar[];
  onLadderBarsChange?: (bars: LadderBar[]) => void;
  onChoose?: (index: number) => void;
  waitingMessage?: string;
}) {
  const accent = drawVariantAccents[variant];
  const isLadder = variant === 'ladder-game';
  const canChoose = Boolean(onChoose);

  return (
    <div className="relative overflow-visible">
      <div
        className={
          isLadder
            ? 'relative min-h-[22rem] p-1.5 sm:min-h-[24rem] sm:p-2'
            : variant === 'spin-wheel'
              ? 'relative min-h-[20rem] px-2 py-3 sm:min-h-[26rem] sm:px-4 sm:py-4'
              : 'relative px-1 py-2 sm:px-2'
        }
      >
        {variant === 'card-shuffle' ? (
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
        ) : null}

        {!canChoose && waitingMessage ? (
          <div className="absolute inset-x-4 bottom-4 z-20 rounded-2xl border border-white/80 bg-white/95 px-4 py-3 text-center text-sm font-semibold text-[#16241D] shadow-[0_18px_42px_rgba(20,35,29,0.14)]">
            {waitingMessage}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function PickedChoiceStage({
  variant,
  selectedIndex = 0,
  lock,
  ladderBars,
  phase,
}: {
  variant: DrawVariant;
  selectedIndex?: number;
  lock: DrawChoiceLock;
  ladderBars: LadderBar[];
  phase: DrawPhase;
}) {
  const accent = drawVariantAccents[variant];
  const isRevealed = phase === 'revealed';
  const isLadder = variant === 'ladder-game';

  return (
    <div className="relative overflow-visible">
      {isRevealed ? (
        <>
          <motion.div
            className="absolute left-1/2 top-1/2 h-72 w-72 -translate-x-1/2 -translate-y-1/2 rounded-full border border-[#FF6B5F]/15"
            initial={{ scale: 0.3, opacity: 0.65 }}
            animate={{ scale: 1.8, opacity: 0 }}
            transition={{ duration: 0.78, ease: 'easeOut' }}
          />
          {Array.from({ length: 12 }, (_, index) => {
            const angle = (Math.PI * 2 * index) / 12;

            return (
              <motion.div
                key={index}
                className="absolute left-1/2 top-1/2 h-1.5 w-1.5 rounded-full bg-[#FF6B5F]/40"
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
              ? 'min-h-[20rem] justify-between px-2 py-3 sm:min-h-[26rem] sm:px-4 sm:py-4'
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
          ) : null}
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
  canChoose = true,
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
      : getChoiceDisplayLabel(variant, selectedStartSlot, selectedSlotIndex);
  const lockedChoiceInsight = selectedChoice?.insight ?? null;
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
  const autoCompleteRef = useRef(false);
  const completePayloadRef = useRef({
    lockCode: choiceLock.code,
    onComplete,
    selectedChoiceLabel,
    variant,
    variantLabel: drawVariantDisplayLabels[variant],
    winner: plan.winner.candidate,
  });

  const variantLabel = drawVariantDisplayLabels[variant];
  const isLadderVariant = variant === 'ladder-game';
  const canChooseSlot = canChoose && pendingSelectedSlotIndex === null;
  const clearPendingChoiceTimer = () => {
    if (pendingChoiceTimerRef.current !== null) {
      window.clearTimeout(pendingChoiceTimerRef.current);
      pendingChoiceTimerRef.current = null;
    }
  };
  const completeRevealedDraw = () => {
    if (autoCompleteRef.current) {
      return;
    }

    autoCompleteRef.current = true;
    const payload = completePayloadRef.current;

    payload.onComplete(payload.winner, {
      variantLabel: payload.variantLabel,
      choiceLabel: payload.selectedChoiceLabel,
      lockCode: payload.lockCode,
    });
  };
  const handleClose = () => {
    if (phase === 'revealed') {
      completeRevealedDraw();
      onClose();
      return;
    }

    if (phase === 'choosing') {
      onClose();
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
    if (selectedSlotIndex === null) {
      setPhase('choosing');
      return;
    }

    let cancelled = false;
    const timeoutIds: number[] = [];
    autoCompleteRef.current = false;

    setPhase('impact');
    timeoutIds.push(window.setTimeout(() => {
      if (!cancelled) {
        setPhase('revealed');
      }
    }, variant === 'spin-wheel' ? 180 : variant === 'ladder-game' ? 3900 : 1550));

    return () => {
      cancelled = true;
      timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
    };
  }, [selectedSlotIndex, variant]);

  useEffect(() => {
    if (phase !== 'revealed' || autoCompleteRef.current) {
      return;
    }

    const timeoutId = window.setTimeout(() => {
      completeRevealedDraw();
    }, variant === 'ladder-game' ? 2300 : variant === 'spin-wheel' ? 900 : 1900);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [phase, variant]);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[9999] flex items-end justify-center overflow-y-auto px-2 py-2 sm:items-center"
    >
      <div
        className="absolute inset-0 bg-[#F5F9F7]"
        onClick={phase === 'choosing' || phase === 'revealed' ? handleClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.96, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        className={`relative my-auto w-full ${isLadderVariant ? 'max-w-2xl' : 'max-w-4xl'}`}
      >
        <button
          type="button"
          onClick={phase === 'choosing' || phase === 'revealed' ? handleClose : undefined}
          className={`fixed right-4 top-4 z-20 flex h-10 w-10 items-center justify-center rounded-full border shadow-sm transition-colors ${
            phase === 'choosing' || phase === 'revealed'
              ? 'border-[#E4EFE9] bg-white text-[#16241D]'
              : 'border-white/40 bg-white/30 text-[#16241D]/35'
          }`}
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div>
          <div className={isLadderVariant ? 'p-1.5 sm:p-2' : 'p-2 sm:p-3'}>
            {phase === 'choosing' || !selectedChoice ? (
              <DrawChoiceStage
                variant={variant}
                lock={choiceLock}
                ladderBars={ladderBars}
                onLadderBarsChange={canChooseSlot ? updateLadderBars : undefined}
                onChoose={
                  canChooseSlot
                    ? (index) => {
                        chooseSlot(index);
                      }
                    : undefined
                }
                waitingMessage={waitingMessage}
              />
            ) : (
              <PickedChoiceStage
                variant={variant}
                selectedIndex={selectedSlotIndex ?? 0}
                lock={choiceLock}
                ladderBars={ladderBars}
                phase={phase}
              />
            )}

          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
