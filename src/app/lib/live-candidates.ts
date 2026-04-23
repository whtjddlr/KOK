import {
  CandidateInsight,
  CandidateScopeKey,
  MeetCategoryKey,
  Participant,
  RuntimeAiConfig,
  SelectionModeKey,
  ThrillLevel,
} from '../types';

interface LiveCandidateRequest {
  participants: Participant[];
  insights: CandidateInsight[];
  fallbackCandidateIds: string[];
  selectedCategory: MeetCategoryKey;
  selectionMode: SelectionModeKey;
  thrillLevel: ThrillLevel;
  candidateScope: CandidateScopeKey;
  runtimeAiConfig?: RuntimeAiConfig | null;
}

interface LiveCandidateResponse {
  candidateIds: string[];
  source?: string;
  message?: string;
}

export async function fetchLiveCandidates({
  participants,
  insights,
  fallbackCandidateIds,
  selectedCategory,
  selectionMode,
  thrillLevel,
  candidateScope,
  runtimeAiConfig,
}: LiveCandidateRequest): Promise<LiveCandidateResponse> {
  const response = await fetch('/api/live-candidates', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      participants,
      insights,
      fallbackCandidateIds,
      selectedCategory,
      selectionMode,
      thrillLevel,
      candidateScope,
      runtimeAiConfig,
    }),
  });

  const data = (await response.json()) as LiveCandidateResponse;

  if (!response.ok) {
    throw new Error(data.message ?? '실시간 후보를 가져오지 못했습니다.');
  }

  return data;
}
