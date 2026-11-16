import { FieldTable } from '@/components/help-guide-primitives';

export function ProfileFieldsTable({
  includeChatPreference = false,
}: {
  includeChatPreference?: boolean;
}) {
  const rows = [
    {
      field: 'Required profile fields',
      value:
        'Full name, phone number, date of birth, gender, and tennis skill rating are required. Email is managed by authentication and cannot be changed on this page.',
      effect:
        'Gender affects eligibility for gender-specific events and tournament categories. Date of birth supports family membership eligibility and the optional birthday display; it is not shown publicly.',
    },
    {
      field: 'Tennis skill rating',
      value: 'Choose the rating that best reflects your current level.',
      effect:
        'Your selected skill rating appears with your name in participant and results displays that show player details.',
    },
    {
      field: 'Avatar and playing hand',
      value: 'Upload an avatar and choose your playing hand if desired.',
      effect:
        'Your avatar identifies you in player lists. Playing hand is saved as profile information.',
    },
    {
      field: 'Email preferences',
      value: 'Choose the automated event and club email categories you want.',
      effect:
        'Preferences control routine notification emails. You can also unsubscribe from a category directly from its email without signing in. Important administrative announcements may still be sent.',
    },
    ...(includeChatPreference
      ? [
          {
            field: 'Chat notification preference',
            value: 'Choose Show all, Show only when someone mentions you, or Don’t show.',
            effect:
              'This preference controls in-app chat alerts and browser push notifications when enabled.',
          },
        ]
      : []),
    {
      field: 'Show birthday emoji',
      value: 'Enable or disable the profile option.',
      effect:
        'When enabled, a birthday cake indicator appears beside your player identity on your birthday.',
    },
    {
      field: 'Website appearance',
      value: 'Choose light, dark, or system theme and a color scheme, then save.',
      effect: 'Changes the appearance of the site for your account.',
    },
  ];

  return <FieldTable rows={rows} />;
}
