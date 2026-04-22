import { useEffect, useState } from 'react';
import confetti from 'canvas-confetti';
import { AnimatePresence, motion } from 'motion/react';
import { Sparkles, X } from 'lucide-react';
import { Candidate, CandidateInsight, DrawPlan } from '../types';
import { buildDrawPlan } from '../lib/meeting';

interface RandomDrawerProps {
  candidateInsights: CandidateInsight[];
  onComplete: (winner: Candidate) => void;
  onClose: () => void;
}

type DrawPhase = 'boot' | 'compressing' | 'lock-in' | 'finalists' | 'revealed';

const PHASE_COPY: Record<DrawPhase, { title: string; description: string }> = {
  boot: {
    title: '추첨 준비 중',
    description: '후보를 섞고 마지막까지 긴장감 있게 압축하고 있어요.',
  },
  compressing: {
    title: '후보 압축 중',
    description: '아직은 모릅니다. 순식간에 얼굴이 바뀌는 구간이에요.',
  },
  'lock-in': {
    title: '진짜 후보만 남기는 중',
    description: '슬슬 윤곽은 보이지만 아직 확정은 아니에요.',
  },
  finalists: {
    title: '마지막 두세 곳',
    description: '이제 거의 끝입니다. 막판에 한 번 더 뒤집힐 수 있어요.',
  },
  revealed: {
    title: '오늘의 약속 장소 확정',
    description: '이 카드로 갈지, 한 번 더 돌릴지 결정하면 됩니다.',
  },
};

