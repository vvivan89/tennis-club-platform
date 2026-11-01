/** Fire-and-forget request to send event notification emails; failures are only logged. */
export function dispatchEventNotificationsInBackground(eventId: string, logLabel: string) {
  void (async () => {
    try {
      const response = await fetch('/api/notifications/dispatch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ eventId }),
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
