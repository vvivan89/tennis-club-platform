/** Fire-and-forget request to send event notification emails; failures are only logged. */
export function dispatchEventNotificationsInBackground(
  eventIds: string | string[],
  logLabel: string,
) {
  const body = Array.isArray(eventIds) ? { eventIds } : { eventId: eventIds };
  void (async () => {
    try {
      const response = await fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.failed > 0)
        console.error(`[${logLabel}] Email notification dispatch failed`, {
          status: response.status,
          result,
        });
    } catch (error) {
      console.error(`[${logLabel}] Email notification request failed`, error);
    }
  })();
}
