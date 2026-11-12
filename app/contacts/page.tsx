import Image from 'next/image';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { SiteHeader } from '@/components/site-header';
import { SiteFooter } from '@/components/site-footer';
import { formatPhoneNumber } from '@/lib/format-phone';
import {
  Mail,
  Phone,
  MapPin,
  Facebook,
  Instagram,
  Twitter,
  Youtube,
  Linkedin,
  Music2,
  Link as LinkIcon,
} from 'lucide-react';

function socialIcon(url: string) {
  const u = url.toLowerCase();
  if (/facebook\.com/.test(u)) return <Facebook className="h-5 w-5" />;
  if (/instagram\.com/.test(u)) return <Instagram className="h-5 w-5" />;
  if (/twitter\.com|x\.com/.test(u)) return <Twitter className="h-5 w-5" />;
  if (/youtube\.com|youtu\.be/.test(u)) return <Youtube className="h-5 w-5" />;
  if (/linkedin\.com/.test(u)) return <Linkedin className="h-5 w-5" />;
  if (/tiktok\.com/.test(u)) return <Music2 className="h-5 w-5" />;
  return <LinkIcon className="h-5 w-5" />;
}
export default async function ContactsPage() {
  const db = await createSupabaseServerClient();
  const [{ data }, { data: people }] = await Promise.all([
    db
      .from('club_settings')
      .select(
        'club_name,short_name,description,contact_email,contact_phone,location_url,location_query,social_links',
      )
      .eq('id', 1)
      .maybeSingle(),
    db
      .from('public_club_contacts')
      .select('id,position,emails,phones,sort_order,full_name,avatar_url,is_public')
      .order('sort_order'),
  ]);
  const c = data ?? {
    club_name: 'Port Coquitlam Tennis Club',
    short_name: '',
    description: '',
    contact_email: '',
    contact_phone: '',
    location_url: '',
    location_query: '',
    social_links: [],
  };
  const socials = Array.isArray(c.social_links) ? (c.social_links as { url: string }[]) : [];
  const location = String(c.location_query || '').trim();
  const mapSrc = location
    ? `https://maps.google.com/maps?q=${encodeURIComponent(location)}&output=embed`
    : '';
  return (
    <main className="flex min-h-screen flex-col bg-background text-foreground">
      <SiteHeader clubName={c.club_name} shortName={c.short_name} active="contacts" />
      <div className="page-container flex-1 py-12">
        <p className="eyebrow">Get in touch</p>
        <h1 className="section-title">Contact {c.club_name}</h1>
        {c.description && (
          <p className="mt-4 max-w-2xl leading-7 text-muted-foreground">{c.description}</p>
        )}
        <div className="mt-8 grid gap-5 md:grid-cols-2">
          <section className="rounded-xl border border-border p-6">
            <h2 className="text-xl font-semibold">General contact</h2>
            <div className="mt-5 space-y-4">
              {c.contact_email && (
                <a
                  className="flex items-center gap-3 break-all text-sm hover:text-primary"
                  href={`mailto:${c.contact_email}`}
                >
                  <Mail className="h-5 w-5 shrink-0" />
                  {c.contact_email}
                </a>
              )}
              {c.contact_phone && (
                <a
                  className="flex items-center gap-3 text-sm hover:text-primary"
                  href={`tel:${c.contact_phone}`}
                >
                  <Phone className="h-5 w-5 shrink-0" />
                  {formatPhoneNumber(c.contact_phone)}
                </a>
              )}
              {c.location_url && (
                <a
                  className="flex items-center gap-3 text-sm hover:text-primary"
                  href={c.location_url}
                  target="_blank"
                  rel="noreferrer"
                >
                  <MapPin className="h-5 w-5 shrink-0" />
                  Open location in Google Maps
                </a>
              )}
              {!c.contact_email && !c.contact_phone && !c.location_url && (
                <p className="text-sm text-muted-foreground">
                  General contact details have not been added.
                </p>
              )}
            </div>
            {socials.length > 0 && (
              <div className="mt-7 border-t border-border pt-5">
                <h3 className="text-sm font-semibold">Follow the club</h3>
                <div className="mt-3 flex flex-wrap gap-3">
                  {socials.map((item, i) => (
                    <a
                      key={i}
                      href={item.url}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Club social link ${i + 1}`}
                      className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-accent"
                    >
                      {socialIcon(item.url)}
                    </a>
                  ))}
                </div>
              </div>
            )}
          </section>
          <section className="overflow-hidden rounded-xl border border-border">
            <h2 className="px-6 py-5 text-xl font-semibold">Location</h2>
            {mapSrc ? (
              <>
                <iframe
                  title={`${c.club_name} location on Google Maps`}
                  src={mapSrc}
                  className="h-80 w-full border-0"
                  loading="lazy"
                  referrerPolicy="no-referrer-when-downgrade"
                />
                <div className="px-6 py-3 text-sm">
                  <a
                    className="text-primary underline"
                    href={
                      c.location_url ||
                      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(location)}`
                    }
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open in Google Maps
                  </a>
                </div>
              </>
            ) : (
              <div className="grid h-80 place-items-center bg-muted p-6 text-center text-sm text-muted-foreground">
                Add a club address or place name in Club Profile to show the map.
              </div>
            )}
          </section>
        </div>
        {people?.length ? (
          <section className="mt-10">
            <h2 className="text-2xl font-semibold">Club executives and contacts</h2>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {people.map((person) => {
                const emails = Array.isArray(person.emails) ? person.emails : [];
                const phones = Array.isArray(person.phones) ? person.phones : [];
                const initials =
                  String(person.full_name || '')
                    .split(/\s+/)
                    .filter(Boolean)
                    .slice(0, 2)
                    .map((x: string) => x[0])
                    .join('')
                    .toUpperCase() || '?';
                return (
                  <article key={person.id} className="rounded-xl border border-border p-5">
                    <div className="flex items-center gap-3">
                      {person.avatar_url ? (
                        <Image
                          src={person.avatar_url}
                          alt=""
                          width={48}
                          height={48}
                          unoptimized
                          className="h-12 w-12 rounded-full object-cover"
                        />
                      ) : (
                        <div className="grid h-12 w-12 place-items-center rounded-full bg-secondary text-sm font-semibold">
                          {initials}
                        </div>
                      )}
                      <div>
                        <h3 className="font-semibold">{person.full_name || 'Club member'}</h3>
                        <p className="text-sm text-muted-foreground">{person.position}</p>
                      </div>
                    </div>
                    <div className="mt-4 space-y-2">
                      {emails.map((email: string, i: number) => (
                        <a
                          key={`e${i}`}
                          href={`mailto:${email}`}
                          className="flex items-start gap-2 break-all text-sm hover:text-primary"
                        >
                          <Mail className="mt-0.5 h-4 w-4 shrink-0" />
                          {email}
                        </a>
                      ))}
                      {phones.map((phone: string, i: number) => (
                        <a
                          key={`p${i}`}
                          href={`tel:${phone}`}
                          className="flex items-start gap-2 text-sm hover:text-primary"
                        >
                          <Phone className="mt-0.5 h-4 w-4 shrink-0" />
                          {formatPhoneNumber(phone)}
                        </a>
                      ))}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}
      </div>
      <SiteFooter clubName={c.club_name} shortName={c.short_name} socialLinks={socials} />
    </main>
  );
}
