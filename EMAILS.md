# Emails sent through Resend

This document records the email subjects and message bodies currently sent through the app's Resend integration. Text in `{braces}` is filled in at send time. Names, event details, and links are HTML-escaped before being inserted, except for the administrator-authored announcement body, which is sanitized HTML.

## Events

### Event registration and event updates

These messages use the shared event notification layout. The subject and introductory paragraph depend on the notification type.

| Notification | Subject | Introductory paragraph |
| --- | --- | --- |
| Registration created, confirmed | `Registration confirmed: {event title}` | Your registration has been recorded. Your current registration status is shown below. |
| Registration created, waitlisted | `You're on the waitlist: {event title}` | Your registration has been recorded. Your current registration status is shown below. |
| Registration created, other status | `Your PCTC event registration` | Your registration has been recorded. Your current registration status is shown below. |
| Registration cancelled | `Your PCTC event registration was cancelled` | Your event registration has been cancelled. |
| Event cancelled | `PCTC event cancelled` | An event you registered for has been cancelled by the club. |
| Waitlist place confirmed | `Your place in a PCTC event is confirmed` | A place has opened and you have been moved from the waitlist to confirmed. |
| New event announced | `New PCTC event announced` | A new club event is available for registration. |

The body layout is:

```html
<p>Hello {member name or "member"},</p>
<p>{introductory paragraph from the table}</p>
<h2>{event title}</h2>
{for recurring events: <p><strong>Schedule:</strong> {schedule}.</p>}
<p><strong>{"Next session:" for recurring events, otherwise "Date:"}</strong>
  {event start date and time}{ · event location, when present}</p>
{for registration-created messages with a known status:
  <p><strong>Registration status:</strong> {status}</p>}
<p><a href="{event page URL}">View event details</a></p>
<p>Port Coquitlam Tennis Club</p>
```

Registration status text is `Your registration is confirmed.` or `You are on the waitlist` (with ` at position {queue position}` when known). Recurring schedules are rendered as `Every {weekday}`, `Every other {weekday}`, or `Monthly on the {ordinal} {weekday}`. Dates use the server's `en-CA` locale formatting.

### Registration opening reminder

Sent to members who have registration reminders enabled when registration opens, except members already registered or previously reminded for that event.

- **Subject:** `Registration is open: {event title}`
- **Body:**

```html
<p>Hello {member name or "member"},</p>
<p>Registration is now open for <strong>{event title}</strong>.</p>
<p>{event start date and time} · {event location}</p>
<p><a href="{event page URL}">View event and register</a></p>
```

### Pending event payment reminders

Sent when a confirmed event registration still needs payment, approximately 24 hours and one hour before its registration cutoff. The member's registration reminder preference is respected.

**About 24 hours before cutoff**

- **Subject:** `Payment required to keep your place: {event title}`
- The body says the registration is awaiting payment, gives the cutoff in Pacific time, and says the registration will be removed and the place may be given to another member if payment is not confirmed by the cutoff.

**About one hour before cutoff**

- **Subject:** `Final reminder: event payment due soon — {event title}`
- The body is the same as the 24-hour reminder, with `in about one hour` instead of `in about 24 hours`.

Both versions use this layout:

```html
<p>Hello {member name or "member"},</p>
<p>Your registration for <strong>{event title}</strong> is awaiting payment.
  The registration cutoff is {cutoff date and time} (Pacific time), in {about 24 hours | about one hour}.</p>
<p>If payment is not confirmed by the cutoff, your registration will be removed
  and your place may be given to another member.</p>
<p><a href="{event page URL}">Complete or check your event payment</a></p>
<p>Port Coquitlam Tennis Club</p>
```

### Tournament partner confirmation invitation

Sent to an invited partner who has an existing account. An event-only guest partner instead receives a Supabase Auth sign-in link, which is outside this Resend inventory.

- **Subject:** `Confirm your place with {inviting player's name}`
- **Body:**

```html
<p>Hello {invited player's name},</p>
<p>{inviting player's name} has listed you as a partner for
  <strong>{event title or "this event"}</strong>. Sign in to review the entry details
  and confirm your participation.</p>
<p><a href="{login URL leading to the event confirmation page}">Review and confirm your event entry</a></p>
<p>If you do not recognize this invitation, you can ignore this email.</p>
<p>Port Coquitlam Tennis Club</p>
```

