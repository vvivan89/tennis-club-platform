import { Input } from '@/components/ui/input';
import type { TournamentConfig, TournamentRegistrationDiscountRule } from '@/lib/tournament-config';

type DiscountKey = 'second_category' | 'pair_registration' | 'approved_member';

const discountLabels: Record<DiscountKey, { title: string; description: string }> = {
  second_category: {
    title: 'Second category',
    description: 'Discount a player’s second registered category in this tournament.',
  },
  pair_registration: {
    title: 'Pair registration',
    description:
      'Discount each newly created player entry when the player registers with a partner.',
  },
  approved_member: {
    title: 'Approved club member',
    description:
      'Discount entries belonging to approved club accounts. Unapproved and event-only accounts do not qualify.',
  },
};

const defaultRule: TournamentRegistrationDiscountRule = {
  enabled: false,
  type: 'percent',
  percent: 10,
  amount_cents: 1000,
};

export function TournamentRegistrationDiscountConfigurator({
  config,
  format,
  onChange,
}: {
  config: TournamentConfig;
  format: string | null;
  onChange: (next: TournamentConfig) => void;
}) {
  const discounts = config.registration_discounts ?? {};
  const visibleKeys: DiscountKey[] =
    format === 'doubles'
      ? ['second_category', 'pair_registration', 'approved_member']
      : format === 'singles'
        ? ['second_category', 'approved_member']
        : ['approved_member'];

  function updateRule(key: DiscountKey, rule: TournamentRegistrationDiscountRule) {
    onChange({
      ...config,
      registration_discounts: { ...discounts, [key]: rule },
    });
  }

  return (
    <section className="space-y-4 rounded-xl border border-border p-5">
      <div>
        <h3 className="text-base font-semibold">Registration discounts</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Discounts are calculated for each player’s entry and verified by the database. The
          tournament’s listed price remains the base price.
        </p>
      </div>
      <div className="space-y-3">
        {visibleKeys.map((key) => {
          const rule = { ...defaultRule, ...discounts[key] };
          const label = discountLabels[key];
          return (
            <div
              key={key}
              className="grid gap-3 rounded-lg border border-border p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center"
            >
              <label className="flex items-start gap-3 text-sm">
                <input
                  type="checkbox"
                  checked={rule.enabled === true}
                  onChange={(event) => updateRule(key, { ...rule, enabled: event.target.checked })}
                  className="mt-1 h-4 w-4"
                />
                <span>
                  <span className="block font-medium">{label.title}</span>
                  <span className="mt-1 block text-xs text-muted-foreground">
                    {label.description}
                  </span>
                </span>
              </label>
              {rule.enabled && (
                <div className="grid gap-2 sm:grid-cols-[8rem_9rem]">
                  <label className="text-xs font-medium">
                    Discount type
                    <select
                      value={rule.type}
                      onChange={(event) =>
                        updateRule(key, {
                          ...rule,
                          type: event.target.value as 'percent' | 'fixed',
                        })
                      }
                      className="mt-1 block h-10 w-full rounded-md border border-input bg-background px-2 text-sm"
                    >
                      <option value="percent">Percent</option>
                      <option value="fixed">Fixed amount</option>
                    </select>
                  </label>
                  <label className="text-xs font-medium">
                    {rule.type === 'fixed' ? 'Amount (CAD)' : 'Percent'}
                    <Input
                      type="number"
                      min="0"
                      max={rule.type === 'percent' ? 100 : undefined}
                      step={rule.type === 'fixed' ? '0.01' : '1'}
                      value={
                        rule.type === 'fixed'
                          ? ((rule.amount_cents ?? 0) / 100).toString()
                          : (rule.percent ?? 0).toString()
                      }
                      onChange={(event) => {
                        const value = Number(event.target.value || 0);
                        updateRule(
                          key,
                          rule.type === 'fixed'
                            ? { ...rule, amount_cents: Math.round(value * 100) }
                            : { ...rule, percent: Math.min(100, Math.max(0, value)) },
                        );
                      }}
                      className="mt-1"
                    />
                  </label>
                </div>
              )}
            </div>
          );
        })}
      </div>
      <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
        <input
          type="checkbox"
          checked={discounts.stack_enabled === true}
          onChange={(event) =>
            onChange({
              ...config,
              registration_discounts: {
                ...discounts,
                stack_enabled: event.target.checked,
              },
            })
          }
          className="mt-0.5 h-4 w-4"
        />
        <span>
          <span className="block font-medium">Allow discounts to stack</span>
          <span className="mt-1 block text-xs text-muted-foreground">
            When off, only the largest eligible discount applies. When on, eligible discounts are
            combined and capped at the entry fee.
          </span>
        </span>
      </label>
    </section>
  );
}
