import { FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminClubProfileGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-club-information" title="Club information and public identity">
        <p>
          These values supply the club identity used by the site header, footer, contact pages, and
          location displays. Review the public site after saving, especially after changing the logo
          or contact details.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Club name and short name',
              value: 'Enter the full public name and its short brand name.',
              effect:
                'The full name is used in site content; the short name is used where space is limited.',
            },
            {
              field: 'Club description',
              value: 'Write a concise public description of the club.',
              effect: 'Supplies club profile content shown to visitors.',
            },
            {
              field: 'Contact email and phone',
              value: 'Enter monitored club contact details.',
              effect: 'Provides the main public contact route; verify both values before saving.',
            },
            {
              field: 'Location URL and location search',
              value: 'Use a useful map link and the place name/address used for location display.',
              effect:
                'The URL opens the map; the search value supports event location and weather lookup.',
            },
            {
              field: 'Logo',
              value: 'Upload PNG, JPEG, WebP, or SVG up to 5 MB, then save the profile.',
              effect:
                'The uploaded image replaces the initials mark in the site header/footer branding.',
            },
            {
              field: 'Social media links',
              value:
                'Add the full URL for each club account; remove links that are no longer active.',
              effect: 'Recognized services receive a matching icon and appear with club links.',
            },
          ]}
        />
        <p>
          <LinkButton href="/admin/club-profile">Open Club Profile</LinkButton>
        </p>
      </Topic>
      <Topic id="admin-club-contacts" title="Club contacts and executives">
        <p>
          This optional section allows you to reveal the people responsible for club operations to
          members and the public.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Member and position',
              value: 'Choose an approved member and enter their club position, such as President.',
              effect: 'The name and position remain visible on the Contacts page.',
            },
            {
              field: 'Email addresses and phone numbers',
              value: 'Enter one or more values separated by commas.',
              effect: 'Creates the contact links shown to viewers allowed to see the details.',
            },
            {
              field: 'Reveal contact information publicly',
              value: 'Enable this only when the contact agrees to public disclosure.',
              effect:
                'When off, only signed-in members with an active paid membership see email and phone; everyone still sees name and position.',
            },
            {
              field: 'Contact row order',
              value:
                'Contacts appear in their current row order; add or remove rows to maintain the list.',
              effect: 'Controls the sequence on the Contacts page.',
            },
          ]}
        />
        <Steps>
          <li>Add a contact row and select the correct member profile.</li>
          <li>
            Enter a position and current contact methods; separate multiple values with commas.
          </li>
          <li>
            Set public visibility deliberately, add/remove rows to get the intended sequence, then
            save the contact changes.
          </li>
          <li>Check the public Contacts page and, if needed, the paid-member view.</li>
        </Steps>
        <p>
          <LinkButton href="/admin/club-profile?tab=contacts">Open Club contacts</LinkButton>
        </p>
      </Topic>
    </div>
  );
}
