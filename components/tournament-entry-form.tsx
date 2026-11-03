'use client';

import type { Dispatch, FormEventHandler, SetStateAction } from 'react';
import { Input } from '@/components/ui/input';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import { PartnerSkillLevelSelect } from '@/components/partner-skill-level-select';
import { categoryLabel } from '@/components/tournament-public-view-format';
import { isGenderEligibleForCategory } from '@/lib/tournament-config';
import type { Participant, PartnerMember } from '@/components/tournament-public-view-types';

export type TournamentEntryFormProps = {
  submitRegistration: FormEventHandler<HTMLFormElement>;
  leagueTournament: boolean;
  registrationCategory: string;
  availableCategories: string[];
  setRegistrationCategory: Dispatch<SetStateAction<string>>;
  setPartnerChoice: Dispatch<SetStateAction<string>>;
  registrationModeConfig: string;
  registrationMode: 'individual' | 'pair';
  setRegistrationMode: Dispatch<SetStateAction<'individual' | 'pair'>>;
  isEventGuest: boolean;
  entrantName: string;
  setEntrantName: Dispatch<SetStateAction<string>>;
  entrantEmail: string;
  entrantPhone: string;
  setEntrantPhone: Dispatch<SetStateAction<string>>;
  entrantSkillLevel: string;
  setEntrantSkillLevel: Dispatch<SetStateAction<string>>;
  entrantGender: string;
  setEntrantGender: Dispatch<SetStateAction<string>>;
  format: string | null;
  effectiveRegistrationMode: 'individual' | 'pair';
  currentUserId: string | null;
  partnerChoice: string;
  partnerMembers: PartnerMember[];
  registrationGender: string | null;
  allowNonMemberRegistration: boolean;
  partnerName: string;
  setPartnerName: Dispatch<SetStateAction<string>>;
  partnerEmail: string;
  setPartnerEmail: Dispatch<SetStateAction<string>>;
  partnerPhone: string;
  setPartnerPhone: Dispatch<SetStateAction<string>>;
  partnerSkillLevel: string;
  setPartnerSkillLevel: Dispatch<SetStateAction<string>>;
  partnerGender: string;
  setPartnerGender: Dispatch<SetStateAction<string>>;
  participants: Participant[];
  registrationBusy: boolean;
};

