'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { X } from 'lucide-react';

type OrganizerContact = {
  organizer_name: string;
  position: string;
  emails: string[];
  phones: string[];
};

export function PublicTournamentOrganizerContacts({ eventId }: { eventId: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [contacts, setContacts] = useState<OrganizerContact[] | null>(null);

  async function showContacts() {
    setOpen(true);
    if (contacts || loading) return;
    setLoading(true);
    setError('');
    try {
      const response = await fetch(
        `/api/events/${encodeURIComponent(eventId)}/organizer-contacts`,
        {
          method: 'GET',
          headers: { Accept: 'application/json' },
          cache: 'no-store',
        },
      );
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not load organizer contacts.');
      setContacts(Array.isArray(result.contacts) ? result.contacts : []);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load organizer contacts.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button type="button" variant="outline" onClick={() => void showContacts()}>
        Show contacts
      </Button>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="public-organizer-contacts-title"
            className="w-full max-w-lg rounded-lg border border-border bg-background p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h2 id="public-organizer-contacts-title" className="text-lg font-semibold">
                Event organizer contacts
              </h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Close organizer contacts"
                className="rounded p-1 hover:bg-muted"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            {loading ? (
              <p role="status" className="mt-4 text-sm text-muted-foreground">
                Loading contacts…
              </p>
            ) : error ? (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            ) : !contacts?.length ? (
              <p className="mt-4 text-sm text-muted-foreground">
                No organizer contact details are available.
              </p>
            ) : (
              <div className="mt-4 space-y-4">
                {contacts.map((contact, index) => (
                  <div
                    key={`${contact.organizer_name}-${contact.position}-${index}`}
                    className="space-y-1"
                  >
                    <p className="font-medium">{contact.organizer_name}</p>
                    {contact.position && (
                      <p className="text-sm text-muted-foreground">{contact.position}</p>
                    )}
                    {contact.emails?.map((email) => (
                      <p key={email} className="text-sm">
                        <a className="text-primary underline" href={`mailto:${email}`}>
                          {email}
                        </a>
                      </p>
                    ))}
                    {contact.phones?.map((phone) => (
                      <p key={phone} className="text-sm">
                        <a className="text-primary underline" href={`tel:${phone}`}>
                          {phone}
                        </a>
                      </p>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
