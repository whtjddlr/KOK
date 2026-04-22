import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, X } from 'lucide-react';
import { Candidate } from '../types';

interface RandomDrawerProps {
  candidates: Candidate[];
  onComplete: (winner: Candidate) => void;
  onClose: () => void;
}

export function RandomDrawer({ candidates, onComplete, onClose }: RandomDrawerProps) {
  const [phase, setPhase] = useState<'idle' | 'shuffling' | 'slowing' | 'revealing'>('idle');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [winner, setWinner] = useState<Candidate | null>(null);

  useEffect(() => {
    if (phase === 'idle') {
      const timer = setTimeout(() => setPhase('shuffling'), 500);
      return () => clearTimeout(timer);
    }

    if (phase === 'shuffling') {
      let count = 0;
      const maxCount = 30;
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % candidates.length);
        count++;
        if (count >= maxCount) {
          clearInterval(interval);
          setPhase('slowing');
        }
      }, 80);
      return () => clearInterval(interval);
    }

    if (phase === 'slowing') {
      let count = 0;
      const maxCount = 8;
      const interval = setInterval(() => {
        setCurrentIndex((prev) => (prev + 1) % candidates.length);
        count++;
        if (count >= maxCount) {
          clearInterval(interval);
          const finalWinner = candidates[currentIndex];
          setWinner(finalWinner);
          setPhase('revealing');
        }
      }, 200);
      return () => clearInterval(interval);
    }
  }, [phase, candidates, currentIndex]);

  const handleConfirm = () => {
    if (winner) {
      onComplete(winner);
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-50 flex items-center justify-center px-4"
    >
      <div
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={phase === 'idle' ? onClose : undefined}
      />

      <motion.div
        initial={{ scale: 0.9, y: 20 }}
        animate={{ scale: 1, y: 0 }}
        className="relative w-full max-w-md"
      >
        <div className="absolute -top-12 left-0 right-0 flex justify-center">
          <motion.div
            animate={
              phase === 'shuffling' || phase === 'slowing'
                ? { rotate: 360 }
                : { rotate: 0 }
            }
            transition={{
              duration: phase === 'shuffling' ? 1 : 2,
              repeat: phase === 'shuffling' || phase === 'slowing' ? Infinity : 0,
              ease: 'linear',
            }}
            className="w-16 h-16 bg-gradient-to-br from-[#ff7b6b] to-[#ffa59b] rounded-full flex items-center justify-center shadow-2xl"
          >
            <Sparkles className="w-8 h-8 text-white" />
          </motion.div>
        </div>

        <div className="bg-white rounded-3xl p-6 shadow-2xl">
          {phase !== 'revealing' ? (
            <div className="text-center mb-6">
              <h2 className="text-2xl text-[#1a1a2e] mb-2">
                {phase === 'idle' && '약속 장소 추첨 시작'}
                {phase === 'shuffling' && '후보지 섞는 중...'}
                {phase === 'slowing' && '결정하는 중...'}
              </h2>
              <p className="text-sm text-[#6b7280]">
                {phase === 'idle' && '준비되셨나요?'}
                {(phase === 'shuffling' || phase === 'slowing') && '어디가 나올까요?'}
              </p>
            </div>
          ) : (
            <div className="text-center mb-6">
              <motion.div
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ type: 'spring', duration: 0.6 }}
              >
                <h2 className="text-3xl text-[#1a1a2e] mb-2">🎉</h2>
                <h3 className="text-xl text-[#1a1a2e] mb-1">오늘의 약속 장소는</h3>
              </motion.div>
            </div>
          )}

          <div className="relative h-48 flex items-center justify-center mb-6">
            <AnimatePresence mode="wait">
              {phase !== 'revealing' ? (
                <motion.div
                  key={currentIndex}
                  initial={{ rotateY: -90, opacity: 0 }}
                  animate={{ rotateY: 0, opacity: 1 }}
                  exit={{ rotateY: 90, opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="w-full"
                >
                  <div className="bg-gradient-to-br from-[#f5f1eb] to-[#e8dfd0] rounded-2xl p-6 text-center">
                    <div className="text-4xl mb-2">{candidates[currentIndex].name}</div>
                    <div className="text-sm text-[#6b7280]">
                      {candidates[currentIndex].vibe}
                    </div>
                  </div>
                </motion.div>
              ) : (
                winner && (
                  <motion.div
                    key="winner"
                    initial={{ scale: 0.8, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ type: 'spring', duration: 0.6 }}
                    className="w-full"
                  >
                    <div className="bg-gradient-to-br from-[#ff7b6b] to-[#ffa59b] rounded-2xl p-8 text-center shadow-2xl">
                      <div className="text-5xl text-white mb-3">{winner.name}</div>
                      <div className="text-white/90 mb-4">{winner.vibe}</div>
                      <div className="text-sm text-white/80">{winner.description}</div>
                    </div>
                  </motion.div>
                )
              )}
            </AnimatePresence>
          </div>

          {phase === 'revealing' && winner && (
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.5 }}
              className="space-y-3"
            >
              <button
                onClick={handleConfirm}
                className="w-full h-12 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-xl shadow-lg active:scale-95 transition-transform"
              >
                이 장소로 확정하기
              </button>
              <button
                onClick={() => {
                  setPhase('idle');
                  setWinner(null);
                  setCurrentIndex(0);
                }}
                className="w-full h-12 bg-white text-[#6b7280] rounded-xl border border-[#e5e7eb] active:scale-95 transition-transform"
              >
                다시 뽑기
              </button>
            </motion.div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}
