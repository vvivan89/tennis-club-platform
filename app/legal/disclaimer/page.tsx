import { renderLegalDocumentPage } from '@/components/legal-document-page';

export default function DisclaimerPage() {
  return renderLegalDocumentPage({
    documentType: 'disclaimer',
    fallbackTitle: 'Disclaimer',
    fallbackBody: '<p>Disclaimer has not been published yet.</p>',
  });
}
