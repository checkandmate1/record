import { sanitizeHtml } from "@/lib/sanitize";

describe("sanitizeHtml", () => {
  it("strips all HTML tags", () => {
    const input = "<p>Hello <strong>world</strong></p>";
    expect(sanitizeHtml(input)).toBe("Hello world");
  });

  it("strips script tags", () => {
    const input = '<p>Hello</p><script>alert("xss")</script>';
    expect(sanitizeHtml(input)).toBe('Helloalert("xss")');
  });

  it("strips event handlers", () => {
    const input = '<p onclick="alert(1)">Hello</p>';
    expect(sanitizeHtml(input)).toBe("Hello");
  });

  it("strips closing and self-closing tags", () => {
    expect(sanitizeHtml("before<br/>after")).toBe("beforeafter");
    expect(sanitizeHtml("<em>a</em> and <em>b</em>")).toBe("a and b");
  });

  it("leaves mathematical comparisons intact", () => {
    expect(sanitizeHtml("x < y and z > w")).toBe("x < y and z > w");
    expect(sanitizeHtml("if x < y then y > x")).toBe("if x < y then y > x");
  });

  it("leaves a bare less-than against a digit intact", () => {
    expect(sanitizeHtml("score was 3<5")).toBe("score was 3<5");
    expect(sanitizeHtml("a < b < c")).toBe("a < b < c");
  });

  it("does not eat the rest of the string after a stray <", () => {
    expect(sanitizeHtml("temperature < 0 degrees, and the river froze")).toBe(
      "temperature < 0 degrees, and the river froze",
    );
  });

  it("keeps prose around a stripped tag", () => {
    expect(sanitizeHtml("<em>a</em> < <em>b</em>")).toBe("a < b");
  });

  // Deliberate tradeoff: this is a tag stripper for plain-text bodies, not an XSS boundary
  // (nothing renders article bodies as HTML). An unterminated tag is left alone rather than
  // swallowing every character after it.
  it("leaves an unterminated tag and the text after it alone", () => {
    expect(sanitizeHtml("hello <img src=x onerror=alert(1)")).toBe(
      "hello <img src=x onerror=alert(1)",
    );
  });
});