export function RandomDrawer({ candidateInsights, onComplete, onClose }: RandomDrawerProps) {
  const [plan, setPlan] = useState<DrawPlan>(() => buildDrawPlan(candidateInsights));
  const [phase, setPhase] = useState<DrawPhase>('boot');
  const [currentInsight, setCurrentInsight] = useState<CandidateInsight>(
    plan.sequence[0] ?? plan.winner,
  );
  const [stepIndex, setStepIndex] = useState(-1);

  useEffect(() => {
    let cancelled = false;
    let timeoutId = 0;

    const runStep = (index: number) => {
      if (cancelled) {
        return;
      }

      if (index >= plan.sequence.length) {
        timeoutId = window.setTimeout(() => {
          if (cancelled) {
            return;
          }

          setCurrentInsight(plan.winner);
          setPhase('revealed');
          void confetti({
            particleCount: 120,
            spread: 70,
            startVelocity: 38,
            origin: { y: 0.62 },
            colors: ['#ff7b6b', '#ffd166', '#4ecdc4', '#ffffff'],
          });
        }, 520);
        return;
      }

      const nextInsight = plan.sequence[index];
      setCurrentInsight(nextInsight);
      setStepIndex(index);

      if (index < Math.floor(plan.sequence.length * 0.5)) {
        setPhase('compressing');
      } else if (index < plan.sequence.length - 5) {
        setPhase('lock-in');
      } else {
        setPhase('finalists');
      }

      const delay =
        index < 10
          ? 90
          : index < plan.sequence.length - 5
            ? 135
            : 240 + (index - (plan.sequence.length - 5)) * 95;
      timeoutId = window.setTimeout(() => runStep(index + 1), delay);
    };

    timeoutId = window.setTimeout(() => runStep(0), 420);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [plan]);

  const handleConfirm = () => {
    onComplete(plan.winner.candidate);
  };

  const handleReroll = () => {
    const nextPlan = buildDrawPlan(candidateInsights);
    setPlan(nextPlan);
    setPhase('boot');
    setStepIndex(-1);
    setCurrentInsight(nextPlan.sequence[0] ?? nextPlan.winner);
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center px-4 py-4 overflow-y-auto"
    >
      <div
        className="absolute inset-0 bg-[radial-gradient(circle_at_top,#24304d,rgba(17,24,39,0.96))]"
        onClick={phase === 'revealed' ? onClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-lg my-auto"
      >
        <button
          onClick={phase === 'revealed' ? onClose : undefined}
          className={`absolute right-2 -top-12 z-10 w-10 h-10 rounded-full border border-white/10 flex items-center justify-center ${
            phase === 'revealed' ? 'bg-white/10 text-white' : 'bg-white/5 text-white/30'
          }`}
        >
          <X className="w-5 h-5" />
        </button>

        <div className="absolute -top-12 left-0 right-0 flex justify-center">
          <motion.div
            animate={phase === 'revealed' ? { rotate: 0, scale: 1.05 } : { rotate: 360, scale: 1 }}
            transition={{
              duration: phase === 'compressing' ? 1.2 : 1.8,
              repeat: phase === 'revealed' ? 0 : Infinity,
              ease: 'linear',
            }}
            className="w-16 h-16 bg-gradient-to-br from-[#ff7b6b] to-[#ffa59b] rounded-full flex items-center justify-center shadow-2xl"
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
        </div>

        <div className="bg-white rounded-[2rem] p-5 sm:p-6 shadow-2xl border border-white/50 max-h-[calc(100dvh-2rem)] overflow-y-auto">
          <div className="mb-5">
            <div className="flex gap-2 mb-4 overflow-x-auto pb-1">
              {['후보 압축', '후반 셔플', '마지막 경쟁', '확정'].map((label, index) => {
                const activeIndex =
                  phase === 'compressing'
                    ? 0
                    : phase === 'lock-in'
                      ? 1
                      : phase === 'finalists'
                        ? 2
                        : phase === 'revealed'
                          ? 3
                          : 0;

                return (
                  <div
                    key={label}
                    className={`rounded-full px-3 py-1.5 text-xs whitespace-nowrap ${
                      index <= activeIndex
                        ? 'bg-[#2d3561] text-white'
                        : 'bg-[#f4f5f7] text-[#98a1ab]'
                    }`}
                  >
                    {label}
                  </div>
                );
              })}
            </div>

            <div className="text-center">
              <h2 className="text-[1.55rem] sm:text-[1.7rem] text-[#1a1a2e] mb-2">
                {PHASE_COPY[phase].title}
              </h2>
              <p className="text-sm text-[#6b7280] leading-relaxed">{PHASE_COPY[phase].description}</p>
              {plan.fallbackNotice && phase !== 'revealed' && (
                <p className="text-xs text-[#cc6b36] mt-2">{plan.fallbackNotice}</p>
              )}
            </div>
          </div>

          <div className="relative h-[min(28rem,48vh)] min-h-[18rem] flex items-center justify-center mb-6 overflow-hidden">
            <div className="absolute inset-x-8 top-8 bottom-8 rounded-[2rem] bg-[radial-gradient(circle_at_top,rgba(255,123,107,0.16),transparent_38%),radial-gradient(circle_at_bottom,rgba(45,53,97,0.12),transparent_42%)]" />

            {plan.finalists
              .filter((finalist) => finalist.candidate.id !== currentInsight.candidate.id)
              .slice(0, 2)
              .map((finalist, index) => (
                <motion.div
                  key={finalist.candidate.id}
                  animate={{
                    scale: 0.92 - index * 0.06,
                    y: 10 + index * 12,
                    opacity: phase === 'revealed' ? 0.12 : 0.26 - index * 0.08,
                  }}
                  className="absolute w-full max-w-sm rounded-[1.8rem] bg-[#eef1f4] border border-white/70 shadow-sm h-52"
                />
              ))}

            <AnimatePresence mode="wait">
              {phase !== 'revealed' ? (
                <motion.div
                  key={`${currentInsight.candidate.id}-${stepIndex}`}
                  initial={{ opacity: 0, scale: 0.92, rotateX: -18 }}
                  animate={{ opacity: 1, scale: 1, rotateX: 0 }}
                  exit={{ opacity: 0, scale: 1.04, rotateX: 18 }}
                  transition={{ duration: 0.22 }}
                  className="w-full max-w-sm relative z-10"
                >
                  <div className="bg-gradient-to-br from-[#f5f1eb] to-[#ede5d7] rounded-[1.8rem] p-6 text-center shadow-xl">
                    <div className="flex items-center justify-center gap-2 mb-4 flex-wrap">
                      <span className="px-3 py-1 rounded-full text-xs bg-white/75 text-[#2d3561]">
                        {currentInsight.candidate.drawMood}
                      </span>
                      <span className="px-3 py-1 rounded-full text-xs bg-white/75 text-[#6b7280]">
                        {currentInsight.candidate.district}
                      </span>
                    </div>
                    <div className="text-5xl text-[#1a1a2e] mb-2">{currentInsight.candidate.name}</div>
                    <div className="text-sm text-[#5d6670] mb-3 leading-relaxed">
                      {currentInsight.candidate.vibe}
                    </div>
                    <div className="text-sm text-[#6b7280] leading-relaxed">
                      {currentInsight.candidate.whyItWorks}
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div
                  key="winner"
                  initial={{ scale: 0.84, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ type: 'spring', duration: 0.6, bounce: 0.3 }}
                  className="w-full max-w-sm relative z-10"
                >
                  <div className="bg-gradient-to-br from-[#ff7b6b] via-[#ff8f7f] to-[#ffa59b] rounded-[2rem] p-8 text-center shadow-[0_24px_60px_rgba(255,123,107,0.28)]">
                    <div className="text-sm text-white/90 mb-2">오늘의 약속 장소</div>
                    <div className="text-5xl text-white mb-3">{plan.winner.candidate.name}</div>
                    <div className="text-white/90 mb-2">{plan.winner.candidate.vibe}</div>
                    <div className="text-sm text-white/85 mb-4">{plan.winner.accessSummary}</div>
                    <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full bg-white/18 text-sm text-white">
                      {plan.winner.candidate.bestFor}
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="flex gap-2 flex-wrap mb-5">
            {plan.finalists.map((finalist) => (
              <div
                key={finalist.candidate.id}
                className={`flex-1 min-w-[110px] rounded-2xl px-3 py-3 border transition-all ${
                  finalist.candidate.id === currentInsight.candidate.id
                    ? 'bg-[#fff3ef] border-[#ffcabf] text-[#1a1a2e]'
                    : 'bg-[#f8f9fb] border-[#eef1f4] text-[#76808a]'
                }`}
              >
                <div className="text-xs mb-1">{finalist.candidate.drawMood}</div>
                <div className="text-sm">{finalist.candidate.name}</div>
              </div>
            ))}
          </div>

          {phase === 'revealed' ? (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="space-y-3"
            >
              <button
                onClick={handleConfirm}
                className="w-full h-12 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-xl shadow-lg active:scale-95 transition-transform"
              >
                이 장소로 확정하기
              </button>
              <button
                onClick={handleReroll}
                className="w-full h-12 bg-white text-[#6b7280] rounded-xl border border-[#e5e7eb] active:scale-95 transition-transform"
              >
                한 번 더 추첨하기
              </button>
            </motion.div>
          ) : (
            <div className="rounded-2xl bg-[#f7f8fa] px-4 py-3 text-sm text-[#6b7280] text-center">
              {phase === 'finalists'
                ? '지금은 막판 흔들림 구간이에요. 거의 정해졌지만 마지막 반전이 남아 있습니다.'
                : '후보를 빠르게 섞고 있어요. 카드가 멈출 때까지 잠깐만 기다려 주세요.'}
            </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
