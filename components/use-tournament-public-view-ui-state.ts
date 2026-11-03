import { useEffect, useState } from 'react';
import { useTimedFeedback } from '@/hooks/use-timed-feedback';
import type { InteracPaymentNotice } from '@/components/interac-payment-instructions-dialog';
import type {
  TournamentPartnerConfirmation as TournamentPartnerConfirmationData,
  TournamentPublicViewProps,
} from '@/components/tournament-public-view-types';

type UiStateArgs = {
  resultsOnly: boolean;
  startsAt: string;
  leagueTournament: boolean;
  config: TournamentPublicViewProps['config'];
  format: string | null;
  currentUserName: string;
  currentUserEmail: string | null;
  currentUserPhone: string;
  currentUserGender: string | null;
  currentUserSkillLevel: string | null;
  hasRules: boolean;
};

export function useTournamentPublicViewUiState({
  resultsOnly,
  startsAt,
  leagueTournament,
  config,
  format,
  currentUserName,
  currentUserEmail,
  currentUserPhone,
  currentUserGender,
  currentUserSkillLevel,
  hasRules,
}: UiStateArgs) {
  const [tab, setTab] = useState<
    'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit'
  >(resultsOnly ? 'competition' : 'overview');
  const [leagueCourtView, setLeagueCourtView] = useState<'courts' | 'list'>('list');
  const [leagueScoreMatchId, setLeagueScoreMatchId] = useState('');
  const [leagueScoreTeamSide, setLeagueScoreTeamSide] = useState<'1' | '2'>('1');
  const [leagueScoreDrafts, setLeagueScoreDrafts] = useState<
    Record<string, { one: string; two: string }>
  >({});
  const [savingLeagueScore, setSavingLeagueScore] = useState<string | null>(null);
  const [leagueEventStarted, setLeagueEventStarted] = useState(
    () => Date.now() >= new Date(startsAt).getTime(),
  );
  const [leagueScoresOpen, setLeagueScoresOpen] = useState(() => {
    const elapsed = Date.now() - new Date(startsAt).getTime();
    return elapsed >= 0 && elapsed <= 2 * 24 * 60 * 60 * 1000;
  });
  useEffect(() => {
    const starts = new Date(startsAt).getTime();
    const closes = starts + 2 * 24 * 60 * 60 * 1000;
    const now = Date.now();
    setLeagueEventStarted(now >= starts);
    const startTimer =
      now < starts
        ? window.setTimeout(
            () => {
              setLeagueEventStarted(true);
              setLeagueScoresOpen(true);
            },
            starts - now + 25,
          )
        : undefined;
    const closeTimer =
      now < closes
        ? window.setTimeout(() => setLeagueScoresOpen(false), closes - now + 25)
        : undefined;
    if (now > closes) setLeagueScoresOpen(false);
    return () => {
      if (startTimer) window.clearTimeout(startTimer);
      if (closeTimer) window.clearTimeout(closeTimer);
    };
  }, [startsAt]);
  const [tabInitialized, setTabInitialized] = useState(false);
  const [competitionMatchGrouping, setCompetitionMatchGrouping] = useState<'group' | 'round'>(
    'group',
  );
  useEffect(() => {
    if (resultsOnly) {
      setTab('competition');
      setTabInitialized(true);
      return;
    }
    const readTabFromUrl = () => {
      const requested = new URLSearchParams(window.location.search).get('tab');
      if (
        ['overview', 'rules', 'competition', 'participants', 'matches', 'audit'].includes(
          requested || '',
        ) &&
        !(leagueTournament && ['matches', 'audit'].includes(requested || '')) &&
        (requested !== 'rules' || hasRules)
      ) {
        setTab(
          requested as 'overview' | 'rules' | 'competition' | 'participants' | 'matches' | 'audit',
        );
      }
      setTabInitialized(true);
    };
    readTabFromUrl();
    window.addEventListener('popstate', readTabFromUrl);
    return () => window.removeEventListener('popstate', readTabFromUrl);
  }, [hasRules, resultsOnly, leagueTournament]);
  useEffect(() => {
    window.dispatchEvent(new CustomEvent('pctc-tournament-tab-change', { detail: { tab } }));
  }, [tab]);
  useEffect(() => {
    if (!tabInitialized) return;
    const url = new URL(window.location.href);
    if (tab === 'overview') url.searchParams.delete('tab');
    else url.searchParams.set('tab', tab);
    window.history.replaceState({}, '', url.toString());
  }, [tab, tabInitialized]);
  const [activeCategory, setActiveCategory] = useState<string>(
    (config?.categories ?? ['mixed', 'men', 'women'])[0] ?? 'mixed',
  );
  const [registrationCategory, setRegistrationCategory] = useState(
    format === 'team' ? 'team' : ((config?.categories ?? ['mixed'])[0] ?? 'mixed'),
  );
  const [registrationMode, setRegistrationMode] = useState<'individual' | 'pair'>(
    config?.registration_mode === 'doubles' ? 'pair' : 'individual',
  );
  const [partnerChoice, setPartnerChoice] = useState('');
  const [entrantName, setEntrantName] = useState(currentUserName);
  const [entrantEmail, setEntrantEmail] = useState(currentUserEmail || '');
  const [entrantPhone, setEntrantPhone] = useState(currentUserPhone);
  const [entrantGender, setEntrantGender] = useState(currentUserGender || '');
  const [entrantSkillLevel, setEntrantSkillLevel] = useState(currentUserSkillLevel || '');
  const [guestAccessEmail, setGuestAccessEmail] = useState('');
  const [guestAccessVisible, setGuestAccessVisible] = useState(false);
  const [guestAccessMessage, setGuestAccessMessage] = useState('');
  const [guestAccessError, setGuestAccessError] = useState('');
  const [guestAccessBusy, setGuestAccessBusy] = useState(false);
  const [partnerConfirmation, setPartnerConfirmation] =
    useState<TournamentPartnerConfirmationData | null>(null);
  const [partnerConfirmationError, setPartnerConfirmationError] = useState('');
  const [partnerConfirmationBusy, setPartnerConfirmationBusy] = useState(false);
  const [partnerEditTarget, setPartnerEditTarget] = useState<string | null>(null);
  const [partnerEditName, setPartnerEditName] = useState('');
  const [partnerEditEmail, setPartnerEditEmail] = useState('');
  const [partnerEditPhone, setPartnerEditPhone] = useState('');
  const [partnerEditGender, setPartnerEditGender] = useState('');
  const [partnerEditSkill, setPartnerEditSkill] = useState('');
  const [partnerEditBusy, setPartnerEditBusy] = useState(false);
  const [ownEditTarget, setOwnEditTarget] = useState<string | null>(null);
  const [ownEditName, setOwnEditName] = useState('');
  const [ownEditPhone, setOwnEditPhone] = useState('');
  const [ownEditGender, setOwnEditGender] = useState('');
  const [ownEditSkill, setOwnEditSkill] = useState('');
  const [ownEditBusy, setOwnEditBusy] = useState(false);
  const [withdrawTarget, setWithdrawTarget] = useState<string | null>(null);
  const [withdrawBusy, setWithdrawBusy] = useState(false);
  const [withdrawError, setWithdrawError] = useState('');
  const [partnerName, setPartnerName] = useState('');
  const [partnerEmail, setPartnerEmail] = useState('');
  const [partnerPhone, setPartnerPhone] = useState('');
  const [partnerGender, setPartnerGender] = useState('');
  const [partnerSkillLevel, setPartnerSkillLevel] = useState('');
  const [registrationRefresh, setRegistrationRefresh] = useState(0);
  const {
    busy: registrationBusy,
    setBusy: setRegistrationBusy,
    error: registrationError,
    setError: setRegistrationError,
    message: registrationMessage,
    setMessage: setRegistrationMessage,
  } = useTimedFeedback();
  const [paymentParticipantIds, setPaymentParticipantIds] = useState<string[]>([]);
  const [newEntryParticipantId, setNewEntryParticipantId] = useState<string | null>(null);
  const [newPartnerParticipantId, setNewPartnerParticipantId] = useState<string | null>(null);
  const [paymentBusy, setPaymentBusy] = useState(false);
  const [paymentBusyKey, setPaymentBusyKey] = useState<string | null>(null);
  const [leagueWithdrawTarget, setLeagueWithdrawTarget] = useState<{
    participantId: string;
    partnerParticipantId: string;
  } | null>(null);
  const [leagueWithdrawBusy, setLeagueWithdrawBusy] = useState(false);
  const [leagueWithdrawError, setLeagueWithdrawError] = useState('');
  const [interacNotice, setInteracNotice] = useState<InteracPaymentNotice | null>(null);
  return {
    tab,
    setTab,
    leagueCourtView,
    setLeagueCourtView,
    leagueScoreMatchId,
    setLeagueScoreMatchId,
    leagueScoreTeamSide,
    setLeagueScoreTeamSide,
    leagueScoreDrafts,
    setLeagueScoreDrafts,
    savingLeagueScore,
    setSavingLeagueScore,
    leagueEventStarted,
    leagueScoresOpen,
    competitionMatchGrouping,
    setCompetitionMatchGrouping,
    activeCategory,
    setActiveCategory,
    registrationCategory,
    setRegistrationCategory,
    registrationMode,
    setRegistrationMode,
    partnerChoice,
    setPartnerChoice,
    entrantName,
    setEntrantName,
    entrantEmail,
    setEntrantEmail,
    entrantPhone,
    setEntrantPhone,
    entrantGender,
    setEntrantGender,
    entrantSkillLevel,
    setEntrantSkillLevel,
    guestAccessEmail,
    setGuestAccessEmail,
    guestAccessVisible,
    setGuestAccessVisible,
    guestAccessMessage,
    setGuestAccessMessage,
    guestAccessError,
    setGuestAccessError,
    guestAccessBusy,
    setGuestAccessBusy,
    partnerConfirmation,
    setPartnerConfirmation,
    partnerConfirmationError,
    setPartnerConfirmationError,
    partnerConfirmationBusy,
    setPartnerConfirmationBusy,
    partnerEditTarget,
    setPartnerEditTarget,
    partnerEditName,
    setPartnerEditName,
    partnerEditEmail,
    setPartnerEditEmail,
    partnerEditPhone,
    setPartnerEditPhone,
    partnerEditGender,
    setPartnerEditGender,
    partnerEditSkill,
    setPartnerEditSkill,
    partnerEditBusy,
    setPartnerEditBusy,
    ownEditTarget,
    setOwnEditTarget,
    ownEditName,
    setOwnEditName,
    ownEditPhone,
    setOwnEditPhone,
    ownEditGender,
    setOwnEditGender,
    ownEditSkill,
    setOwnEditSkill,
    ownEditBusy,
    setOwnEditBusy,
    withdrawTarget,
    setWithdrawTarget,
    withdrawBusy,
    setWithdrawBusy,
    withdrawError,
    setWithdrawError,
    partnerName,
    setPartnerName,
    partnerEmail,
    setPartnerEmail,
    partnerPhone,
    setPartnerPhone,
    partnerGender,
    setPartnerGender,
    partnerSkillLevel,
    setPartnerSkillLevel,
    registrationRefresh,
    setRegistrationRefresh,
    registrationBusy,
    setRegistrationBusy,
    registrationError,
    setRegistrationError,
    registrationMessage,
    setRegistrationMessage,
    paymentParticipantIds,
    setPaymentParticipantIds,
    newEntryParticipantId,
    setNewEntryParticipantId,
    newPartnerParticipantId,
    setNewPartnerParticipantId,
    paymentBusy,
    setPaymentBusy,
    paymentBusyKey,
    setPaymentBusyKey,
    leagueWithdrawTarget,
    setLeagueWithdrawTarget,
    leagueWithdrawBusy,
    setLeagueWithdrawBusy,
    leagueWithdrawError,
    setLeagueWithdrawError,
    interacNotice,
    setInteracNotice,
  };
}
