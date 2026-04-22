import { ReactNode } from 'react';
import { MapPin, Sparkles, Users } from 'lucide-react';

interface HomeScreenProps {
  onCreateRoom: () => void;
}

export function HomeScreen({ onCreateRoom }: HomeScreenProps) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-[#fafaf8] via-[#f5f1eb] to-[#e8dfd0] flex flex-col">
      <div className="flex-1 flex flex-col items-center justify-center px-6 py-12">
        <div className="w-24 h-24 bg-gradient-to-br from-[#ff7b6b] to-[#ff9b8b] rounded-3xl flex items-center justify-center mb-6 shadow-lg">
          <Sparkles className="w-12 h-12 text-white" />
        </div>

        <h1 className="text-4xl mb-3 text-[#1a1a2e] text-center">랜덤밋</h1>
        <p className="text-lg text-[#6b7280] text-center mb-12 max-w-xs">
          약속 장소 정하기 어려울 때
          <br />
          공정하고 짜릿하게 한 번에 정해요.
        </p>

        <div className="w-full max-w-md space-y-4 mb-12">
          <FeatureCard
            icon={<MapPin className="w-6 h-6 text-[#4ecdc4]" />}
            title="지도 위에서 공통 범위 확인"
            description="출발지와 이동 가능 시간을 겹쳐서 모두가 갈 수 있는 지역만 추려요."
          />
          <FeatureCard
            icon={<Sparkles className="w-6 h-6 text-[#ff7b6b]" />}
            title="막판까지 긴장감 있는 추첨"
            description="후보를 압축한 뒤 마지막 두세 곳 사이에서 흔들리다가 한 곳으로 확정돼요."
          />
          <FeatureCard
            icon={<Users className="w-6 h-6 text-[#ffd166]" />}
            title="교통비 감면까지 한 번에 정산"
            description="멀리 온 사람은 조금 덜 내도록 자동으로 보정해 결과를 정리해요."
          />
        </div>

        <button
          onClick={onCreateRoom}
          className="w-full max-w-md h-14 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-2xl shadow-lg active:scale-95 transition-transform"
        >
          방 만들기
        </button>

        <button className="mt-4 text-[#6b7280] text-sm">초대 코드로 참여하기</button>
      </div>

      <div className="p-6 text-center text-xs text-[#9ca3af]">
        v1.0.0 · 수도권 랜덤 약속 MVP
      </div>
    </div>
  );
}

interface FeatureCardProps {
  icon: ReactNode;
  title: string;
  description: string;
}

function FeatureCard({ icon, title, description }: FeatureCardProps) {
  return (
    <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-4 flex gap-4 shadow-sm">
      <div className="flex-shrink-0 w-12 h-12 bg-[#fafaf8] rounded-xl flex items-center justify-center">
        {icon}
      </div>
      <div className="flex-1">
        <h3 className="text-[#1a1a2e] mb-1">{title}</h3>
        <p className="text-sm text-[#6b7280]">{description}</p>
      </div>
    </div>
  );
}
