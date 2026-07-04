import {
  Candidate,
  MeetCategoryKey,
  Participant,
  RuntimeAiConfig,
  SelectionModeKey,
  ThrillLevel,
} from '../types';

interface AiGeneratedCandidateRequest {
  participants: Participant[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  thrillLevel: ThrillLevel;
  candidateTargetCount: number;
  runtimeAiConfig?: RuntimeAiConfig | null;
}

interface AiGeneratedCandidateResponse {
  candidates: Candidate[];
  source?: string;
  message?: string;
}

export async function fetchAiGeneratedCandidates({
  participants,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateTargetCount,
  runtimeAiConfig,
}: AiGeneratedCandidateRequest): Promise<AiGeneratedCandidateResponse> {
  const response = await fetch('/api/ai-generated-candidates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      participants,
      selectedCategory,
      selectionMode,
      thrillLevel,
      candidateTargetCount,
      runtimeAiConfig,
    }),
  });
  const data = (await response.json().catch(() => null)) as AiGeneratedCandidateResponse | null;

  if (!response.ok) {
    throw new Error(data?.message ?? 'AI 생성 후보를 가져오지 못했습니다.');
  }

  if (!data) {
    throw new Error('AI 생성 후보를 가져오지 못했습니다.');
  }

  return {
    candidates: Array.isArray(data.candidates) ? data.candidates : [],
    source: data.source,
    message: data.message,
  };
}
