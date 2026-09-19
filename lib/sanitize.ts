// Strips real HTML tags from a body while leaving prose alone. Article bodies are stored and
// rendered as plain text (React escapes them), so this is a tidy-up, NOT an XSS boundary — if
// rich text is ever introduced, swap in an allow-list sanitizer (DOMPurify / sanitize-html).
//
// The pattern requires a letter after `<` (or `</`) and a closing `>`, so "x < y and z > w",
// "3<5" and "temperature < 0 degrees" survive untouched. The previous `/<[^>]*>?/g` treated
// every `<` as a tag opener and ate everything after it — irreversible data loss on any
// math/science/CS piece. An unterminated tag is deliberately left alone for the same reason.
//
// The strip repeats until the string stops changing: one pass can leave fragments that close
// up into a fresh tag (`<<a>script>alert(1)<</a>/script>` → `<script>alert(1)</script>`).
// The pass count is bounded so pathological input can't spin.
const TAG = /<\/?[a-zA-Z][^>]*>/g;
const MAX_PASSES = 10;

export function sanitizeHtml(dirty: string): string {
  let out = dirty;
  for (let i = 0; i < MAX_PASSES; i++) {
    const next = out.replace(TAG, "");
    if (next === out) break;
    out = next;
  }
  return out.trim();
}
