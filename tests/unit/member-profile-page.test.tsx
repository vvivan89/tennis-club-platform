import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  user: { id: 'member-1', email: 'member@example.com' } as null | { id: string; email: string },
  profile: {
    full_name: 'Member One',
    phone: '604.555.0100',
    date_of_birth: null,
    show_birthday_emoji: false,
    tennis_skill_level: '3.5',
    avatar_url: null,
    application_status: 'approved',
    gender: null,
    playing_hand: null,
    email_registration_updates: true,
    email_waitlist_updates: true,
    email_event_cancellations: true,
    email_registration_reminders: true,
    email_membership_reminders: true,
    email_new_events: true,
    email_newsletter: true,
  } as Record<string, unknown>,
  routerReplace: vi.fn(),
  routerRefresh: vi.fn(),
  updates: [] as Array<{ table: string; values: Record<string, unknown> }>,
  upload: vi.fn(),
  getPublicUrl: vi.fn(),
  profileError: null as null | { message: string },
  updateError: null as null | { message: string },
  updateNoData: false,
  setThemeMode: vi.fn(),
  setThemeAccent: vi.fn(),
}));
vi.mock('next/navigation', () => {
  const router = { replace: mocks.routerReplace, refresh: mocks.routerRefresh };
  return { useRouter: () => router };
});
vi.mock('@/components/site-header', () => ({ SiteHeader: () => null }));
vi.mock('@/components/site-footer', () => ({ SiteFooter: () => null }));
vi.mock('@/components/member-nav', () => ({ MemberNav: () => null }));
vi.mock('@/components/club-theme-provider', () => ({
  useClubTheme: () => ({
    mode: 'system',
    accentColor: 'blue',
    preferencesReady: true,
    setMode: mocks.setThemeMode,
    setAccentColor: mocks.setThemeAccent,
  }),
}));
vi.mock('@/lib/supabase-browser', () => ({
  createSupabaseBrowserClient: () => ({
    auth: { getUser: async () => ({ data: { user: mocks.user }, error: null }) },
    from: (table: string) => {
      let updateValues: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        maybeSingle: async () => {
          if (updateValues) {
            mocks.updates.push({ table, values: updateValues });
            return {
              data: mocks.updateError || mocks.updateNoData ? null : { id: 'member-1' },
              error: mocks.updateError,
            };
          }
          return {
            data: table === 'club_settings' ? null : mocks.profile,
            error: table === 'profiles' ? mocks.profileError : null,
          };
        },
        update: (values: Record<string, unknown>) => {
          updateValues = values;
          return query;
        },
        then: (
          resolve: (value: { error: typeof mocks.updateError }) => unknown,
          reject: (reason: unknown) => unknown,
        ) => {
          if (updateValues) mocks.updates.push({ table, values: updateValues });
          return Promise.resolve({ error: mocks.updateError }).then(resolve, reject);
        },
      };
      return query;
    },
    storage: {
      from: () => ({ upload: mocks.upload, getPublicUrl: mocks.getPublicUrl }),
    },
  }),
}));

import ProfilePage from '@/app/member/profile/page';

