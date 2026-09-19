import {
  mapDirectoryUser,
  isDirectoryConfigured,
  sanitizeDirectoryQuery,
  buildDirectoryQuery,
} from "@/lib/google-directory";
import { directorySearchSchema } from "@/lib/validations";

describe("mapDirectoryUser", () => {
  it("maps a full directory user", () => {
    expect(
      mapDirectoryUser({
        primaryEmail: "jdoe@horacemann.org",
        name: { fullName: "Jane Doe" },
        thumbnailPhotoUrl: "https://photo",
      }),
    ).toEqual({ email: "jdoe@horacemann.org", name: "Jane Doe", photoUrl: "https://photo" });
  });

  it("falls back to email when name/photo missing", () => {
    expect(mapDirectoryUser({ primaryEmail: "x@horacemann.org" })).toEqual({
      email: "x@horacemann.org",
      name: "x@horacemann.org",
      photoUrl: null,
    });
  });

  it("returns null with no email", () => {
    expect(mapDirectoryUser({ name: { fullName: "No Email" } })).toBeNull();
  });
});

describe("isDirectoryConfigured", () => {
  const OLD = process.env;
  afterEach(() => {
    process.env = OLD;
  });

  it("false when env missing", () => {
    process.env = { ...OLD, GOOGLE_DIRECTORY_SA_KEY: "", GOOGLE_DIRECTORY_SUBJECT: "" };
    expect(isDirectoryConfigured()).toBe(false);
  });

  it("false when SA key is not valid JSON", () => {
    process.env = {
      ...OLD,
      GOOGLE_DIRECTORY_SA_KEY: "not-json",
      GOOGLE_DIRECTORY_SUBJECT: "admin@horacemann.org",
    };
    expect(isDirectoryConfigured()).toBe(false);
  });

  it("true with valid SA key + subject", () => {
    process.env = {
      ...OLD,
      GOOGLE_DIRECTORY_SA_KEY: JSON.stringify({ client_email: "sa@x.iam", private_key: "k" }),
      GOOGLE_DIRECTORY_SUBJECT: "admin@horacemann.org",
    };
    expect(isDirectoryConfigured()).toBe(true);
  });
});

describe("sanitizeDirectoryQuery", () => {
  it("passes through names, emails, apostrophes, dots and hyphens", () => {
    expect(sanitizeDirectoryQuery("jdoe@horacemann.org")).toBe("jdoe@horacemann.org");
    expect(sanitizeDirectoryQuery("Mary-Jane O'Brien")).toBe("Mary-Jane O'Brien");
  });

  it("strips the Admin SDK operators that make a predicate", () => {
    // `:` and `=` are what turn text into `field:value` / `field=value`; without them no extra
    // clause can be smuggled into the query string.
    for (const injection of [
      "a OR isAdmin=true OR name:",
      "x orgUnitPath=/Staff",
      'a" OR isSuspended=true',
      "a:b",
    ]) {
      const cleaned = sanitizeDirectoryQuery(injection);
      expect(cleaned).not.toMatch(/[:=/"]/);
    }
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeDirectoryQuery("  jane   doe  ")).toBe("jane doe");
  });

  it("caps the query at 100 characters", () => {
    expect(sanitizeDirectoryQuery("a".repeat(500))).toHaveLength(100);
  });
});

describe("buildDirectoryQuery", () => {
  it("builds the email/name prefix query from a sanitized value", () => {
    expect(buildDirectoryQuery("jane")).toBe("email:jane* OR name:jane*");
    expect(buildDirectoryQuery("  jane  ")).toBe("email:jane* OR name:jane*");
  });

  it("never lets user input introduce an operator", () => {
    const built = buildDirectoryQuery("a OR isAdmin=true OR name:");
    expect(built).not.toContain("=");
    // The only colons left are the two this function writes itself.
    expect(built.match(/:/g)).toHaveLength(2);
  });

  it("returns an empty string for an empty query", () => {
    expect(buildDirectoryQuery("   ")).toBe("");
    expect(buildDirectoryQuery("===")).toBe("");
  });
});

describe("directorySearchSchema", () => {
  it("accepts names and emails", () => {
    expect(directorySearchSchema.safeParse({ q: "jdoe@horacemann.org" }).success).toBe(true);
    expect(directorySearchSchema.safeParse({ q: "Mary-Jane O'Brien" }).success).toBe(true);
  });

  it("rejects query-language characters", () => {
    expect(directorySearchSchema.safeParse({ q: "a OR isAdmin=true" }).success).toBe(false);
    expect(directorySearchSchema.safeParse({ q: "name:jane" }).success).toBe(false);
    expect(directorySearchSchema.safeParse({ q: "<script>" }).success).toBe(false);
  });

  it("rejects empty and over-long queries", () => {
    expect(directorySearchSchema.safeParse({ q: "   " }).success).toBe(false);
    expect(directorySearchSchema.safeParse({ q: "a".repeat(101) }).success).toBe(false);
  });
});
