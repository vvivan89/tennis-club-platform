import sanitize from 'sanitize-html';

const options: sanitize.IOptions = {
  allowedTags: [
    'p',
    'br',
    'hr',
    'div',
    'span',
    'strong',
    'b',
    'em',
    'i',
    'u',
    's',
    'code',
    'pre',
    'blockquote',
    'h1',
    'h2',
    'h3',
    'h4',
    'h5',
    'h6',
    'ul',
    'ol',
    'li',
    'a',
    'table',
    'thead',
    'tbody',
    'tr',
    'th',
    'td',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'rel'],
    th: ['colspan', 'rowspan'],
    td: ['colspan', 'rowspan'],
  },
  allowedSchemes: ['http', 'https', 'mailto', 'tel'],
  allowProtocolRelative: false,
  transformTags: {
    a: sanitize.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }, true),
  },
};

/** Whitelist-based sanitizer for admin-authored rich text; identical on server and client. */
export function sanitizeHtml(input: string | null | undefined): string {
  return sanitize(input ?? '', options);
}