export function TournamentEntryForm(props: TournamentEntryFormProps) {
  const {
    submitRegistration,
    leagueTournament,
    registrationCategory,
    availableCategories,
    setRegistrationCategory,
    setPartnerChoice,
    registrationModeConfig,
    registrationMode,
    setRegistrationMode,
    isEventGuest,
    entrantName,
    setEntrantName,
    entrantEmail,
    entrantPhone,
    setEntrantPhone,
    entrantSkillLevel,
    setEntrantSkillLevel,
    entrantGender,
    setEntrantGender,
    format,
    effectiveRegistrationMode,
    currentUserId,
    partnerChoice,
    partnerMembers,
    registrationGender,
    allowNonMemberRegistration,
    partnerName,
    setPartnerName,
    partnerEmail,
    setPartnerEmail,
    partnerPhone,
    setPartnerPhone,
    partnerSkillLevel,
    setPartnerSkillLevel,
    partnerGender,
    setPartnerGender,
    participants,
    registrationBusy,
  } = props;
  return (
    <form onSubmit={submitRegistration} className="mt-4 space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        {!leagueTournament && (
          <label className="text-sm">
            Category
            <select
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
              value={registrationCategory}
              onChange={(e) => {
                setRegistrationCategory(e.target.value);
                setPartnerChoice('');
              }}
              required
            >
              {availableCategories.map((category: string) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          </label>
        )}
        {(!leagueTournament || isEventGuest) &&
          format === 'doubles' &&
          registrationModeConfig === 'both' && (
            <label className="text-sm">
              Registration type
              <select
                className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                value={registrationMode}
                onChange={(e) => {
                  setRegistrationMode(e.target.value as 'individual' | 'pair');
                  setPartnerChoice('');
                }}
              >
                <option value="individual">
                  Register individually; organizer can pair me later
                </option>
                <option value="pair">Register with a partner</option>
              </select>
            </label>
          )}
      </div>
      {isEventGuest && (
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            Your full name
            <Input value={entrantName} onChange={(e) => setEntrantName(e.target.value)} required />
          </label>
          <label className="text-sm">
            Your email
            <Input
              type="email"
              value={entrantEmail}
              readOnly
              aria-describedby="verified-event-email"
            />
            <span id="verified-event-email" className="sr-only">
              Verified sign-in email
            </span>
          </label>
          <label className="text-sm">
            Phone (optional)
            <Input value={entrantPhone} onChange={(e) => setEntrantPhone(e.target.value)} />
          </label>
          <label className="text-sm">
            Tennis skill level (optional)
            <select
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
              value={entrantSkillLevel}
              onChange={(e) => setEntrantSkillLevel(e.target.value)}
            >
              <option value="">Not specified</option>
              {Array.from({ length: 10 }, (_, index) => (2.5 + index * 0.5).toFixed(1)).map(
                (level) => (
                  <option key={level} value={level}>
                    {level}
                  </option>
                ),
              )}
            </select>
          </label>
          <label className="text-sm">
            Gender (optional)
            <select
              className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
              value={entrantGender}
              onChange={(e) => setEntrantGender(e.target.value)}
            >
              <option value="">Not specified</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </label>
        </div>
      )}
      {format === 'doubles' && effectiveRegistrationMode === 'pair' && (
        <div className="space-y-3 rounded-md bg-secondary/30 p-3">
          {!currentUserId && (
            <p className="text-sm text-muted-foreground">
              Enter your partner’s name and email. If the email belongs to a member, they’ll be
              notified to confirm; otherwise, they’ll receive a one-time sign-in link. Your team can
              pay after they confirm.
            </p>
          )}
          {currentUserId && !isEventGuest && (
            <label className="block text-sm">
              Partner
              <SearchableMemberSelect
                value={partnerChoice}
                onChange={setPartnerChoice}
                placeholder="Search members by name"
                options={
                  [
                    ...partnerMembers.map((member) => ({
                      id: member.id,
                      full_name: member.full_name,
                      statusText: member.gender ? `Gender: ${member.gender}` : 'Club member',
                      available:
                        isGenderEligibleForCategory(registrationCategory, member.gender) &&
                        !(
                          registrationCategory === 'mixed' &&
                          ['male', 'female'].includes(registrationGender || '') &&
                          ['male', 'female'].includes(member.gender || '') &&
                          registrationGender === member.gender
                        ),
                      unavailableReason: !isGenderEligibleForCategory(
                        registrationCategory,
                        member.gender,
                      )
                        ? `Not eligible for ${categoryLabel(registrationCategory)}`
                        : 'Mixed doubles requires different known genders',
                    })),
                    ...(allowNonMemberRegistration
                      ? [
                          {
                            id: 'new',
                            full_name: 'Add a partner without an account',
                            statusText: 'Enter their contact details below',
                          },
                        ]
                      : []),
                  ] as MemberOption[]
                }
              />
            </label>
          )}
          {(isEventGuest || !currentUserId || partnerChoice === 'new') && (
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="text-sm">
                Partner name
                <Input
                  value={partnerName}
                  onChange={(e) => setPartnerName(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Partner email
                <Input
                  type="email"
                  value={partnerEmail}
                  onChange={(e) => setPartnerEmail(e.target.value)}
                  required
                />
              </label>
              <label className="text-sm">
                Partner phone (optional)
                <Input value={partnerPhone} onChange={(e) => setPartnerPhone(e.target.value)} />
              </label>
              <PartnerSkillLevelSelect value={partnerSkillLevel} onChange={setPartnerSkillLevel} />
              <label className="text-sm">
                Partner gender (optional)
                <select
                  className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-3"
                  value={partnerGender}
                  onChange={(e) => setPartnerGender(e.target.value)}
                >
                  <option value="">Not specified</option>
                  <option value="male">Male</option>
                  <option value="female">Female</option>
                </select>
              </label>
            </div>
          )}
          {!currentUserId &&
            partnerChoice &&
            partnerChoice !== 'new' &&
            participants.some(
              (participant) => participant.id === partnerChoice && !participant.is_member,
            ) && (
              <PartnerSkillLevelSelect
                className="block text-sm"
                value={partnerSkillLevel}
                onChange={setPartnerSkillLevel}
              />
            )}
        </div>
      )}
      {(!leagueTournament || isEventGuest) && (
        <button
          type="submit"
          disabled={registrationBusy}
          className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
        >
          {registrationBusy ? 'Registering…' : 'Register for tournament'}
        </button>
      )}
    </form>
  );
}
