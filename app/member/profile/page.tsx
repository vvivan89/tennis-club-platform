'use client';
import Image from 'next/image';
import { TennisLoader } from '@/components/tennis-loader';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import { requireBrowserUser } from '@/lib/supabase-browser-user';
import { formatPhoneNumber } from '@/lib/format-phone';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { MemberNav } from '@/components/member-nav';
import { FloatingFeedback } from '@/components/floating-feedback';
import { GenderSelect } from '@/components/gender-select';
import { TennisSkillLevelSelect } from '@/components/tennis-skill-level-select';

function isBirthdayToday(dateOfBirth: string | null) {
  if (!dateOfBirth) return false;
  const [, month, day] = dateOfBirth.split('-').map(Number);
  const today = new Date();
  return today.getMonth() + 1 === month && today.getDate() === day;
}

export default function ProfilePage() {
  const router = useRouter();
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [dateOfBirth, setDateOfBirth] = useState('');
  const [showBirthdayEmoji, setShowBirthdayEmoji] = useState(false);
  const [tennisSkillLevel, setTennisSkillLevel] = useState('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const [gender, setGender] = useState('');
  const [playingHand, setPlayingHand] = useState('');
  const [chatNotificationPreference, setChatNotificationPreference] = useState<
    'all' | 'mentions' | 'none'
  >('all');
  const [chatPreferencesBusy, setChatPreferencesBusy] = useState(false);
  const [emailPreferences, setEmailPreferences] = useState({
    registration: true,
    waitlist: true,
    cancellations: true,
    reminders: true,
    newEvents: true,
    newsletter: true,
  });
  const [avatarBusy, setAvatarBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [preferencesBusy, setPreferencesBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [club, setClub] = useState({
    club_name: 'Port Coquitlam Tennis Club',
    short_name: 'PCTC',
    social_links: [] as { url: string }[],
  });

  useEffect(() => {
    let active = true;
    const supabase = createSupabaseBrowserClient();
    async function loadProfile() {
      const {
        data: { user },
        error: userError,
      } = await supabase.auth.getUser();
      if (!active) return;
      if (userError || !user) {
        router.replace('/login?next=/profile');
        return;
      }
      setEmail(user.email ?? '');
      const { data: clubData } = await supabase
        .from('club_settings')
        .select('club_name,short_name,social_links')
        .eq('id', 1)
        .maybeSingle();
      if (active && clubData)
        setClub({
          club_name: clubData.club_name || 'Port Coquitlam Tennis Club',
          short_name: clubData.short_name || 'PCTC',
          social_links: Array.isArray(clubData.social_links) ? clubData.social_links : [],
        });
      const { data, error: queryError } = await supabase
        .from('profiles')
        .select(
          'full_name,phone,date_of_birth,show_birthday_emoji,tennis_skill_level,avatar_url,application_status,gender,playing_hand,email_registration_updates,email_waitlist_updates,email_event_cancellations,email_registration_reminders,email_new_events,email_newsletter,chat_notification_preference',
        )
        .eq('id', user.id)
        .maybeSingle();
      if (!active) return;
      if (data && data.application_status !== 'approved') {
        router.replace('/member/dashboard');
        return;
      }
      if (queryError) {
        console.error('[Member profile] Profile query failed', queryError);
        setError('Could not load profile details. Please try again later.');
      }
      if (data) {
        setFullName(data.full_name ?? '');
        setPhone(formatPhoneNumber(data.phone ?? ''));
        setDateOfBirth(data.date_of_birth ?? '');
        setShowBirthdayEmoji(Boolean(data.show_birthday_emoji));
        setTennisSkillLevel(data.tennis_skill_level ?? '');
        setAvatarUrl(data.avatar_url ?? '');
        setGender(data.gender ?? '');
        setPlayingHand(data.playing_hand ?? '');
        setChatNotificationPreference(data.chat_notification_preference ?? 'all');
        setEmailPreferences({
          registration: data.email_registration_updates ?? true,
          waitlist: data.email_waitlist_updates ?? true,
          cancellations: data.email_event_cancellations ?? true,
          reminders: data.email_registration_reminders ?? true,
          newEvents: data.email_new_events ?? true,
          newsletter: data.email_newsletter ?? true,
        });
      }
      setLoading(false);
    }
    loadProfile().catch((e) => {
      console.error('[Member profile] Profile load failed', e);
      if (active) {
        setError('Could not load profile details. Please try again later.');
        setLoading(false);
      }
    });
    return () => {
      active = false;
    };
  }, [router]);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError('');
    setMessage('');
    try {
      if (!phone.trim()) throw new Error('Phone number is required.');
      if (!dateOfBirth) throw new Error('Date of birth is required.');
      if (!gender) throw new Error('Select your gender.');
      if (!tennisSkillLevel) throw new Error('Select your tennis skill rating.');
      const { db: supabase, user } = await requireBrowserUser('Please sign in again.');
      const { data: updatedProfile, error: updateError } = await supabase
        .from('profiles')
        .update({
          full_name: fullName.trim(),
          phone: formatPhoneNumber(phone.trim()),
          date_of_birth: dateOfBirth || null,
          show_birthday_emoji: showBirthdayEmoji,
          tennis_skill_level: tennisSkillLevel,
          avatar_url: avatarUrl || null,
          gender: gender || null,
          playing_hand: playingHand || null,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id)
        .select('id')
        .maybeSingle();
      if (updateError) throw updateError;
      if (!updatedProfile) throw new Error('Profile was not updated.');
      setMessage('Profile saved.');
      router.refresh();
    } catch (e) {
      console.error('[Member profile] Profile update failed', e);
      setError('Could not save profile changes. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function saveEmailPreferences(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPreferencesBusy(true);
    setError('');
    setMessage('');
    try {
      const { db: supabase, user } = await requireBrowserUser('Please sign in again.');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          email_registration_updates: emailPreferences.registration,
          email_waitlist_updates: emailPreferences.waitlist,
          email_event_cancellations: emailPreferences.cancellations,
          email_registration_reminders: emailPreferences.reminders,
          email_new_events: emailPreferences.newEvents,
          email_newsletter: emailPreferences.newsletter,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (updateError) throw updateError;
      setMessage('Email preferences saved.');
      router.refresh();
    } catch (e) {
      console.error('[Member profile] Email preference update failed', e);
      setError('Could not save email preferences. Please try again.');
    } finally {
      setPreferencesBusy(false);
    }
  }

  async function saveChatNotificationPreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setChatPreferencesBusy(true);
    setError('');
    setMessage('');
    try {
      const { db: supabase, user } = await requireBrowserUser('Please sign in again.');
      const { error: updateError } = await supabase
        .from('profiles')
        .update({
          chat_notification_preference: chatNotificationPreference,
          updated_at: new Date().toISOString(),
        })
        .eq('id', user.id);
      if (updateError) throw updateError;
      window.dispatchEvent(
        new CustomEvent('pctc-chat-notification-preference-updated', {
          detail: { preference: chatNotificationPreference },
        }),
      );
      setMessage('Chat notification preferences saved.');
    } catch (e) {
      console.error('[Member profile] Chat notification preference update failed', e);
      setError('Could not save chat notification preferences. Please try again.');
    } finally {
      setChatPreferencesBusy(false);
    }
  }

  async function uploadAvatar(file?: File) {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('Choose an image file.');
      return;
    }
    if (file.size > 3 * 1024 * 1024) {
      setError('Avatar must be 3 MB or smaller.');
      return;
    }
    setAvatarBusy(true);
    setError('');
    setMessage('');
    try {
      const { db: supabase, user } = await requireBrowserUser('Please sign in again.');
      const ext =
        (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '') || 'jpg';
      const path = `${user.id}/avatar-${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from('member-avatars')
        .upload(path, file, { upsert: false, contentType: file.type });
      if (uploadError) throw uploadError;
      const { data } = supabase.storage.from('member-avatars').getPublicUrl(path);
      const url = data.publicUrl;
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: url, updated_at: new Date().toISOString() })
        .eq('id', user.id);
      if (updateError) throw updateError;
      setAvatarUrl(url);
      setMessage('Avatar updated.');
      router.refresh();
    } catch (e) {
      console.error('[Member profile] Avatar upload failed', e);
      setError('Could not upload avatar. Please try again.');
    } finally {
      setAvatarBusy(false);
    }
  }

  const birthdayVisible = showBirthdayEmoji && isBirthdayToday(dateOfBirth);

  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={club.club_name} shortName={club.short_name} />
      <MemberNav />
      <FloatingFeedback error={error} message={message} />
      <div className="page-container w-full flex-1 py-12">
        <div className="mx-auto max-w-6xl">
          <p className="eyebrow">Member portal</p>
          <h1 className="section-title">
            Edit profile{' '}
            {birthdayVisible ? (
              <span role="img" aria-label="Birthday">
                🎂
              </span>
            ) : null}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">Manage your PCTC member details.</p>
          {loading ? (
            <TennisLoader label="Loading profile" />
          ) : (
            <div className="mt-6 grid items-start gap-6 lg:grid-cols-[minmax(0,1.5fr)_minmax(300px,1fr)]">
              <Card>
                <CardHeader>
                  <CardTitle>Profile information</CardTitle>
                  <CardDescription>Update your personal and playing details.</CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={save} className="space-y-5">
                    <label className="block space-y-1.5 text-sm font-medium">
                      Email (managed by authentication)
                      <Input value={email} disabled readOnly />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Full name
                      <Input
                        autoComplete="name"
                        value={fullName}
                        onChange={(e) => setFullName(e.target.value)}
                        required
                        maxLength={120}
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Phone number <span className="text-destructive">*</span>
                      <Input
                        type="tel"
                        autoComplete="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        onBlur={() => setPhone((v) => formatPhoneNumber(v))}
                        maxLength={40}
                        required
                      />
                    </label>
                    <label className="block space-y-1.5 text-sm font-medium">
                      Date of birth <span className="text-destructive">*</span>
                      <Input
                        type="date"
                        value={dateOfBirth}
                        max={new Date().toISOString().slice(0, 10)}
                        onChange={(e) => setDateOfBirth(e.target.value)}
                        required
                      />
                    </label>
                    <label className="flex items-start gap-3 rounded-lg border border-border p-3 text-sm">
                      <input
                        type="checkbox"
                        className="mt-0.5 h-4 w-4 accent-primary"
                        checked={showBirthdayEmoji}
                        onChange={(e) => setShowBirthdayEmoji(e.target.checked)}
                      />
                      <span>
                        <span className="block font-medium">
                          Show a birthday cake emoji on my profile
                        </span>
                        <span className="mt-1 block font-normal text-muted-foreground">
                          If enabled and your date of birth is set, a cake emoji appears on your
                          profile on your birthday. Your date of birth is not displayed publicly.
                        </span>
                      </span>
                    </label>
                    <div className="space-y-3">
                      <p className="text-sm font-medium">Profile avatar</p>
                      <div className="flex items-center gap-4">
                        {avatarUrl ? (
                          <Image
                            src={avatarUrl}
                            alt="Your avatar"
                            width={64}
                            height={64}
                            unoptimized
                            className="h-16 w-16 rounded-full object-cover"
                          />
                        ) : (
                          <div className="grid h-16 w-16 place-items-center rounded-full bg-secondary text-lg font-semibold">
                            {fullName
                              .split(/\s+/)
                              .filter(Boolean)
                              .map((part) => part[0])
                              .slice(0, 2)
                              .join('')
                              .toUpperCase() || '?'}
                          </div>
                        )}
                        <label className="text-sm">
                          <span className="mb-1 block text-muted-foreground">
                            Upload an image (max 3 MB)
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            disabled={avatarBusy}
                            onChange={(e) => {
                              void uploadAvatar(e.target.files?.[0]);
                              e.currentTarget.value = '';
                            }}
                          />
                        </label>
                      </div>
                      {avatarBusy && (
                        <p className="text-xs text-muted-foreground">Uploading avatar…</p>
                      )}
                    </div>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <GenderSelect
                        value={gender}
                        onChange={setGender}
                        className="block space-y-1.5 text-sm font-medium"
                        selectClassName="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                      />
                      <label className="block space-y-1.5 text-sm font-medium">
                        Playing hand (optional)
                        <select
                          value={playingHand}
                          onChange={(e) => setPlayingHand(e.target.value)}
                          className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        >
                          <option value="">Not specified</option>
                          <option value="right">Right-handed</option>
                          <option value="left">Left-handed</option>
                        </select>
                      </label>
                    </div>
                    <TennisSkillLevelSelect
                      label="Tennis skill rating"
                      value={tennisSkillLevel}
                      onChange={setTennisSkillLevel}
                      placeholder="Select your rating"
                      selectClassName="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <div className="flex flex-wrap gap-3">
                      <Button type="submit" disabled={busy}>
                        {busy ? <TennisLoader compact label="Saving" /> : 'Save profile'}
                      </Button>
                      <Button asChild variant="outline">
                        <Link href="/member/dashboard">Cancel</Link>
                      </Button>
                    </div>
                  </form>
                </CardContent>
              </Card>
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Email preferences</CardTitle>
                    <CardDescription>
                      Choose which routine club emails you want to receive. Important administrative
                      announcements may still be sent.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={saveEmailPreferences} className="space-y-5">
                      <div className="space-y-4">
                        {(
                          [
                            {
                              key: 'registration',
                              label: 'Registration and withdrawal confirmations',
                            },
                            { key: 'waitlist', label: 'Waitlist promotion confirmations' },
                            { key: 'cancellations', label: 'Event cancellation notifications' },
                            { key: 'reminders', label: 'Reminders when registration opens' },
                            { key: 'newEvents', label: 'New event announcements' },
                            { key: 'newsletter', label: 'Newsletter and club news' },
                          ] as const
                        ).map((item) => (
                          <label key={item.key} className="flex items-start gap-3 text-sm">
                            <input
                              type="checkbox"
                              checked={emailPreferences[item.key]}
                              onChange={(e) =>
                                setEmailPreferences((old) => ({
                                  ...old,
                                  [item.key]: e.target.checked,
                                }))
                              }
                              className="mt-0.5 h-4 w-4"
                            />
                            <span>{item.label}</span>
                          </label>
                        ))}
                      </div>
                      <Button type="submit" disabled={preferencesBusy}>
                        {preferencesBusy ? (
                          <TennisLoader compact label="Saving" />
                        ) : (
                          'Save email preferences'
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
                <Card>
                  <CardHeader>
                    <CardTitle>Chat notifications</CardTitle>
                    <CardDescription>
                      Choose which new chat messages trigger an on-screen notification while you use
                      the website.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <form onSubmit={saveChatNotificationPreference} className="space-y-4">
                      {(
                        [
                          { value: 'all', label: 'Show all' },
                          { value: 'mentions', label: 'Show only when someone mentions you' },
                          { value: 'none', label: "Don't show" },
                        ] as const
                      ).map((option) => (
                        <label key={option.value} className="flex items-center gap-3 text-sm">
                          <input
                            type="radio"
                            name="chatNotificationPreference"
                            value={option.value}
                            checked={chatNotificationPreference === option.value}
                            onChange={() => setChatNotificationPreference(option.value)}
                          />
                          <span>{option.label}</span>
                        </label>
                      ))}
                      <Button type="submit" disabled={chatPreferencesBusy}>
                        {chatPreferencesBusy ? (
                          <TennisLoader compact label="Saving" />
                        ) : (
                          'Save chat preferences'
                        )}
                      </Button>
                    </form>
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </div>
      <SiteFooter
        clubName={club.club_name}
        shortName={club.short_name}
        socialLinks={club.social_links}
      />
    </main>
  );
}
