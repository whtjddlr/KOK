import { useEffect, useMemo, useState } from 'react';
import {
  buildCloseRangeHotplaceQueries,
  buildHotplaceCandidatesFromSearchItems,
} from '../lib/close-range-hotplaces';
import { getCloseParticipantContext } from '../lib/meeting';
import { fetchNearbySearchResults } from '../lib/naver-local-search';
import type { Candidate, MeetCategoryKey, Participant, SelectionModeKey } from '../types';

const closeRangeHotplaceCache = new Map<string, Candidate[]>();

function getParticipantSignature(participants: Participant[]) {
  return participants
    .map(
      (participant) =>
        `${participant.id}:${participant.location}:${participant.coordinates.lat.toFixed(4)}:${participant.coordinates.lng.toFixed(4)}`,
    )
    .join('|');
}

export function useCloseRangeHotplaceCandidates(
  participants: Participant[],
  selectedCategory: MeetCategoryKey,
  selectionMode: SelectionModeKey,
) {
  const eligibleParticipants = useMemo(
    () =>
      participants.filter(
        (participant) =>
          Number.isFinite(participant.coordinates.lat) &&
          Number.isFinite(participant.coordinates.lng),
      ),
    [participants],
  );
  const participantSignature = useMemo(
    () => getParticipantSignature(eligibleParticipants),
    [eligibleParticipants],
  );
  const closeContext = useMemo(
    () => getCloseParticipantContext(eligibleParticipants),
    [eligibleParticipants],
  );
  const queries = useMemo(
    () =>
      selectionMode === 'balance' &&
      closeContext.isCloseGroup &&
      eligibleParticipants.length >= 2
        ? buildCloseRangeHotplaceQueries(eligibleParticipants, selectedCategory)
        : [],
    [
      closeContext.isCloseGroup,
      eligibleParticipants,
      participantSignature,
      selectedCategory,
      selectionMode,
    ],
  );
  const cacheKey = useMemo(
    () => [selectedCategory, selectionMode, participantSignature, ...queries].join(':'),
    [participantSignature, queries, selectedCategory, selectionMode],
  );
  const [candidates, setCandidates] = useState<Candidate[]>(
    closeRangeHotplaceCache.get(cacheKey) ?? [],
  );

  useEffect(() => {
    let active = true;

    if (
      selectionMode !== 'balance' ||
      !closeContext.isCloseGroup ||
      eligibleParticipants.length < 2 ||
      !queries.length
    ) {
      setCandidates([]);
      return () => {
        active = false;
      };
    }

    const cached = closeRangeHotplaceCache.get(cacheKey);

    if (cached) {
      setCandidates(cached);
      return () => {
        active = false;
      };
    }

    setCandidates([]);

    Promise.all(
      queries.map((query) =>
        fetchNearbySearchResults(query, 10, 'comment').then((items) => [query, items] as const),
      ),
    )
      .then((entries) => {
        if (!active) {
          return;
        }

        const itemsByQuery = Object.fromEntries(entries);
        const nextCandidates = buildHotplaceCandidatesFromSearchItems({
          participants: eligibleParticipants,
          selectedCategory,
          itemsByQuery,
        });

        closeRangeHotplaceCache.set(cacheKey, nextCandidates);
        setCandidates(nextCandidates);
      })
      .catch(() => {
        if (!active) {
          return;
        }

        closeRangeHotplaceCache.set(cacheKey, []);
        setCandidates([]);
      });

    return () => {
      active = false;
    };
  }, [
    cacheKey,
    closeContext.isCloseGroup,
    eligibleParticipants,
    queries,
    selectedCategory,
    selectionMode,
  ]);

  return { candidates };
}
