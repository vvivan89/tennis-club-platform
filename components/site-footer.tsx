'use client';
import { useEffect, useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';
import Link from 'next/link';
import {
  Facebook,
  Instagram,
  Twitter,
  Youtube,
  Linkedin,
  Music2,
  Link as LinkIcon,
} from 'lucide-react';

type Social = { url: string };
export function SiteFooter({
  clubName: suppliedClubName,
  shortName: suppliedShortName,
  socialLinks: suppliedSocialLinks,
}: { clubName?: string; shortName?: string; socialLinks?: Social[] } = {}) {
  const [settings, setSettings] = useState({
    club_name: suppliedClubName || 'Port Coquitlam Tennis Club',
    short_name: suppliedShortName || 'PCTC',
    social_links: suppliedSocialLinks || ([] as Social[]),
  });
  useEffect(() => {
    if (suppliedClubName && suppliedShortName && suppliedSocialLinks) {
      setSettings({
        club_name: suppliedClubName,
        short_name: suppliedShortName,
        social_links: suppliedSocialLinks,
      });
      return;
    }
    let alive = true;
    createSupabaseBrowserClient()
      .from('club_settings')
      .select('club_name,short_name,social_links')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (alive && data)
          setSettings({
            club_name: data.club_name || 'Port Coquitlam Tennis Club',
            short_name: data.short_name || 'PCTC',
            social_links: Array.isArray(data.social_links) ? data.social_links : [],
          });
      });
    return () => {
      alive = false;
    };
  }, [suppliedClubName, suppliedShortName, suppliedSocialLinks]);
  const clubName = settings.club_name;
  const shortName = settings.short_name;
  const socialLinks = settings.social_links;
  return (
    <footer className="mt-auto border-t border-border py-6">
      <div className="page-container flex flex-col gap-4 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <Link href="/" className="flex items-center gap-3">
          <span className="brand-mark h-8 w-8 text-base">P</span>
          <span>
            <strong className="block text-sm text-foreground">{clubName}</strong>
            <span className="text-[9px] tracking-[0.2em]">{shortName}</span>
          </span>
        </Link>
        <div className="flex flex-wrap items-center gap-3">
          <Link href="/contacts" className="hover:text-foreground">
            Contacts
          </Link>
          <Link href="/legal/terms" className="hover:text-foreground">
            Terms &amp; Conditions
          </Link>
          <Link href="/legal/disclaimer" className="hover:text-foreground">
            Disclaimer
          </Link>
          {socialLinks.map((item, i) => {
            const u = item.url.toLowerCase();
            const Icon = /facebook\.com/.test(u)
              ? Facebook
              : /instagram\.com/.test(u)
                ? Instagram
                : /twitter\.com|x\.com/.test(u)
                  ? Twitter
                  : /youtube\.com|youtu\.be/.test(u)
                    ? Youtube
                    : /linkedin\.com/.test(u)
                      ? Linkedin
                      : /tiktok\.com/.test(u)
                        ? Music2
                        : LinkIcon;
            return (
              <a
                key={i}
                href={item.url}
                target="_blank"
                rel="noreferrer"
                aria-label={`Social media link ${i + 1}`}
                className="hover:text-foreground"
              >
                <Icon className="h-4 w-4" />
              </a>
            );
          })}
        </div>
        <span>
          © {new Date().getFullYear()} {clubName} ({shortName})
        </span>
      </div>
    </footer>
  );
}
