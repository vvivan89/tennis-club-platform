'use client';

import { useState } from 'react';
import { createSupabaseBrowserClient } from '@/lib/supabase-browser';

type OrganizerContact = {
  organizer_id: string;
  organizer_name: string;
  position: string;
  emails: string[];
  phones: string[];
};

export function PublicOrganizerContacts({
  eventId,
  organizerNames,
}: {
  eventId: string;
  organizerNames: string[];
}) {
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
      const db = createSupabaseBrowserClient();
      const { data, error: queryError } = await db.rpc(
        'event_public_tournament_organizer_contact_details',
        {
          p_event_id: eventId,
        },
      );
      if (queryError) throw queryError;
      setContacts((data ?? []) as OrganizerContact[]);
    } catch {
      setError('Organizer contacts could not be loaded. Please try again later.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="my-6 border-y border-border py-5" aria-labelledby="event-organizer-title">
      <h2 id="event-organizer-title" className="text-lg font-semibold">
        Event organizer
      </h2>
      <div className="mt-2 flex items-center justify-between gap-4">
        {organizerNames.length > 0 ? (
          <ul className="space-y-1 text-sm">
            {organizerNames.map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
          </ul>
        ) : (
          <span className="text-sm text-muted-foreground">Organizer information</span>
        )}
        <button
          type="button"
          className="h-9 shrink-0 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          onClick={() => void showContacts()}
        >
          Show contacts
        </button>
      </div>
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-overlay/50 p-4"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setOpen(false);
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="organizer-contact-dialog-title"
            className="max-h-[85vh] w-full max-w-xl overflow-auto rounded-lg border border-border bg-background p-5 shadow-xl"
          >
            <div className="flex items-start justify-between gap-4">
              <h3 id="organizer-contact-dialog-title" className="text-lg font-semibold">
                Organizer contacts
              </h3>
              <button
                type="button"
                className="rounded-md px-2 py-1 text-sm hover:bg-muted"
                onClick={() => setOpen(false)}
                aria-label="Close organizer contacts"
              >
                Close
              </button>
            </div>
            {loading && <p className="mt-4 text-sm text-muted-foreground">Loading contacts…</p>}
            {error && (
              <p role="alert" className="mt-4 text-sm text-destructive">
                {error}
              </p>
            )}
            {contacts && contacts.length === 0 && (
              <p className="mt-4 text-sm text-muted-foreground">
                No public contact information is available.
              </p>
            )}
            {!!contacts?.length && (
              <div className="mt-4 space-y-4">
                {contacts.map((contact) => (
                  <div
                    key={`${contact.organizer_id}-${contact.position}`}
                    className="border-t border-border pt-3"
                  >
                    <p className="font-medium">{contact.organizer_name}</p>
                    <p className="text-sm text-muted-foreground">{contact.position}</p>
                    {!!contact.emails?.length && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {contact.emails.map((email) => (
                          <li key={email}>
                            <a className="text-primary underline" href={`mailto:${email}`}>
                              {email}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                    {!!contact.phones?.length && (
                      <ul className="mt-2 space-y-1 text-sm">
                        {contact.phones.map((phone) => (
                          <li key={phone}>
                            <a className="text-primary underline" href={`tel:${phone}`}>
                              {phone}
                            </a>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}
    </section>
  );
}
