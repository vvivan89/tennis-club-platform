import { Callout, FieldTable, LinkButton, Steps, Topic } from '@/components/help-guide-primitives';

export function AdminDocumentsGuide() {
  return (
    <div className="space-y-5">
      <Topic id="admin-legal-documents" title="Maintain waiver, terms, and disclaimer versions">
        <p>
          The Documents tabs maintain Membership waiver, Terms of use, and Disclaimer text. Saving a
          change creates a new version; use the current version carefully because members’ waiver
          acceptance is tied to that version.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Document tab',
              value: 'Choose Membership waiver, Terms of use, or Disclaimer.',
              effect: 'Keeps each document’s version history and current text separate.',
            },
            {
              field: 'Title and body',
              value: 'Enter the approved title and full legal text in the editor.',
              effect: 'The document is shown with its saved version.',
            },
            {
              field: 'Save new version',
              value: 'Save only text approved for club use.',
              effect:
                'Preserves the previous version and makes the new version current; each member must accept the current waiver individually.',
            },
            {
              field: 'Previous versions',
              value:
                'Review older versions for context; do not treat an old acceptance as current when the version has changed.',
              effect: 'Provides history and the version used at earlier acceptance dates.',
            },
          ]}
        />
        <Callout>
          Waivers are individual, including in a family membership. Family payment requires each
          confirmed family member to accept the current waiver; there is no shared family waiver.
        </Callout>
        <Steps>
          <li>Select the document type and review the version currently in use.</li>
          <li>Enter approved text and save it as the next version.</li>
          <li>
            Check a member’s waiver status in Membership when helping with a checkout blocked by
            waiver acceptance.
          </li>
        </Steps>
      </Topic>
      <Topic id="admin-uploaded-documents" title="Upload member documents">
        <p>
          Use this section to share club bylaws, meeting minutes, and other documents with members.
        </p>
        <FieldTable
          rows={[
            {
              field: 'Document name',
              value: 'Enter the name members should recognize.',
              effect: 'Appears in the member documents list.',
            },
            {
              field: 'Description',
              value: 'Optionally explain what the document contains.',
              effect: 'Gives members context before they open it.',
            },
            {
              field: 'PDF file',
              value: 'Choose a PDF no larger than 20 MB.',
              effect: 'Uploads the document for active club members.',
            },
          ]}
        />
        <p>
          Uploaded PDFs are visible to approved members who have paid a membership fee, as well as
          admins. After upload, verify the document name and file from an account that should have
          access. Delete an uploaded document only when it should no longer be available; deletion
          cannot be undone from this page.
        </p>
        <p>
          <LinkButton href="/admin/documents">Open Documents</LinkButton>
        </p>
      </Topic>
    </div>
  );
}
