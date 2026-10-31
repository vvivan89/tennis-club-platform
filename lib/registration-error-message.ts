export function registrationErrorMessage(
  error: unknown,
  genderRestriction?: string | null,
): string {
  const fields =
    error && typeof error === 'object'
      ? ['message', 'details', 'hint']
          .map((key) => {
            const value = (error as Record<string, unknown>)[key];
            return typeof value === 'string' ? value.trim() : '';
          })
          .filter(Boolean)
      : typeof error === 'string'
        ? [error.trim()].filter(Boolean)
        : [];
  const message =
    fields.find(
      (field) =>
        !/could not complete registration|could not update registration|registration-update-failed/i.test(
          field,
        ),
    ) ??
    fields[0] ??
    '';
  if (/gender|restricted to/i.test(message) && genderRestriction) {
    return `This event is restricted to ${genderRestriction} participants.`;
  }
  if (/active[\s,]+paid membership/i.test(message)) {
    return 'An active, paid membership is required to register for this event.';
  }
  if (!message || /registration-update-failed|could not update registration/i.test(message)) {
    return 'Could not complete registration. Please try again.';
  }
  return message;
}
