// Strips real HTML tags from a body while leaving prose alone. Article bodies are stored and
// rendered as plain text (React escapes them), so this is a tidy-up, NOT an XSS boundary — if
// rich text is ever introduced, swap in an allow-list sanitizer (DOMPurify / sanitize-html).
//
// The pattern requires a letter after `<` (or `</`) and a closing `>`, so "x < y and z > w",
// "3<5" and "temperature < 0 degrees" survive untouched. The previous `/<[^>]*>?/g` treated
// every `<` as a tag opener and ate everything after it — irreversible data loss on any
// math/science/CS piece. An unterminated tag is deliberately left alone for the same reason.
export function sanitizeHtml(dirty: string): string {
  return dirty.replace(/<\/?[a-zA-Z][^>]*>/g, "").trim();
}
