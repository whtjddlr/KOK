import { Participant, ParticipantGender } from '../types';

export const participantGenderOptions: Array<{
  value: ParticipantGender;
  label: string;
}> = [
  { value: 'unspecified', label: '선택 안 함' },
  { value: 'female', label: '여성' },
  { value: 'male', label: '남성' },
];

export function normalizeParticipantGender(value: unknown): ParticipantGender {
  return value === 'female' || value === 'male'
    ? value
    : 'unspecified';
}

export function getParticipantGenderLabel(value?: ParticipantGender | null) {
  const gender = normalizeParticipantGender(value);
  return participantGenderOptions.find((option) => option.value === gender)?.label ?? '선택 안 함';
}

export function buildGroupGenderContext(participants: Array<Pick<Participant, 'gender'>>) {
  const counts = participants.reduce(
    (acc, participant) => {
      const gender = normalizeParticipantGender(participant.gender);
      acc[gender] += 1;
      return acc;
    },
    {
      female: 0,
      male: 0,
      other: 0,
      unspecified: 0,
    } satisfies Record<ParticipantGender, number>,
  );
  const total = participants.length;
  const knownBinaryTotal = counts.female + counts.male;
  const knownTotal = knownBinaryTotal;

  if (!total || !knownTotal) {
    return '성별 정보 없음';
  }

  const parts = [
    counts.female ? `여성 ${counts.female}명` : null,
    counts.male ? `남성 ${counts.male}명` : null,
    counts.unspecified ? `미입력 ${counts.unspecified}명` : null,
  ].filter(Boolean);
  const binaryTone =
    knownBinaryTotal === 0
      ? '성비 판단 어려움'
      : counts.female > 0 && counts.male > 0
        ? '혼성 모임'
        : counts.female > 0
          ? '여성 중심 모임'
          : '남성 중심 모임';

  return `${binaryTone} · 총 ${total}명 · ${parts.join(', ')}`;
}
