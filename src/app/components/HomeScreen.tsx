import { MapPin, Users, Sparkles } from 'lucide-react';

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
          약속 장소 정하기 어려울 땐<br />
          공정하게 랜덤으로 뽑자!
        </p>

        <div className="w-full max-w-md space-y-4 mb-12">
          <FeatureCard
            icon={<MapPin className="w-6 h-6 text-[#4ecdc4]" />}
            title="모두에게 공정한 중간지점"
            description="출발지 기반으로 접근 가능한 장소만 추천"
          />
          <FeatureCard
            icon={<Sparkles className="w-6 h-6 text-[#ff7b6b]" />}
            title="랜덤 추첨으로 결정"
            description="더 이상 고민하지 말고 운명에 맡겨요"
          />
          <FeatureCard
            icon={<Users className="w-6 h-6 text-[#ffd166]" />}
            title="교통비 보정 정산"
            description="먼 곳에서 온 친구는 덜 내도록 자동 계산"
          />
        </div>

        <button
          onClick={onCreateRoom}
          className="w-full max-w-md h-14 bg-gradient-to-r from-[#2d3561] to-[#3d4575] text-white rounded-2xl shadow-lg active:scale-95 transition-transform"
        >
          약속 만들기
        </button>

        <button className="mt-4 text-[#6b7280] text-sm">
          초대코드로 참여하기
        </button>
      </div>

      <div className="p-6 text-center text-xs text-[#9ca3af]">
        v1.0.0 · Made with ❤️
      </div>
    </div>
  );
}

interface FeatureCardProps {
  icon: React.ReactNode;
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
