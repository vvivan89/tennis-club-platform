import { renderLegalDocumentPage } from '@/components/legal-document-page';

export default function TermsPage() {
  return renderLegalDocumentPage({
    documentType: 'terms_of_use',
    fallbackTitle: 'Terms of Use',
    fallbackBody: '<p>Terms of use have not been published yet.</p>',
  });
}