beforeEach(() => {
  mocks.user = { id: 'member-1', email: 'member@example.com' };
  mocks.profile = {
    full_name: 'Member One',
    phone: '604.555.0100',
    date_of_birth: null,
    show_birthday_emoji: false,
    tennis_skill_level: '3.5',
    avatar_url: null,
    application_status: 'approved',
    gender: null,
    playing_hand: null,
    email_registration_updates: true,
    email_waitlist_updates: true,
    email_event_cancellations: true,
    email_registration_reminders: true,
    email_membership_reminders: true,
    email_new_events: true,
    email_newsletter: true,
  };
  mocks.routerReplace.mockReset();
  mocks.routerRefresh.mockReset();
  mocks.updates = [];
  mocks.upload.mockReset().mockResolvedValue({ error: null });
  mocks.getPublicUrl.mockReturnValue({ data: { publicUrl: 'https://storage.example/avatar.jpg' } });
  mocks.profileError = null;
  mocks.updateError = null;
  mocks.updateNoData = false;
});
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('Member profile page', () => {
  it('places the device push control inside the Chat notifications card', async () => {
    render(<ProfilePage />);
    const heading = await screen.findByRole('heading', { name: 'Chat notifications' });
    const chatCard = heading.closest('.rounded-xl');
    const pushSwitch = await screen.findByRole('switch', { name: 'Enable on this device' });

    expect(chatCard).toContainElement(pushSwitch);
    expect(
      screen.queryByRole('heading', { name: 'Chat push notifications' }),
    ).not.toBeInTheDocument();
  });

  it('redirects a signed-out user to login', async () => {
    mocks.user = null;
    render(<ProfilePage />);
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalledWith('/login?next=/profile'));
  });

  it('redirects unapproved profiles and loads approved profile data', async () => {
    mocks.profile = { ...mocks.profile, application_status: 'pending' };
    const { unmount } = render(<ProfilePage />);
    await waitFor(() => expect(mocks.routerReplace).toHaveBeenCalledWith('/member/dashboard'));
    unmount();
    mocks.routerReplace.mockReset();
    mocks.profile = { ...mocks.profile, application_status: 'approved' };
    render(<ProfilePage />);
    expect(await screen.findByDisplayValue('Member One')).toBeInTheDocument();
    expect(screen.getByDisplayValue('member@example.com')).toBeDisabled();
  });

  it('reports profile query failures and missing profile data', async () => {
    mocks.profileError = { message: 'profile unavailable' };
    const { unmount } = render(<ProfilePage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load profile details.');
    unmount();

    mocks.profileError = null;
    mocks.profile = null as unknown as Record<string, unknown>;
    render(<ProfilePage />);
    expect(await screen.findByRole('heading', { name: 'Edit profile' })).toBeInTheDocument();
  });

  it('uses empty field values and enabled defaults when optional profile data is null', async () => {
    mocks.user = { id: 'member-1', email: null as unknown as string };
    mocks.profile = {
      ...mocks.profile,
      full_name: null,
      phone: null,
      tennis_skill_level: null,
      email_registration_updates: null,
      email_waitlist_updates: null,
      email_event_cancellations: null,
      email_registration_reminders: null,
      email_membership_reminders: null,
      email_new_events: null,
      email_newsletter: null,
    };

    render(<ProfilePage />);

    expect(await screen.findByLabelText('Full name')).toHaveValue('');
    expect(screen.getByLabelText(/Phone number/)).toHaveValue('');
    expect(screen.getByLabelText(/Tennis skill rating/)).toHaveValue('');
    expect(screen.getByLabelText(/Email \(managed by authentication\)/)).toHaveValue('');
    for (const label of [
      'Registration and withdrawal confirmations',
      'Waitlist promotion confirmations',
      'Event cancellation notifications',
      'Event registration and payment reminders',
      'Membership renewal and payment reminders',
      'New event announcements',
      'Newsletter and club news',
    ])
      expect(screen.getByLabelText(label)).toBeChecked();
  });

  it('shows the private birthday indicator only when the member enables it on their birthday', async () => {
    const today = new Date();
    mocks.profile = {
      ...mocks.profile,
      date_of_birth: `2000-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`,
      show_birthday_emoji: true,
    };

    render(<ProfilePage />);

    expect(await screen.findByRole('img', { name: 'Birthday' })).toBeInTheDocument();
    expect(screen.getByText(/🎂/)).toBeInTheDocument();
  });

  it('saves normalized profile fields and email preference changes', async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'New Member' } });
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '6045550199' } });
    fireEvent.change(screen.getByLabelText(/Date of birth/), {
      target: { value: '1990-05-14' },
    });
    fireEvent.change(screen.getByLabelText(/Gender/), { target: { value: 'female' } });
    const forms = container.querySelectorAll('form');
    fireEvent.submit(forms[0]);
    await waitFor(() =>
      expect(
        mocks.updates.some(
          (item) => item.table === 'profiles' && item.values.full_name === 'New Member',
        ),
      ).toBe(true),
    );
    expect(mocks.updates.find((item) => item.values.full_name === 'New Member')?.values.phone).toBe(
      '604.555.0199',
    );

    fireEvent.click(screen.getByLabelText('New event announcements'));
    fireEvent.click(screen.getByLabelText('Membership renewal and payment reminders'));
    const emailPreferencesForm = screen
      .getByRole('button', { name: 'Save email preferences' })
      .closest('form');
    expect(emailPreferencesForm).not.toBeNull();
    fireEvent.submit(emailPreferencesForm!);
    await waitFor(() =>
      expect(
        mocks.updates.some(
          (item) =>
            item.values.email_new_events === false &&
            item.values.email_membership_reminders === false,
        ),
      ).toBe(true),
    );
    expect(screen.getByText('Email preferences saved.')).toBeInTheDocument();
  });

  it('rejects non-image avatar files without uploading', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['not an image'], 'notes.txt', { type: 'text/plain' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose an image file.');
    expect(mocks.upload).not.toHaveBeenCalled();
  });

  it('validates required profile fields and reports update failures safely', async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '   ' } });
    fireEvent.submit(container.querySelectorAll('form')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save profile changes.');
    expect(mocks.updates).toHaveLength(0);

    fireEvent.change(screen.getByLabelText(/Phone number/), { target: { value: '6045550199' } });
    fireEvent.change(screen.getByLabelText(/Tennis skill rating/), { target: { value: '' } });
    fireEvent.submit(container.querySelectorAll('form')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save profile changes.');

    mocks.updateError = { message: 'database details' };
    fireEvent.change(screen.getByLabelText(/Tennis skill rating/), { target: { value: '4.0' } });
    fireEvent.submit(container.querySelectorAll('form')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save profile changes.');

    mocks.updateError = null;
    mocks.updateNoData = true;
    fireEvent.change(screen.getByLabelText(/Tennis skill rating/), { target: { value: '4.5' } });
    fireEvent.submit(container.querySelectorAll('form')[0]);
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not save profile changes.');
  });

  it('saves chat preferences, dispatches the update event, and reports write failures', async () => {
    const { container } = render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    const dispatch = vi.spyOn(window, 'dispatchEvent');
    await userEvent.click(screen.getByLabelText('Show only when someone mentions you'));
    fireEvent.submit(container.querySelectorAll('form')[2]);
    expect(await screen.findByText('Chat notification preferences saved.')).toBeInTheDocument();
    expect(dispatch).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'pctc-chat-notification-preference-updated' }),
    );
    expect(mocks.updates).toContainEqual(
      expect.objectContaining({
        values: expect.objectContaining({ chat_notification_preference: 'mentions' }),
      }),
    );

    mocks.updateError = { message: 'database details' };
    fireEvent.submit(container.querySelectorAll('form')[2]);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Could not save chat notification preferences.',
    );
  });

  it('uploads a valid avatar, displays the new image, and handles size and storage failures', async () => {
    const user = userEvent.setup({ applyAccept: false });
    render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    await user.upload(input, new File(['image'], 'avatar.png', { type: 'image/png' }));
    expect(await screen.findByText('Avatar updated.')).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'Your avatar' })).toHaveAttribute(
      'src',
      'https://storage.example/avatar.jpg',
    );
    expect(mocks.upload).toHaveBeenCalledWith(
      expect.stringMatching(/^member-1\/avatar-\d+\.png$/),
      expect.any(File),
      { upsert: false, contentType: 'image/png' },
    );

    await user.upload(input, new File(['image'], 'avatar.', { type: 'image/png' }));
    await waitFor(() => expect(mocks.upload).toHaveBeenCalledTimes(2));
    expect(mocks.upload.mock.calls[1][0]).toMatch(/\.jpg$/);

    await user.upload(
      input,
      new File([new Uint8Array(3 * 1024 * 1024 + 1)], 'large.png', { type: 'image/png' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Avatar must be 3 MB or smaller.');

    mocks.upload.mockResolvedValueOnce({ error: { message: 'storage unavailable' } });
    await user.upload(input, new File(['image'], 'other.png', { type: 'image/png' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Could not upload avatar.');
  });

  it('ignores an avatar input change when no file is selected', async () => {
    render(<ProfilePage />);
    await screen.findByDisplayValue('Member One');
    fireEvent.change(document.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [] },
    });
    expect(mocks.upload).not.toHaveBeenCalled();
  });
});
