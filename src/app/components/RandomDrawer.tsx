import { useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { MapPin, Zap, X } from 'lucide-react';
import {
  Candidate,
  CandidateInsight,
  CandidateScopeKey,
  DrawPlan,
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
  onComplete: (winner: Candidate) => void;
  onClose: () => void;
}

type DrawPhase = 'boot' | 'scanning' | 'charging' | 'impact' | 'revealed';

type PlacedCandidate = {
  insight: CandidateInsight;
  x: number;
  y: number;
};

const PHASE_COPY: Record<DrawPhase, { title: string; description: string }> = {
  boot: {
    title: '좌표를 잠그는 중',
    description: '후보 지점을 지도 위에 올리고 있어요.',
  },
  scanning: {
    title: '번개가 후보를 훑는 중',
    description: '어디에 떨어질지 아직 모릅니다.',
  },
  charging: {
    title: '낙뢰가 수렴하는 중',
    description: '마지막 지점 근처로 화면이 당겨집니다.',
  },
  impact: {
    title: '낙뢰 좌표 고정',
    description: '한 지점으로 강하게 떨어집니다.',
  },
  revealed: {
    title: '오늘의 약속 장소 확정',
    description: '이 좌표로 갈지, 다시 떨어뜨릴지 고르면 됩니다.',
  },
};

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
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
  const latRange = Math.max(maxLat - minLat, 0.015);
  const lngRange = Math.max(maxLng - minLng, 0.015);

  return insights.map((insight, index) => {
    const xBase = ((insight.candidate.coordinates.lng - minLng) / lngRange) * 100;
    const yBase = (1 - (insight.candidate.coordinates.lat - minLat) / latRange) * 100;
    const orbitX = Math.sin(index * 1.7) * 3.5;
    const orbitY = Math.cos(index * 1.3) * 3;

    return {
      insight,
      x: clamp(12 + xBase * 0.76 + orbitX, 10, 90),
      y: clamp(14 + yBase * 0.7 + orbitY, 12, 86),
    };
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

function buildLightningPoints(target: { x: number; y: number }, seed: number, variance = 7) {
  const steps = 7;
  const points: string[] = ['50,0'];

  for (let index = 1; index < steps; index += 1) {
    const progress = index / steps;
    const wave = Math.sin(seed * 1.37 + index * 1.12) * variance;
    const pull = (target.x - 50) * progress;
    const x = clamp(50 + pull + wave, 8, 92);
    const y = progress * target.y;
    points.push(`${x},${y}`);
  }

  points.push(`${target.x},${target.y}`);
  return points.join(' ');
}

function getCameraState(activePoint: { x: number; y: number } | null, phase: DrawPhase) {
  if (!activePoint) {
    return {
      x: '0%',
      y: '0%',
      scale: 1,
    };
  }

  return {
    x: `${(50 - activePoint.x) * 0.34}%`,
    y: `${(50 - activePoint.y) * 0.28}%`,
    scale:
      phase === 'impact' ? 1.24 : phase === 'revealed' ? 1.18 : phase === 'charging' ? 1.1 : 1.04,
  };
}

export function RandomDrawer({
  candidateInsights,
  categoryLabel,
  modeLabel,
  selectionMode = 'balance',
  thrillLevel = 1,
  candidateScope = 'standard',
  onComplete,
  onClose,
}: RandomDrawerProps) {
  const [plan, setPlan] = useState<DrawPlan>(() =>
    buildDrawPlan(candidateInsights, selectionMode, thrillLevel, candidateScope),
  );
  const [phase, setPhase] = useState<DrawPhase>('boot');
  const [currentInsight, setCurrentInsight] = useState<CandidateInsight>(
    plan.sequence[0] ?? plan.winner,
  );
  const [stepIndex, setStepIndex] = useState(-1);
  const [boltSeed, setBoltSeed] = useState(0);

  const placedCandidates = useMemo(() => layoutCandidates(candidateInsights), [candidateInsights]);
  const visiblePoints = useMemo(
    () => getUniqueVisiblePoints(placedCandidates),
    [placedCandidates],
  );
  const activePoint =
    placedCandidates.find((point) => point.insight.candidate.id === currentInsight.candidate.id) ??
    placedCandidates[0] ??
    null;
  const finalistIds = useMemo(
    () => new Set(plan.finalists.map((item) => item.candidate.id)),
    [plan.finalists],
  );
  const cameraState = useMemo(() => getCameraState(activePoint, phase), [activePoint, phase]);
  const progress = plan.sequence.length ? (stepIndex + 1) / plan.sequence.length : 0;

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    const runStep = (index: number) => {
      if (cancelled) {
        return;
      }

      if (index >= plan.sequence.length) {
        setPhase('impact');
        setCurrentInsight(plan.winner);
        setBoltSeed((current) => current + 5);

        timeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          setPhase('revealed');
        }, 820);
        return;
      }

      const nextInsight = plan.sequence[index];
      const nextProgress = index / Math.max(plan.sequence.length - 1, 1);

      setCurrentInsight(nextInsight);
      setStepIndex(index);
      setBoltSeed((current) => current + 1);

      if (nextProgress < 0.6) {
        setPhase('scanning');
      } else {
        setPhase('charging');
      }

      const delay =
        index < 10
          ? 85
          : nextProgress < 0.6
            ? 115
            : 190 + Math.max(0, index - (plan.sequence.length - 5)) * 80;

      timeoutId = window.setTimeout(() => runStep(index + 1), delay);
    };

    setPhase('boot');
    setStepIndex(-1);
    setCurrentInsight(plan.sequence[0] ?? plan.winner);
    setBoltSeed(0);
    timeoutId = window.setTimeout(() => runStep(0), 260);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [plan]);

  const handleConfirm = () => {
    onComplete(plan.winner.candidate);
  };

  const handleReroll = () => {
    const nextPlan = buildDrawPlan(candidateInsights, selectionMode, thrillLevel, candidateScope);
    setPlan(nextPlan);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto px-4 py-4 sm:items-center"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(94,132,255,0.28),rgba(6,10,19,0.96)_52%),linear-gradient(180deg,#060b13,#0b1220)]"
        onClick={phase === 'revealed' ? onClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.94, y: 18 }}
        animate={{ scale: 1, y: 0 }}
        className="relative my-auto w-full max-w-3xl"
      >
        <button
          type="button"
          onClick={phase === 'revealed' ? onClose : undefined}
          className={`absolute right-3 top-3 z-20 flex h-10 w-10 items-center justify-center rounded-full border ${
            phase === 'revealed'
              ? 'border-white/20 bg-white/10 text-white'
              : 'border-white/10 bg-white/5 text-white/40'
          }`}
          aria-label="닫기"
        >
          <X className="h-5 w-5" />
        </button>

        <div className="overflow-hidden rounded-[2rem] border border-white/10 bg-[#0d1525]/95 shadow-[0_28px_80px_rgba(0,0,0,0.45)] backdrop-blur-sm">
          <div className="border-b border-white/10 px-6 py-5">
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/80">
                <Zap className="h-3.5 w-3.5 text-[#9ec5ff]" />
                번개 추첨
              </div>
              {categoryLabel ? (
                <div className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/70">
                  {categoryLabel}
                </div>
              ) : null}
              {modeLabel ? (
                <div className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/70">
                  {modeLabel}
                </div>
              ) : null}
            </div>

            <div className="mt-4 flex flex-col gap-2 md:flex-row md:items-end md:justify-between">
              <div>
                <h2 className="text-[1.65rem] text-white">{PHASE_COPY[phase].title}</h2>
                <p className="mt-1 text-sm text-white/60">{PHASE_COPY[phase].description}</p>
              </div>
              <div className="rounded-full bg-white/8 px-4 py-2 text-xs text-white/70">
                후보 {visiblePoints.length}개
              </div>
            </div>
          </div>

          <div className="p-5 sm:p-6">
            <div className="relative overflow-hidden rounded-[1.8rem] border border-white/10 bg-[linear-gradient(180deg,rgba(9,18,34,0.98),rgba(12,22,40,0.96))]">
              <div className="absolute inset-0 bg-[linear-gradient(rgba(151,177,222,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(151,177,222,0.08)_1px,transparent_1px)] bg-[size:34px_34px]" />
              <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(120,168,255,0.22),transparent_35%),radial-gradient(circle_at_20%_85%,rgba(255,123,107,0.10),transparent_28%),radial-gradient(circle_at_85%_80%,rgba(78,205,196,0.10),transparent_22%)]" />
              <div className="absolute left-1/2 top-0 h-24 w-24 -translate-x-1/2 rounded-full bg-[#bfd8ff]/20 blur-3xl" />

              <div className="relative h-[24rem] sm:h-[28rem]">
                <motion.div
                  className="absolute inset-0"
                  animate={cameraState}
                  transition={{ duration: phase === 'impact' ? 0.28 : 0.4, ease: 'easeOut' }}
                >
                  <svg
                    viewBox="0 0 100 100"
                    preserveAspectRatio="none"
                    className="absolute inset-0 h-full w-full opacity-90"
                  >
                    <path
                      d="M8 22 L18 14 L32 18 L44 12 L58 20 L70 15 L86 24 L90 38 L84 52 L90 68 L82 84 L67 90 L50 86 L36 92 L20 86 L11 72 L14 54 L8 40 Z"
                      fill="rgba(94,132,255,0.08)"
                      stroke="rgba(180,205,255,0.18)"
                      strokeWidth="0.8"
                    />
                    <path
                      d="M12 50 C24 44, 34 57, 46 51 S70 38, 88 46"
                      fill="none"
                      stroke="rgba(121,195,255,0.45)"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                    />
                    <path
                      d="M15 31 L28 28 L39 35 L54 31 L66 36 L78 33"
                      fill="none"
                      stroke="rgba(255,255,255,0.09)"
                      strokeWidth="0.8"
                      strokeDasharray="2 3"
                    />
                    <path
                      d="M18 69 L31 63 L43 68 L58 61 L73 66 L85 60"
                      fill="none"
                      stroke="rgba(255,255,255,0.08)"
                      strokeWidth="0.8"
                      strokeDasharray="2 3"
                    />

                    {visiblePoints.slice(0, 5).map((point) => (
                      <text
                        key={`label-${point.insight.candidate.id}`}
                        x={point.x + 1.8}
                        y={point.y - 3}
                        fontSize="3"
                        fill="rgba(255,255,255,0.22)"
                      >
                        {point.insight.candidate.name}
                      </text>
                    ))}

                    <text x="45" y="47" fontSize="3.2" fill="rgba(121,195,255,0.35)">
                      HAN RIVER
                    </text>

                    {activePoint ? (
                      <>
                        <motion.polyline
                          key={`bolt-main-${boltSeed}-${phase}`}
                          points={buildLightningPoints(activePoint, boltSeed, phase === 'impact' ? 4 : 7)}
                          fill="none"
                          stroke="#f6fbff"
                          strokeWidth={phase === 'impact' ? 1.8 : 1.3}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0, opacity: 0 }}
                          animate={{ pathLength: 1, opacity: phase === 'revealed' ? 0.28 : 1 }}
                          transition={{ duration: phase === 'impact' ? 0.24 : 0.18, ease: 'easeOut' }}
                          style={{
                            filter:
                              phase === 'impact'
                                ? 'drop-shadow(0 0 16px rgba(191,216,255,0.95))'
                                : 'drop-shadow(0 0 10px rgba(191,216,255,0.9))',
                          }}
                        />
                        <motion.polyline
                          key={`bolt-shadow-${boltSeed}-${phase}`}
                          points={buildLightningPoints(activePoint, boltSeed + 2, phase === 'impact' ? 6 : 9)}
                          fill="none"
                          stroke="rgba(120,168,255,0.8)"
                          strokeWidth={phase === 'impact' ? 1.2 : 0.8}
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          initial={{ pathLength: 0, opacity: 0 }}
                          animate={{ pathLength: 1, opacity: phase === 'revealed' ? 0.15 : 0.8 }}
                          transition={{ duration: phase === 'impact' ? 0.28 : 0.2, ease: 'easeOut' }}
                        />
                      </>
                    ) : null}
                  </svg>

                  {phase === 'scanning' && (
                    <motion.div
                      initial={{ x: '-20%', opacity: 0 }}
                      animate={{ x: '120%', opacity: [0, 0.35, 0] }}
                      transition={{ duration: 1.25, repeat: Infinity, ease: 'linear' }}
                      className="absolute inset-y-0 w-24 bg-[linear-gradient(90deg,transparent,rgba(173,206,255,0.18),transparent)] blur-sm"
                    />
                  )}

                  {visiblePoints.map((point) => {
                    const isActive = point.insight.candidate.id === currentInsight.candidate.id;
                    const isWinner = point.insight.candidate.id === plan.winner.candidate.id;
                    const isFinalist = finalistIds.has(point.insight.candidate.id);

                    return (
                      <motion.div
                        key={point.insight.candidate.id}
                        animate={
                          isActive
                            ? {
                                scale: phase === 'impact' ? 1.35 : 1.14,
                                opacity: 1,
                              }
                            : {
                                scale: 1,
                                opacity: phase === 'revealed' && !isWinner ? 0.42 : 0.78,
                              }
                        }
                        transition={{ duration: 0.16 }}
                        className="absolute -translate-x-1/2 -translate-y-1/2"
                        style={{ left: `${point.x}%`, top: `${point.y}%` }}
                      >
                        <div className="relative flex flex-col items-center gap-2">
                          {(isActive || (phase === 'revealed' && isWinner)) && (
                            <motion.div
                              key={`${point.insight.candidate.id}-${phase}`}
                              initial={{ opacity: 0, y: 8, scale: 0.92 }}
                              animate={{ opacity: 1, y: 0, scale: 1 }}
                              className="rounded-full border border-white/20 bg-white/12 px-3 py-1.5 text-xs text-white shadow-[0_8px_28px_rgba(0,0,0,0.28)] backdrop-blur-sm"
                            >
                              {point.insight.candidate.name}
                            </motion.div>
                          )}

                          <div className="relative">
                            {(isActive || (phase === 'revealed' && isWinner)) && (
                              <motion.div
                                animate={{
                                  scale: phase === 'impact' ? [1, 2.8, 2.2] : [1, 2.2, 1.6],
                                  opacity: [0.8, 0.05, 0.22],
                                }}
                                transition={{
                                  duration: phase === 'impact' ? 0.55 : 1.2,
                                  repeat: phase === 'revealed' ? 0 : Infinity,
                                  ease: 'easeOut',
                                }}
                                className="absolute inset-0 rounded-full bg-[#9ec5ff]"
                              />
                            )}

                            <div
                              className={`relative flex h-5 w-5 items-center justify-center rounded-full border ${
                                isWinner && phase === 'revealed'
                                  ? 'border-[#fff6cf] bg-[#ffd166]'
                                  : isActive
                                    ? 'border-[#f6fbff] bg-[#8dbbff]'
                                    : isFinalist
                                      ? 'border-white/60 bg-white/18'
                                      : 'border-white/35 bg-white/10'
                              }`}
                            >
                              <div
                                className={`h-2.5 w-2.5 rounded-full ${
                                  isWinner && phase === 'revealed'
                                    ? 'bg-[#1f2a44]'
                                    : isActive
                                      ? 'bg-white'
                                      : 'bg-white/70'
                                }`}
                              />
                            </div>
                          </div>
                        </div>
                      </motion.div>
                    );
                  })}
                </motion.div>

                {(phase === 'impact' || phase === 'revealed') && activePoint ? (
                  <motion.div
                    key={`flash-${boltSeed}`}
                    initial={{ opacity: 0.55, scale: 0.4 }}
                    animate={{ opacity: 0, scale: 2.8 }}
                    transition={{ duration: 0.48, ease: 'easeOut' }}
                    className="absolute h-36 w-36 -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(circle,rgba(255,245,201,0.86),rgba(158,197,255,0.22),transparent_70%)]"
                    style={{ left: `${activePoint.x}%`, top: `${activePoint.y}%` }}
                  />
                ) : null}

                <div className="absolute bottom-4 left-4 rounded-full bg-black/25 px-3 py-1.5 text-[11px] text-white/65 backdrop-blur-sm">
                  핀을 따라 화면이 움직이고 마지막에 낙뢰가 고정됩니다
                </div>
              </div>
            </div>

            <div className="mt-5 rounded-[1.6rem] border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-xs text-white/55">현재 포착 지점</div>
                  <div className="mt-1 flex items-center gap-2 text-lg text-white">
                    <MapPin className="h-4 w-4 text-[#ffd166]" />
                    {currentInsight.candidate.name}
                  </div>
                </div>
                <div className="rounded-full bg-white/8 px-3 py-1.5 text-xs text-white/65">
                  {currentInsight.candidate.district}
                </div>
              </div>

              <div className="h-2 overflow-hidden rounded-full bg-white/8">
                <motion.div
                  className="h-full rounded-full bg-[linear-gradient(90deg,#8dbbff,#ffd166)]"
                  animate={{ width: `${phase === 'revealed' ? 100 : Math.max(progress * 100, 4)}%` }}
                  transition={{ duration: 0.18 }}
                />
              </div>

              <AnimatePresence mode="wait">
                {phase === 'revealed' ? (
                  <motion.div
                    key="winner-card"
                    initial={{ opacity: 0, y: 12 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -12 }}
                    className="mt-4 rounded-[1.4rem] border border-[#ffe4a3]/35 bg-[linear-gradient(135deg,rgba(255,209,102,0.14),rgba(120,168,255,0.10))] p-4"
                  >
                    <div className="text-xs text-white/60">최종 낙뢰 지점</div>
                    <div className="mt-2 text-3xl text-white">{plan.winner.candidate.name}</div>
                    <div className="mt-1 text-sm text-white/65">{plan.winner.candidate.description}</div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>

            <div className="mt-5 flex gap-2">
              {phase === 'revealed' ? (
                <>
                  <button
                    type="button"
                    onClick={handleConfirm}
                    className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-white text-[#111827] transition-transform active:scale-95"
                  >
                    이 결과로 갈래
                  </button>
                  <button
                    type="button"
                    onClick={handleReroll}
                    className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-white/8 text-white transition-transform active:scale-95"
                  >
                    다시 떨어뜨리기
                  </button>
                </>
              ) : (
                <div className="flex h-12 flex-1 items-center justify-center rounded-2xl bg-white/8 text-sm text-white/60">
                  번개가 좌표를 고르는 중입니다...
                </div>
              )}
            </div>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
