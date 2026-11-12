# Project roadmap

Updated November 6, 2026. These items are planned work. This file is the persistent roadmap for future project work.

## Features

### 1. Email unsubscribe

- [x] Define which email types follow profile preferences and which are essential account or security messages.
- [x] Add secure unsubscribe links to preference-controlled emails.
- [x] Allow users to unsubscribe from that email type without signing in.
- [x] Save changes to the same preferences shown in the profile and show confirmation.

### 2. Chat push notifications

- [x] Add **Enable push notifications** to the profile.
- [x] Request browser permission and save each device's subscription.
- [x] Allow users to disable push notifications and remove saved subscriptions.
- [x] Send push notifications only for new chat messages, respecting both the existing chat notification preference and the push-enabled setting.
- [x] Prevent duplicate notifications and exclude the message sender.
- [x] Stop using expired or revoked subscriptions.
- [x] Verify permission denial, multiple devices, preference changes, and revoked subscriptions.
- [x] Document notification settings and behavior for users and admins.

### 3. Beta notice

- [x] Display a message at the very top of the page stating that the app is in beta.

### 4. Compact navigation on narrow screens

- [x] Change the menu to take less space on mobile devices and all other narrow screens.
- [x] Keep navigation usable and accessible across narrow screen sizes.

### 5. Selectable color themes

- [x] Extend the app's existing theme system with a couple of additional color themes, including blue and potentially orange, while keeping the current theme available.
- [x] Add a theme selector to the user's profile settings and apply the selected theme consistently across the app.
- [x] Persist each user's selected theme in the database so it survives reloads and sign-ins and follows the user across devices.
- [x] Use the current theme as the default for users without a saved selection.
- [x] Verify readable text, accessible contrast, and consistent component states for every theme.

## Project-wide work

### End-to-end testing

- [ ] Expand the existing Playwright E2E suite across the whole project, including core member and administrator journeys and the new features above.
- [ ] Cover authentication, profiles and preferences, membership, events and registration, payments, chat, and access restrictions.
- [ ] Include email unsubscribe flows and chat push settings/delivery, with controlled test email and push services.
- [ ] Verify responsive navigation and the beta notice across relevant screen sizes.
- [ ] Verify theme selection applies across the app and persists after reload, sign-out/sign-in, and on another device.
- [ ] Use isolated test data and document setup, execution, and cleanup.
- [ ] Run E2E checks in CI and as part of release verification.

### Beta testing with actual club members

- [ ] Arrange beta testing with actual club members across representative devices and screen sizes.
- [ ] Have members exercise real club workflows, including the new features.
- [ ] Provide a clear way to report bugs and usability feedback.
- [ ] Triage feedback, fix release-blocking issues, and verify fixes with testers before broader release.
