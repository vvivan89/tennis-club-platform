import { Button } from '@/components/ui/button';
import { TennisLoader } from '@/components/tennis-loader';
import { SearchableMemberSelect, type MemberOption } from '@/components/searchable-member-select';
import type { Pair, Participant } from '@/components/tournament-management-types';

type ReplaceTarget = { pair: Pair; side: 1 | 2 };

type Props = {
  target: ReplaceTarget | null;
  participants: Participant[];
  selectedParticipantId: string;
  setSelectedParticipantId: (id: string) => void;
  busy: boolean;
  profileGenderLabel: (gender: string | null | undefined, category: string) => string | undefined;
  hasOpposingGenderProfile: (gender: string | null | undefined, category: string) => boolean;
  replacementRestriction: (participant: Participant, target: ReplaceTarget) => string | null;
  onCancel: () => void;
  onReplace: (target: ReplaceTarget) => Promise<boolean>;
};

export function TournamentReplacePairDialog({
  target,
  participants,
  selectedParticipantId,
  setSelectedParticipantId,
  busy,
  profileGenderLabel,
  hasOpposingGenderProfile,
  replacementRestriction,
  onCancel,
  onReplace,
}: Props) {
  if (!target) return null;

  const playerName = target.side === 1 ? target.pair.player_one_name : target.pair.player_two_name;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="replace-pair-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4"
    >
      <div className="w-full max-w-md space-y-4 rounded-xl border border-border bg-background p-5">
        <h3 id="replace-pair-title" className="text-lg font-semibold">
          Replace {playerName}
        </h3>
        <p className="text-sm text-muted-foreground">
          Completed matches retain the players who actually played. Future matches use the
          replacement.
        </p>
        <label className="block text-sm">
          Replacement player
          <SearchableMemberSelect
            value={selectedParticipantId}
            onChange={setSelectedParticipantId}
            placeholder="Choose replacement"
            options={[...participants]
              .sort(
                (a, b) =>
                  Number(!!replacementRestriction(a, target)) -
                    Number(!!replacementRestriction(b, target)) ||
                  Number(hasOpposingGenderProfile(a.gender, target.pair.category)) -
                    Number(hasOpposingGenderProfile(b.gender, target.pair.category)) ||
                  a.display_name.localeCompare(b.display_name),
              )
              .map((participant): MemberOption => {
                const reason = replacementRestriction(participant, target);
                const genderLabel = profileGenderLabel(participant.gender, target.pair.category);
                const statusText = [genderLabel, reason].filter(Boolean).join(' · ') || undefined;
                return {
                  id: participant.id,
                  full_name: participant.display_name,
                  statusText,
                  sortPriority: genderLabel ? 1 : 0,
                  available: !reason,
                  unavailableReason: reason || undefined,
                };
              })}
          />
        </label>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void onReplace(target)}>
            {busy ? <TennisLoader label="Replacing player" compact /> : 'Replace player'}
          </Button>
        </div>
      </div>
    </div>
  );
}
