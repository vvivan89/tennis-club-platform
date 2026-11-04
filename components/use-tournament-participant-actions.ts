import { useMemo, type Dispatch, type SetStateAction } from 'react';
import type { FormEvent } from 'react';
import { isGenderEligibleForCategory } from '@/lib/tournament-config';
import type { MemberOption } from '@/components/searchable-member-select';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import type { Match, Member, Pair, Participant } from '@/components/tournament-management-types';

type Db = ReturnType<typeof createSupabaseBrowserClient>;
type State = {
  participants: Participant[];
  members: Member[];
  pairs: Pair[];
  matches: Match[];
  matchPlayers: MatchPlayer[];
  pairCategory: string;
  memberId: string;
  participantName: string;
  participantEmail: string;
  participantPhone: string;
  participantGender: string;
  teamName: string;
  teamColor: string;
  teamLogo: File | null;
  captain: string;
  pairOne: string;
  pairTwo: string;
  replacementParticipantId: string;
  leagueMemberEligibility: Record<string, boolean>;
};
type MatchPlayer = {
  match_id: string;
  participant_id: string;
  side: number;
  team_id: string | null;
};
type Setters = {
  setBusy: Dispatch<SetStateAction<boolean>>;
  setError: Dispatch<SetStateAction<string>>;
  setMessage: Dispatch<SetStateAction<string>>;
  setMemberId: Dispatch<SetStateAction<string>>;
  setParticipantName: Dispatch<SetStateAction<string>>;
  setParticipantEmail: Dispatch<SetStateAction<string>>;
  setParticipantPhone: Dispatch<SetStateAction<string>>;
  setParticipantGender: Dispatch<SetStateAction<string>>;
  setTeamName: Dispatch<SetStateAction<string>>;
  setTeamColor: Dispatch<SetStateAction<string>>;
  setTeamLogo: Dispatch<SetStateAction<File | null>>;
  setCaptain: Dispatch<SetStateAction<string>>;
  setPairOne: Dispatch<SetStateAction<string>>;
  setPairTwo: Dispatch<SetStateAction<string>>;
};