### League event registration confirmation

Sent to both teammates after either teammate registers their already-fixed League team for a later event, and after an invited player confirms participation and the team becomes fixed. Each player's `email_registration_updates` preference is honored.

- **Subject:** `Registration confirmed: {event title}`
- **Body:**

```html
<p>Hello {player's name or "player"},</p>
<p>Your registration has been recorded. Your current registration status is shown below.</p>
<h2>{event title or "League event"}</h2>
<p><strong>Date:</strong> {event start date and time}{ · event location, when present}</p>
<p><strong>Registration status:</strong> Your registration is confirmed.</p>
<p><a href="{event page URL}">View event details</a></p>
<p>Port Coquitlam Tennis Club</p>
```

## Membership

### Membership renewal reminders

The recipient receives one of these based on whether the season starts in seven days or began seven days ago. Paid members and members covered by a paid family membership are excluded.

**Before the season starts**

- **Subject:** `PCTC membership renewal is coming up`
- **Body:**

```html
<p>Hello {member name or "member"},</p>
<p>The PCTC membership season begins on {season start date, YYYY-MM-DD}.
  Please renew your membership before the season starts.</p>
<p><a href="{member membership page URL}">View your member portal</a></p>
```

**After the season starts**

- **Subject:** `PCTC membership fee reminder`
- **Body:**

```html
<p>Hello {member name or "member"},</p>
<p>The PCTC membership season began on {season start date, YYYY-MM-DD} and we have not
  recorded a payment for you. Please renew your membership.</p>
<p><a href="{member membership page URL}">View your member portal</a></p>
```

### Family membership invitation

- **Subject:** `PCTC family membership invitation`
- **Body:**

```html
<p>Hello {invited member's name or "member"},</p>
<p>{inviting member's name, email, or "A member"} invited you to join their
  PCTC family membership.</p>
<p>Sign in to your Member Portal and confirm the invitation:
  <a href="{member membership page URL}">Review invitation</a>.</p>
```

## Payments

### Interac payment instructions

Sent when an Interac payment request is initiated, once per payment request.

- **Subject:** `PCTC Interac payment instructions`
- **Plain-text body:**

```text
Your PCTC Interac payment request is pending.

Amount: {amount with two decimals} CAD
Send to: {club Interac recipient email}
Payment reference: {payment ID}

{Interac instructions configured by the club}

Your membership or event registration will be finalized after the club confirms receipt.
```

### Interac payment review outcome

Sent after an administrator confirms or rejects an Interac payment request.

**Confirmed**

- **Subject:** `PCTC Interac payment confirmed`
- **Plain-text body:**

```text
Hello {member name or "member"},

The club has confirmed your Interac payment of {amount} {currency}. Your associated membership or event registration has been updated.

Payment reference: {payment ID}
```

**Rejected / needs attention**

- **Subject:** `PCTC Interac payment requires attention`
- **Plain-text body:**

```text
Hello {member name or "member"},

The club could not confirm your Interac payment request. Reason: {administrator's note or "Please contact the club."}

Payment reference: {payment ID}
```

## Membership applications

### Application approved

Sent when an administrator approves a membership application, if Resend is configured and the account has an email address.

- **Subject:** `Your PCTC application has been approved`
- **Body:**

```html
<p>Hello {applicant's name},</p>
<p>Your Port Coquitlam Tennis Club account has been approved. You can now sign in and access member features.</p>
<p><a href="{PCTC login URL}">Sign in to PCTC</a></p>
```

## Administrator announcements

Administrators can send a custom email to a selected recipient group. The subject and body are supplied in the admin form; the body is sanitized HTML. Resend wraps that body as follows:

```html
<p>Hello {recipient's name or "member"},</p>
{sanitized administrator-authored HTML body}
<p>Port Coquitlam Tennis Club</p>
```

## Notes

- The Resend sender address is configured by the server environment (`RESEND_FROM_EMAIL`, with supported fallbacks in some routes).
- Supabase Auth invitation, passwordless sign-in, and event-guest sign-in emails are not listed above because Supabase sends them directly rather than through Resend.
- Email preferences, timing windows, and eligibility rules are noted where they affect delivery; this document describes the message text, not a guarantee that every eligible recipient receives it (delivery can fail at the provider).
