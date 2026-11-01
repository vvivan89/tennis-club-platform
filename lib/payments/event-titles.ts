import 'server-only';
import { createPaymentServiceClient } from '@/lib/payments/server';

type PaymentReference = {
  id: string;
  purpose: string;
  business_record_id: string | null;
};

type PaymentDatabase = ReturnType<typeof createPaymentServiceClient>;

export async function loadPaymentEventTitles(
  db: PaymentDatabase,
  payments: readonly PaymentReference[],
) {
  const registrationIds = [
    ...new Set(
      payments
        .filter((payment) => payment.purpose === 'event_registration' && payment.business_record_id)
        .map((payment) => payment.business_record_id as string),
    ),
  ];
  const tournamentParticipantIds = [
    ...new Set(
      payments
        .filter(
          (payment) => payment.purpose === 'tournament_registration' && payment.business_record_id,
        )
        .flatMap((payment) =>
          (payment.business_record_id as string).split(',').map((id) => id.trim()),
        )
        .filter(Boolean),
    ),
  ];

  const [{ data: registrations }, { data: participants }] = await Promise.all([
    registrationIds.length
      ? db.from('registrations').select('id,event_id').in('id', registrationIds)
      : Promise.resolve({ data: [] }),
    tournamentParticipantIds.length
      ? db.from('tournament_participants').select('id,event_id').in('id', tournamentParticipantIds)
      : Promise.resolve({ data: [] }),
  ]);
  const records = [
    ...((registrations ?? []) as Array<{ id: string; event_id: string }>),
    ...((participants ?? []) as Array<{ id: string; event_id: string }>),
  ];
  const eventIds = [...new Set(records.map((record) => record.event_id))];
  const { data: events } = eventIds.length
    ? await db.from('events').select('id,title').in('id', eventIds)
    : { data: [] };
  const eventTitles = new Map(
    ((events ?? []) as Array<{ id: string; title: string }>).map((event) => [
      event.id,
      event.title,
    ]),
  );
  const eventIdByRecordId = new Map(records.map((record) => [record.id, record.event_id]));

  return new Map(
    payments.map((payment) => {
      const relatedRecordIds =
        payment.purpose === 'event_registration'
          ? [payment.business_record_id]
          : payment.purpose === 'tournament_registration'
            ? (payment.business_record_id ?? '').split(',').map((id) => id.trim())
            : [];
      const title = relatedRecordIds
        .map((id) => (id ? eventIdByRecordId.get(id) : undefined))
        .map((eventId) => (eventId ? eventTitles.get(eventId) : undefined))
        .find(Boolean);
      return [payment.id, title ?? null];
    }),
  );
}