export function useTournamentParticipantActions({
  db,
  eventId,
  leagueId,
  priceCents,
  leagueTournament,
  leagueGender,
  isTeam,
  activeCategory,
  state,
  setters,
  refresh,
}: {
  db: Db;
  eventId: string;
  leagueId: string | null;
  priceCents: number;
  leagueTournament: boolean;
  leagueGender: string | null;
  isTeam: boolean;
  activeCategory: string;
  state: State;
  setters: Setters;
  refresh: () => Promise<void>;
}) {
  const {
    participants,
    members,
    pairs,
    matches,
    matchPlayers,
    pairCategory,
    memberId,
    participantName,
    participantEmail,
    participantPhone,
    participantGender,
    teamName,
    teamColor,
    teamLogo,
    captain,
    pairOne,
    pairTwo,
    replacementParticipantId,
    leagueMemberEligibility,
  } = state;
  const {
    setBusy,
    setError,
    setMessage,
    setMemberId,
    setParticipantName,
    setParticipantEmail,
    setParticipantPhone,
    setParticipantGender,
    setTeamName,
    setTeamColor,
    setTeamLogo,
    setCaptain,
    setPairOne,
    setPairTwo,
  } = setters;
  const activeParticipants = useMemo(
    () => participants.filter((p) => p.status === 'registered'),
    [participants],
  );
  const normalizedProfileGender = (gender: string | null | undefined) => {
    const value = gender?.trim().toLowerCase();
    if (['m', 'man', 'men', 'male'].includes(value || '')) return 'male';
    if (['f', 'woman', 'women', 'female'].includes(value || '')) return 'female';
    return value || '';
  };
  const hasOpposingGenderProfile = (gender: string | null | undefined, category: string) => {
    const normalized = normalizedProfileGender(gender);
    return (
      (category === 'men' && normalized === 'female') ||
      (category === 'women' && normalized === 'male')
    );
  };
  const profileGenderLabel = (gender: string | null | undefined, category: string) =>
    hasOpposingGenderProfile(gender, category) ? `Profile gender: ${gender}` : undefined;
  const availablePairPlayers = useMemo(
    () =>
      [...activeParticipants].sort((a, b) => {
        const aPaired = pairs.some(
          (pair) =>
            pair.status !== 'withdrawn' &&
            pair.category === pairCategory &&
            (pair.player_one_id === a.id || pair.player_two_id === a.id),
        );
        const bPaired = pairs.some(
          (pair) =>
            pair.status !== 'withdrawn' &&
            pair.category === pairCategory &&
            (pair.player_one_id === b.id || pair.player_two_id === b.id),
        );
        const aOpposing = hasOpposingGenderProfile(a.gender, pairCategory);
        const bOpposing = hasOpposingGenderProfile(b.gender, pairCategory);
        return (
          Number(aPaired) - Number(bPaired) ||
          Number(aOpposing) - Number(bOpposing) ||
          a.display_name.localeCompare(b.display_name)
        );
      }),
    [activeParticipants, pairs, pairCategory],
  );
  function pairPlayerRestriction(
    participant: Participant,
    selectedPartnerId: string,
    ignorePairId?: string,
  ) {
    if (participant.category !== pairCategory) return 'Not registered in this category';
    if (participant.id === selectedPartnerId) return 'Already selected as the other player';
    const existingPair = pairs.find(
      (pair) =>
        pair.status !== 'withdrawn' &&
        pair.id !== ignorePairId &&
        pair.category === pairCategory &&
        (pair.player_one_id === participant.id || pair.player_two_id === participant.id),
    );
    if (existingPair)
      return `Already paired with ${existingPair.player_one_id === participant.id ? existingPair.player_two_name : existingPair.player_one_name}`;
    const partner = activeParticipants.find((item) => item.id === selectedPartnerId);
    const gender = participant.gender_override || participant.gender;
    const partnerGender = partner?.gender_override || partner?.gender;
    if (pairCategory === 'mixed' && gender && !isGenderEligibleForCategory('mixed', gender))
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pairCategory === 'mixed' &&
      partnerGender &&
      !isGenderEligibleForCategory('mixed', partnerGender)
    )
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pairCategory === 'mixed' &&
      ['male', 'female'].includes(gender || '') &&
      gender === partnerGender
    )
      return 'Mixed doubles requires different known genders';
    return '';
  }
  const pairPlayerOption = (participant: Participant, selectedPartnerId: string): MemberOption => {
    const reason = pairPlayerRestriction(participant, selectedPartnerId);
    const genderLabel = profileGenderLabel(participant.gender, pairCategory);
    return {
      id: participant.id,
      full_name: participant.display_name,
      statusText: [genderLabel, reason].filter(Boolean).join(' · ') || undefined,
      sortPriority: genderLabel ? 1 : 0,
      available: !reason,
      unavailableReason: reason || undefined,
    };
  };
  function replacementRestriction(participant: Participant, target: { pair: Pair; side: 1 | 2 }) {
    const { pair, side } = target;
    if (participant.id === pair.player_one_id || participant.id === pair.player_two_id)
      return 'Already in this pair';
    if (participant.category !== pair.category) return 'Not registered in this category';
    const paired = pairs.find(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === participant.id || other.player_two_id === participant.id),
    );
    if (paired)
      return `Already paired with ${paired.player_one_id === participant.id ? paired.player_two_name : paired.player_one_name}`;
    const gender = participant.gender_override || participant.gender;
    const partnerId = side === 1 ? pair.player_two_id : pair.player_one_id;
    const partner = participants.find((item) => item.id === partnerId);
    const partnerGender = partner?.gender_override || partner?.gender;
    if (pair.category === 'mixed' && gender && !isGenderEligibleForCategory('mixed', gender))
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pair.category === 'mixed' &&
      partnerGender &&
      !isGenderEligibleForCategory('mixed', partnerGender)
    )
      return 'Mixed doubles requires male/female gender when gender is specified';
    if (
      pair.category === 'mixed' &&
      ['male', 'female'].includes(gender || '') &&
      gender === partnerGender
    )
      return 'Mixed doubles requires different known genders';
    return '';
  }

  async function runAction(
    action: () => PromiseLike<{ error: { message: string } | null }>,
    success: string,
  ): Promise<boolean> {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await action();
      if (result.error) throw new Error(result.error.message);
      setMessage(success);
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save tournament changes.');
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function removeParticipant(participant: Participant) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const { error: participantError } = await db
        .from('tournament_participants')
        .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
        .eq('id', participant.id);
      if (participantError) throw new Error(participantError.message);
      const affectedPairs = pairs.filter(
        (pair) =>
          pair.status !== 'withdrawn' &&
          (pair.player_one_id === participant.id || pair.player_two_id === participant.id),
      );
      const pairIds = affectedPairs.map((pair) => pair.id);
      if (pairIds.length) {
        const { error: pairError } = await db
          .from('tournament_pairs')
          .update({ status: 'withdrawn', updated_at: new Date().toISOString() })
          .in('id', pairIds);
        if (pairError) throw new Error(pairError.message);
        const unplayedMatches = matches.filter(
          (match) =>
            match.status !== 'completed' &&
            match.status !== 'cancelled' &&
            (pairIds.includes(match.pair_one_id || '') ||
              pairIds.includes(match.pair_two_id || '')),
        );
        const matchIds = unplayedMatches.map((match) => match.id);
        if (matchIds.length) {
          const { error: cancelError } = await db
            .from('tournament_matches')
            .update({ status: 'cancelled', updated_at: new Date().toISOString() })
            .in('id', matchIds);
          if (cancelError) throw new Error(cancelError.message);
        }
      }
      const historicalOrUpcomingMatches = matches.filter(
        (match) =>
          match.status !== 'completed' &&
          match.status !== 'cancelled' &&
          matchPlayers.some(
            (row) => row.match_id === match.id && row.participant_id === participant.id,
          ),
      );
      if (historicalOrUpcomingMatches.length) {
        const { error: playerError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('participant_id', participant.id)
          .in(
            'match_id',
            historicalOrUpcomingMatches.map((match) => match.id),
          );
        if (playerError) throw new Error(playerError.message);
      }
      setMessage(
        `${participant.display_name} withdrawn. Completed match history has been preserved.`,
      );
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not remove participant.');
    } finally {
      setBusy(false);
    }
  }

  async function assignParticipantTeam(participantId: string, teamId: string | null) {
    await runAction(
      () => db.from('tournament_participants').update({ team_id: teamId }).eq('id', participantId),
      'Team assignment updated.',
    );
  }
  async function addParticipant(e: FormEvent) {
    e.preventDefault();
    const selected = members.find((m) => m.id === memberId);
    if (leagueTournament && !selected) {
      setError('Select an eligible active member for this League event.');
      return;
    }
    if (leagueTournament && selected && leagueMemberEligibility[selected.id] !== true) {
      setError('An active paid membership is required to join a League event.');
      return;
    }
    const targetCategory = isTeam
      ? 'team'
      : leagueTournament
        ? leagueGender === 'male'
          ? 'men'
          : 'women'
        : activeCategory;
    if (
      leagueTournament &&
      selected &&
      !isTeam &&
      hasOpposingGenderProfile(selected.gender, targetCategory)
    ) {
      setError('This player’s profile gender does not match the selected doubles category.');
      return;
    }
    if (!selected && !participantName.trim()) {
      setError('Enter a participant name or select a member.');
      return;
    }
    const registrationGender = selected?.gender || participantGender || null;
    const emailKey = (selected?.email || participantEmail).trim().toLowerCase();
    const oppositeCategory =
      targetCategory === 'men' ? 'women' : targetCategory === 'women' ? 'men' : null;
    const oppositeEntry =
      oppositeCategory &&
      participants.find(
        (participant) =>
          participant.status === 'registered' &&
          participant.category === oppositeCategory &&
          (selected
            ? participant.user_id === selected.id
            : !!emailKey && participant.email?.trim().toLowerCase() === emailKey),
      );
    if (oppositeEntry) {
      setError(
        `This player is already registered for ${oppositeCategory === 'men' ? "men's" : "women's"} doubles and cannot enter both categories.`,
      );
      return;
    }
    if (leagueTournament && selected) {
      if (!leagueId) {
        setError('League configuration could not be found.');
        return;
      }
      const { data: leagueTeam, error: teamError } = await db
        .from('league_teams')
        .select('id')
        .eq('league_id', leagueId)
        .eq('status', 'active')
        .or(`player_one_id.eq.${selected.id},player_two_id.eq.${selected.id}`)
        .maybeSingle();
      if (teamError) {
        setError(teamError.message);
        return;
      }
      if (leagueTeam) {
        const { error: registrationError } = await db.rpc('register_league_event_team', {
          p_event_id: eventId,
          p_member_id: selected.id,
        });
        if (registrationError) {
          setError(registrationError.message);
          return;
        }
        setMessage(`${selected.full_name} and their confirmed League partner registered.`);
        setMemberId('');
        await refresh();
        return;
      }
    }
    await runAction(
      () =>
        db.from('tournament_participants').insert({
          event_id: eventId,
          user_id: selected?.id ?? null,
          category: targetCategory,
          amount_cents: priceCents,
          payment_status: priceCents > 0 ? 'pending' : 'not_required',
          display_name: selected?.full_name || participantName.trim(),
          email: selected?.email || participantEmail.trim() || null,
          phone: participantPhone.trim() || null,
          gender: registrationGender,
        }),
      'Participant added.',
    );
    setMemberId('');
    setParticipantName('');
    setParticipantEmail('');
    setParticipantPhone('');
    setParticipantGender('');
  }
  async function addTeam(e: FormEvent) {
    e.preventDefault();
    if (!teamName.trim()) return;
    if (teamLogo) {
      if (!teamLogo.type.startsWith('image/')) {
        setError('Choose an image file for the team logo.');
        return;
      }
      if (teamLogo.size > 3 * 1024 * 1024) {
        setError('Team logo must be 3 MB or smaller.');
        return;
      }
    }
    const created = await runAction(async () => {
      let logoUrl: string | null = null;
      if (teamLogo) {
        const extension =
          teamLogo.name
            .split('.')
            .pop()
            ?.toLowerCase()
            .replace(/[^a-z0-9]/g, '') || 'png';
        const path = `${eventId}/team-logo-${Date.now()}.${extension}`;
        const { error: uploadError } = await db.storage
          .from('tournament-team-logos')
          .upload(path, teamLogo, { contentType: teamLogo.type });
        if (uploadError) return { error: uploadError };
        logoUrl = db.storage.from('tournament-team-logos').getPublicUrl(path).data.publicUrl;
      }
      return db.rpc('admin_create_tournament_team', {
        p_event_id: eventId,
        p_name: teamName.trim(),
        p_color: teamColor.trim(),
        p_logo_url: logoUrl,
        p_captain_user_id: captain || null,
      });
    }, 'Team created.');
    if (!created) return;
    setTeamName('');
    setTeamColor('');
    setTeamLogo(null);
    setCaptain('');
  }
  async function createPair(e: FormEvent) {
    e.preventDefault();
    if (!pairOne || !pairTwo || pairOne === pairTwo) return;
    const a = participants.find((p) => p.id === pairOne);
    const b = participants.find((p) => p.id === pairTwo);
    const genderOf = (p?: Participant) => p?.gender_override || p?.gender;
    if (a?.category !== pairCategory || b?.category !== pairCategory) {
      setError(
        'Each participant must have a registration in the selected category before pairing.',
      );
      return;
    }
    if (
      pairCategory === 'mixed' &&
      [genderOf(a), genderOf(b)].some(
        (gender) => !!gender && !isGenderEligibleForCategory('mixed', gender),
      )
    ) {
      setError('Mixed doubles requires male/female gender when gender is specified.');
      return;
    }
    if (
      pairCategory === 'mixed' &&
      genderOf(a) &&
      genderOf(b) &&
      ['male', 'female'].includes((genderOf(a) || '').trim().toLowerCase()) &&
      (genderOf(a) || '').trim().toLowerCase() === (genderOf(b) || '').trim().toLowerCase()
    ) {
      setError(
        'Mixed doubles requires one male and one female player when both gender fields are known.',
      );
      return;
    }
    let pairCreated = false;
    const created = await runAction(async () => {
      const { error } = await db.rpc('admin_create_tournament_pair', {
        p_event_id: eventId,
        p_category: pairCategory,
        p_one: pairOne,
        p_two: pairTwo,
      });
      if (error) return { error };
      pairCreated = true;
      const response = await fetch('/api/events/partner-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ participantIds: [pairOne, pairTwo] }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok)
        return {
          error: {
            message: `Pair created, but confirmation invitations could not be sent: ${result.error || 'retry the invitations.'}`,
          },
        };
      return { error: null };
    }, 'Doubles pair created.');
    if (created || pairCreated) {
      setPairOne('');
      setPairTwo('');
    }
    if (pairCreated && !created) await refresh();
  }
  async function replacePairPlayer(pair: Pair, side: 1 | 2): Promise<boolean> {
    const replacementId = replacementParticipantId;
    const oldId = side === 1 ? pair.player_one_id : pair.player_two_id;
    if (!replacementId || replacementId === oldId) {
      setError('Select a different replacement participant.');
      return false;
    }
    if (replacementId === (side === 1 ? pair.player_two_id : pair.player_one_id)) {
      setError('The same participant cannot occupy both positions in a pair.');
      return false;
    }
    const existing = pairs.some(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === replacementId || other.player_two_id === replacementId),
    );
    const oldStillAssigned = pairs.some(
      (other) =>
        other.status !== 'withdrawn' &&
        other.id !== pair.id &&
        other.category === pair.category &&
        (other.player_one_id === oldId || other.player_two_id === oldId),
    );
    if (oldStillAssigned) {
      setError(
        'This player is assigned to another pair in the same category; update that draw before replacing them.',
      );
      return false;
    }
    if (existing) {
      setError('This participant is already assigned to another pair in this category.');
      return false;
    }
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (leagueTournament) {
        const { error: replacementError } = await db.rpc('replace_league_team_member', {
          p_event_id: eventId,
          p_pair_id: pair.id,
          p_side: side,
          p_replacement_participant_id: replacementId,
        });
        if (replacementError) throw new Error(replacementError.message);
        setMessage(
          'League team updated. Future event pairs use the replacement; completed match records keep the players who played.',
        );
        await refresh();
        return true;
      }
      const changes =
        side === 1 ? { player_one_id: replacementId } : { player_two_id: replacementId };
      const { error: pairError } = await db
        .from('tournament_pairs')
        .update(changes)
        .eq('id', pair.id);
      if (pairError) throw new Error(pairError.message);
      const { error: participantError } = await db
        .from('tournament_participants')
        .update({
          status: 'replaced',
          replaced_by: replacementId,
          updated_at: new Date().toISOString(),
        })
        .eq('id', oldId);
      if (participantError) throw new Error(participantError.message);
      const { error: confirmationError } = await db.rpc('admin_require_pair_confirmation', {
        p_pair_id: pair.id,
      });
      if (confirmationError) throw new Error(confirmationError.message);
      const invitationResponse = await fetch('/api/events/partner-invitations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          participantIds: [
            changes.player_one_id || pair.player_one_id,
            changes.player_two_id || pair.player_two_id,
          ],
        }),
      });
      if (!invitationResponse.ok)
        throw new Error(
          'Pair updated, but a confirmation invitation could not be sent. Retry the invitation from the event registration page.',
        );
      for (const match of matches.filter(
        (m) =>
          (m.pair_one_id === pair.id || m.pair_two_id === pair.id) &&
          m.status !== 'completed' &&
          m.status !== 'cancelled',
      )) {
        const matchSide = match.pair_one_id === pair.id ? 1 : 2;
        const { error: deleteError } = await db
          .from('tournament_match_players')
          .delete()
          .eq('match_id', match.id)
          .eq('side', matchSide);
        if (deleteError) throw new Error(deleteError.message);
        const updatedPair = { ...pair, ...changes };
        const { error: insertError } = await db.from('tournament_match_players').insert([
          {
            match_id: match.id,
            participant_id: updatedPair.player_one_id,
            side: matchSide,
            team_id: null,
          },
          {
            match_id: match.id,
            participant_id: updatedPair.player_two_id,
            side: matchSide,
            team_id: null,
          },
        ]);
        if (insertError) throw new Error(insertError.message);
      }
      setMessage(
        'Pair replacement saved. Completed matches retain the players who actually played; future matches use the replacement.',
      );
      await refresh();
      return true;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not replace participant.');
      await refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    activeParticipants,
    hasOpposingGenderProfile,
    profileGenderLabel,
    availablePairPlayers,
    pairPlayerRestriction,
    pairPlayerOption,
    replacementRestriction,
    runAction,
    removeParticipant,
    assignParticipantTeam,
    addParticipant,
    addTeam,
    createPair,
    replacePairPlayer,
  };
}
