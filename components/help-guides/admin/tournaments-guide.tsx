import { Callout, FieldTable, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminTournamentsGuide() {
  return (
    <div className="space-y-5">
      <Topic
        id="admin-tournament-entries"
        title="Add tournament participants and correct entry details"
      >
        <p>
          Open the tournament’s management page and use the Participants controls. Search for an
          existing member, or—outside a League—leave the member search empty and enter a guest’s
          details. For doubles, manage the player entries first, then create or update the pair in
          the pairs controls. Team tournaments register players first and assign them to teams in
          the team controls.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Add a member',
              value: 'Search for and select the member profile, then choose Add participant.',
              effect:
                'The existing profile supplies the member’s identity. The player must meet the tournament’s normal category and eligibility requirements.',
            },
            {
              field: 'Add a non-member guest',
              value:
                'For non-League tournaments, leave member search blank and enter the guest’s name; email, phone, and gender are available as shown.',
              effect:
                'Creates a tournament participant record. Guest registration does not create an approved club membership account. League entries must use the League’s team registration rules.',
            },
            {
              field: 'Entry payment status',
              value:
                'Use the participant’s More actions menu to select Not required, Pending, Paid, Refunded, or Failed.',
              effect:
                'Changes the tournament entry’s payment-status record. It does not initiate a payment, verify a card charge, or issue a refund.',
            },
            {
              field: 'Tournament gender override',
              value:
                'For non-League tournaments, use More actions to set Male, Female, or Use profile gender.',
              effect:
                'Changes the gender value used for this tournament’s category eligibility; it does not edit the member’s profile. League gender is fixed by League configuration and has no participant override.',
            },
          ]}
        />
        <Callout>
          Use payment and gender overrides only as a last-resort correction after the normal
          registration, payment, or profile workflow failed. Verify the actual transaction or
          participant information first, record why the override is needed, and never mark an
          unverified payment as paid.
        </Callout>
      </Topic>

      <Topic id="admin-tournament-round-robin" title="Round robin groups, allocations, and matches">
        <p>
          In a round robin, every pair or team plays every other entry assigned to the same group.
          Group count and entries per group come from the tournament configuration.
        </p>
        <Steps>
          <li>
            Add eligible participant entries. Doubles players must be formed into pairs; team
            tournament participants must be assigned to teams before those entries can play.
          </li>
          <li>
            Allocate each pair or team with its Group selector. If the tournament has multiple
            groups, use Random group draw to distribute entries randomly and as evenly as possible,
            or set groups manually.
          </li>
          <li>
            Open Matches and scheduling and results, select the relevant Round robin phase and
            category, then choose Suggest schedule. The app creates any missing within-group
            matchups and suggests times and courts for unscheduled matches.
          </li>
          <li>
            Review the generated match list, edit any side, date, or court that needs correction,
            and record results after matches are eligible for scoring.
          </li>
        </Steps>
        <p>
          Changing group assignments reconciles unplayed round-robin matches with the new groups;
          completed results are preserved. Review the resulting fixture list after a draw change.
        </p>
      </Topic>

      <Topic id="admin-tournament-automated-draw" title="How automated draws work">
        <FieldTable
          rows={[
            {
              field: 'Random group draw',
              value: 'Available when more than one group is configured.',
              effect:
                'Randomly distributes pairs or teams across groups as evenly as possible, then reconciles unplayed round-robin matchups.',
            },
            {
              field: 'Create draw for knockout only',
              value: 'Use Create draw in the Preliminary knockout or Final/Team knockout phase.',
              effect:
                'Randomly pairs the eligible entries into a knockout bracket. If the count is not a power of two, the bracket includes byes for automatic advancement.',
            },
            {
              field: 'Create draw after round robin',
              value:
                'Assign all groups and record the round-robin outcomes before generating the final knockout draw.',
              effect:
                'Uses the configured number of promoted entries from each group and the calculated group order to place entries into bracket slots. Incomplete groups remain as pending slots until results are complete.',
            },
            {
              field: 'Regenerating a knockout draw',
              value: 'Check the bracket warning and review existing match results first.',
              effect:
                'A bracket can be regenerated when entrant counts change only while no knockout results exist. Once a result is recorded, edit the bracket manually instead.',
            },
          ]}
        />
        <p>
          A generated bracket is a starting point for event-manager review. Check the match sides
          and any byes before sharing the schedule; knockout match winners advance automatically
          when their results are saved.
        </p>
      </Topic>

      <Topic id="admin-tournament-scheduling" title="How automated match scheduling works">
        <p>
          Suggest schedule operates on the selected round-robin phase. It creates missing
          within-group fixtures, then assigns each unscheduled match a time and court using the
          event’s start/end, available court count, configured match duration, and break between
          matches.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Schedule window',
              value:
                'Matches are suggested between 8:00 a.m. and 9:00 p.m. inside the event dates.',
              effect:
                'A later competition phase starts after its prerequisite matches, with a minimum one-hour phase break.',
            },
            {
              field: 'Court and player conflicts',
              value: 'Review the proposed assignment and the conflict notices on the court board.',
              effect:
                'The suggestion avoids overlapping matches on the same court and overlapping play for the same players, including the configured break.',
            },
            {
              field: 'Manual adjustment',
              value: 'Edit a match’s date, time, or court, or drag a match to another court.',
              effect:
                'The app checks schedule conflicts and asks for confirmation before saving a change that creates a conflict.',
            },
          ]}
        />
        <p>
          Suggested times are not final until reviewed. Match duration and break settings are
          estimates used by the scheduler; adjust the schedule to fit actual court availability.
        </p>
      </Topic>

      <Topic id="admin-tournament-standings" title="Group standings, tie-breaks, and promotions">
        <p>
          Standings are calculated from recorded match outcomes and the tie-break order configured
          for the tournament. Depending on the format, the table can use matches won, sets, games,
          score differences, head-to-head, or team match points. Only the two-set team scoring
          template awards match points; other team scoring templates omit those points from ranking
          priority and the standings table.
        </p>
        <p>
          When round robin and knockout are both enabled, the configured number of top entries in
          each group are marked for promotion. Promotion remains pending while group matches are
          incomplete; final bracket slots are based on the completed standings.
        </p>
        <Steps>
          <li>Check that all expected matches have a valid saved result.</li>
          <li>Review each group’s ranking and promotion indicators.</li>
          <li>
            If a correction is necessary, choose Override standings for that group. Reorder entries
            to change ranking and toggle Promoted for each entry whose advancement should change.
          </li>
          <li>
            Enter a reason for the changes and save. The reason is retained with the override;
            review the standings and generated knockout draw afterward.
          </li>
        </Steps>
      </Topic>

      <Topic id="admin-tournament-knockout" title="Knockout stages and match administration">
        <p>
          A knockout match eliminates the losing entry from that stage. Tournament configuration
          determines whether a Preliminary knockout, Final knockout, or Team knockout phase is
          enabled, and the phase’s scoring template validates results. If there is one group, all
          bracket entries are treated as Group 1.
        </p>
        <Steps>
          <li>
            Select the correct category and knockout phase in Matches, scheduling and results.
          </li>
          <li>
            Create the draw automatically or create/edit matches manually. Verify bracket slots,
            byes, court, date, and time before play.
          </li>
          <li>
            Record the score or a walkover after the match is eligible for scoring. A saved winner
            advances to the next knockout match automatically.
          </li>
          <li>
            If a generated bracket must change, do so before results are recorded. After results
            exist, edit individual matches rather than regenerating the bracket.
          </li>
        </Steps>
        <p>
          For Team tournaments, create matches between teams first, then assign the eligible players
          who will play for each team. Captains select their own lineup; event managers can manage
          either team’s lineup. A lineup is visible to its own team, and becomes visible to everyone
          once the match starts; a published lineup is visible on the public tournament page
          earlier.
        </p>
      </Topic>

      <Topic id="admin-tournament-winners" title="Review and announce tournament winners">
        <p>
          The winner announcement section appears to event managers once there is at least one
          actual match and every non-bye, non-cancelled match has a completed result and winner. It
          also remains available after winners have been announced so an event manager can remove
          the announcement.
        </p>
        <Steps>
          <li>
            Review the preview in Tournament results are complete. It lists the winners by category,
            including ties and overall team standings when configured.
          </li>
          <li>
            Select Announce winners only after confirming the preview. Before announcement, the
            preview is visible to managers only; it is not presented as the public winners list.
          </li>
          <li>
            Select Unannounce winners to remove the published announcement. The match results and
            standings remain recorded; only the winner announcement is cleared.
          </li>
        </Steps>
      </Topic>

      <Topic id="admin-tournament-audit" title="Review tournament changes and match records">
        <p>
          Use the tournament audit history when investigating who changed an entry, group, match,
          score, lineup, or schedule and when. It helps event managers explain corrections and
          distinguish the saved competition record from a participant’s report of what happened.
          Review history after a manual override or disputed result and retain a clear reason for
          standings changes.
        </p>
      </Topic>
    </div>
  );
}
