import { Callout, FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminPublicationsGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-publication-news" title="Publish website news">
        <FieldTable
          rows={[
            {
              field: 'Title',
              value: 'Enter a clear headline for the news item.',
              effect: 'Used on the public home page and the news item.',
            },
            {
              field: 'Body',
              value: 'Write the article text using the editor.',
              effect: 'Provides the content visitors read.',
            },
            {
              field: 'Publish/unpublish',
              value: 'Keep a draft while reviewing; publish when ready.',
              effect:
                'Published news is visible on the public site. Unpublishing removes it from public news without sending an email.',
            },
          ]}
        />
        <p>
          Website news and email announcements are separate. Publishing a news item will only send
          it to members’ inboxes if they selected to receive news notifications in their profile
          settings.
        </p>
      </Topic>
      <Topic id="admin-publication-announcements" title="Send an email announcement">
        <FieldTable
          rows={[
            {
              field: 'Subject and message',
              value: 'Enter the email subject and body; review formatting before sending.',
              effect: 'This content is delivered by email, not published as website news.',
            },
            {
              field: 'Recipient group',
              value:
                'Choose All approved members, Active members, Administrators, Organizers, or Newsletter subscribers.',
              effect:
                'Controls the target audience. Newsletter subscribers follow newsletter preferences; the approved-member group is not the same as that opt-in list.',
            },
            {
              field: 'Confirmation count',
              value: 'Review the displayed number of intended recipients before confirming.',
              effect: 'Provides a final audience check before the send begins.',
            },
            {
              field: 'Sent history',
              value: 'Review sent time, audience, and successful/failed counts.',
              effect: 'Helps establish which announcement was sent and its delivery summary.',
            },
          ]}
        />
        <Callout>
          Choosing All approved members, Active members, Administrators, or Organizers sends the
          announcement regardless of each recipient’s email profile preferences. Use these groups
          only for the most important information. Newsletter subscribers follow their newsletter
          preference.
        </Callout>
        <Steps>
          <li>Write and proofread the subject and message.</li>
          <li>Select the intended recipient group and check the confirmation count.</li>
          <li>Confirm the send, then review sent history and the success/failure totals.</li>
        </Steps>
      </Topic>
      <Topic id="admin-publication-gallery" title="Manage photo albums and visibility">
        <FieldTable
          rows={[
            {
              field: 'Album title and description',
              value: 'Name the album and optionally describe its contents.',
              effect: 'Labels the album to visitors.',
            },
            {
              field: 'Visibility',
              value: 'Choose Public or Members only.',
              effect:
                'Public albums can be viewed by anyone; Members only requires an approved member with paid membership.',
            },
            {
              field: 'Publish album immediately',
              value: 'Enable when the album is ready to appear.',
              effect:
                'Draft albums are not shown in the public Gallery; public albums may be featured on the home page.',
            },
            {
              field: 'Album and images',
              value:
                'Choose an album, upload JPEG/PNG/WebP images up to 10 MB each, then edit captions/alt text and ordering.',
              effect: 'Adds images to that album and provides their display text and sequence.',
            },
          ]}
        />
        <p>
          Changing an album from Public to Members only changes its audience. Before publishing
          photos, confirm the people pictured have agreed to the intended audience.
        </p>
        <p>
          <LinkButton href="/admin/website">Open Publications</LinkButton>
        </p>
      </Topic>
    </div>
  );
}
