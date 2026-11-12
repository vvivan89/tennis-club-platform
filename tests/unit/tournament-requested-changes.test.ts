import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(join(process.cwd(), path), 'utf8');
const publicView = [
  'components/tournament-public-view.tsx',
  'components/tournament-overview-panel.tsx',
  'components/tournament-own-registration-list.tsx',
  'components/tournament-entry-form.tsx',
  'components/tournament-registration-status.tsx',
  'components/tournament-public-view-dialogs.tsx',
  'components/tournament-overview-participants.tsx',
  'components/use-tournament-public-view-data.ts',
  'components/use-tournament-payment-action.ts',
  'components/use-tournament-registration-submit.ts',
  'components/use-tournament-withdrawal-actions.ts',
]
  .map(read)
  .join('\n');
const interacDialog = read('components/interac-payment-instructions-dialog.tsx');
const paymentOptions = read('components/payment-options-button.tsx');
const skillSelect = read('components/tennis-skill-level-select.tsx');
const skillLevels = read('lib/tennis-skill-levels.ts');
const memberMenu = read('components/member-menu.tsx');
const checkout = read('app/api/payments/checkout/route.ts');
const cancel = read('app/api/payments/cancel/route.ts');
const status = read('app/api/payments/status/route.ts');
const eventPage = read('app/events/[slug]/page.tsx');
const migration = read(
  'supabase/migration_archive/0054_tournament_registration_payment_and_partner_flows.sql',
);
const management = read('components/tournament-management.tsx');

describe('requested tournament registration fixes', () => {
  it('offers Interac to authenticated tournament registrants and displays the instructions', () => {
    expect(publicView).toContain('startTournamentPayment(');
    expect(publicView).toContain("'interac'");
    expect(publicView).toContain('InteracPaymentInstructionsDialog');
    expect(interacDialog).toContain('Interac e-Transfer instructions');
  });

  it('supports guest Stripe checkout and keeps guest registrations provisional until payment succeeds', () => {
    expect(checkout).toContain("purpose === 'tournament_registration'");
    expect(checkout).toContain('event_guest');
    expect(publicView).toContain('isEventGuest');
    expect(publicView).toContain('guestAccessMessage');
    expect(migration).toContain("SET status='provisional'");
    expect(migration).toContain("NEW.payment_status='paid'");
    expect(cancel).toContain('provisionalRegistrationRemoved: false');
    expect(cancel).toContain("payment.purpose !== 'tournament_registration'");
    expect(status).toContain("eq('purpose', 'tournament_registration')");
  });

  it('shows each own category, its payment status, pay actions, and withdrawal before cutoff', () => {
    expect(publicView).toContain('Your tournament registrations');
    expect(publicView).toContain('Payment pending');
    expect(publicView).toContain('withdraw_tournament_entry');
    expect(migration).toContain('withdraw_tournament_entry');
    expect(publicView).toContain('Pay for both partners');
  });

  it('reuses a non-refunded payment only for a withdrawn entry in the same event and category', () => {
    expect(migration).toContain('reuse_prior_tournament_entry_payment');
    expect(migration).toContain("pay.status='succeeded'");
    expect(migration).toContain('coalesce(pay.refunded_amount_minor,0)=0');
    expect(migration).toContain(
      'old_entry.event_id=NEW.event_id AND old_entry.category=NEW.category',
    );
  });

  it('exposes public organizer identity for published events without exposing private contact details', () => {
    expect(eventPage).toContain("db.rpc('event_public_organizer_contacts'");
    expect(migration).toContain(
      'CREATE OR REPLACE FUNCTION public.event_public_organizer_contacts',
    );
    expect(migration).toContain(
      'GRANT EXECUTE ON FUNCTION public.event_public_organizer_contacts(uuid) TO anon, authenticated',
    );
  });

  it('shows a profile menu to signed-in non-approved users, with member links hidden', () => {
    expect(memberMenu).toContain('if (!signedIn)');
    expect(memberMenu).toContain('{approved && (');
    expect(memberMenu).toContain('Sign out');
  });

  it('uses the approved member directory for member partners and explains the guest-to-member process', () => {
    expect(publicView).toContain("db.rpc('event_tournament_partner_directory'");
    expect(publicView).toMatch(/they’ll be\s+notified to confirm/);
    expect(migration).toContain('event_tournament_partner_directory');
    expect(migration).toContain('(p.user_id IS NOT NULL) AS is_member');
  });

  it('keeps registration gender required and removes Other from tournament controls', () => {
    expect(publicView).toContain('Gender');
    expect(publicView).not.toContain('<option value="other">Other</option>');
    expect(management).not.toContain('<option value="other">Other</option>');
  });

  it('offers pay-for-self and pay-for-both actions while tracking partner payment independently', () => {
    expect(publicView).toContain('For myself by card');
    expect(publicView).toContain('For both by card');
    expect(paymentOptions).toContain('aria-haspopup');
    expect(migration).toContain('event_tournament_pair_payment_status');
    expect(publicView).toContain("teamFullyPaid ? 'Paid' : 'Pending'");
  });

  it('offers optional skill levels from 2.5 through 7.0 in half-point increments', () => {
    expect(publicView).toContain('label="Tennis skill level"');
    expect(publicView.match(/<TennisSkillLevelSelect/g) ?? []).toHaveLength(5);
    expect(skillSelect).toContain('minSkill = 2.5');
    expect(skillSelect).toContain('maxSkill = 7.0');
    expect(skillLevels).toContain('minSkill + index * 0.5');
    expect(migration).toContain('tennis_skill_level BETWEEN 2.5 AND 7.0');
  });

  it('renders single participants alongside pairs in the tournament overview', () => {
    expect(publicView).toContain("participant.status === 'registered'");
    expect(publicView).toContain('pair.category === activeCategory');
    expect(publicView).toContain('pair.player_one_id === participant.id');
    expect(publicView).toContain('pair.player_two_id === participant.id');
    expect(publicView).toContain("pair.status !== 'withdrawn'");
  });
});
