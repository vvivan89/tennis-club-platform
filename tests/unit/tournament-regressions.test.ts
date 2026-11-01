import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const management = readFileSync(
  join(process.cwd(), 'components/tournament-management.tsx'),
  'utf8',
);
const publicView = readFileSync(
  join(process.cwd(), 'components/tournament-public-view.tsx'),
  'utf8',
);

describe('tournament regression fixes', () => {
  it('updates pair group assignment without referencing a nonexistent updated_at column', () => {
    const start = management.indexOf('async function saveEntryGroup(');
    const end = management.indexOf('async function randomizeGroups()', start);
    const saveGroup = management.slice(start, end);
    expect(saveGroup).toContain('group_number: groupNumber');
    expect(saveGroup).not.toContain('updated_at');
    expect(management).toContain(
      'aria-label={`Group for ${p.player_one_name} and ${p.player_two_name}`}',
    );
  });

  it('keeps match action menus registered with the outside-click closer', () => {
    expect(management).toContain(
      'querySelectorAll<HTMLDetailsElement>(\'details[data-tournament-menu="true"][open]\')',
    );
    expect(management).toContain(
      '<details className="relative shrink-0" data-tournament-menu="true">',
    );
  });

  it('does not inject admin participant content into the Groups, Schedule & Results view', () => {
    expect(publicView).not.toContain(
      '{adminContent && <div className="mb-5">{adminContent}</div>}',
    );
    expect(publicView).toMatch(
      /\['participants',\s*'matches',\s*'audit'\]\.includes\(tab\)\s*&&\s*adminContent\s*&&\s*\(!leagueTournament\s*\|\|\s*!\['matches',\s*'audit'\]\.includes\(tab\)\)/,
    );
  });

  it('renders the participant roster only once in the tournament overview', () => {
    expect(
      publicView.match(
        /aria-label=\{leagueTournament \? 'Players and courts' : 'Registered entries'\}/g,
      ) ?? [],
    ).toHaveLength(1);
    expect(publicView).not.toContain('The organizer has not published participants yet.');
  });

  it('does not retain the standalone Group assignments section', () => {
    expect(management).not.toContain('aria-label="Group assignments"');
    expect(management).not.toContain('function renderGroupAssignments()');
    expect(management).toContain('Random group draw');
  });
  it('shows walkover awards prominently in the match editor', () => {
    expect(management).toContain('bg-amber-100 px-3 py-2 text-sm font-semibold text-amber-950');
    expect(management).toContain('Walkover / retirement awarded to side one');
    expect(management).toContain('Walkover / retirement awarded to side two');
    expect(management).toContain('const isWalkoverNote =');
  });

  it('requires the app confirmation dialog before replacing a walkover with a score', () => {
    expect(management).toContain('setPendingWalkoverScore({ match, raw })');
    expect(management).toContain('title="Replace walkover result?"');
    expect(management).toContain('confirmLabel="Save score"');
    expect(management).not.toContain('window.confirm(');
  });

  it('clears the walkover notice only when the replacement score is saved', () => {
    expect(management).toContain("...(isWalkoverResult ? { notes: '' } : {})");
    expect(management).toContain('if (!scoreSaved) return;');
  });
});
