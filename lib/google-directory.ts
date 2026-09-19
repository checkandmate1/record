// Use the modular @googleapis/admin package (just the Admin SDK Directory API) instead of the
// monolithic `googleapis` — the latter bundles types for every Google API and OOM-kills the
// production build on the 1 GB Linode box.
import { admin, auth as googleAuth } from "@googleapis/admin";
import { DIRECTORY_QUERY_CHAR_CLASS } from "@/lib/validations";

const SCOPES = ["https://www.googleapis.com/auth/admin.directory.user.readonly"];

export type DirectoryPerson = { email: string; name: string; photoUrl: string | null };

type ServiceAccountKey = { client_email: string; private_key: string };

// Reads the service-account JSON + admin subject from env. Returns null when either is missing
// so the whole feature degrades gracefully (search endpoint reports "not configured").
function getCreds(): { key: ServiceAccountKey; subject: string } | null {
  const raw = process.env.GOOGLE_DIRECTORY_SA_KEY;
  const subject = process.env.GOOGLE_DIRECTORY_SUBJECT;
  if (!raw || !subject) return null;
  let key: ServiceAccountKey;
  try {
    key = JSON.parse(raw) as ServiceAccountKey;
  } catch {
    return null;
  }
  if (!key.client_email || !key.private_key) return null;
  return { key, subject };
}

export function isDirectoryConfigured(): boolean {
  return getCreds() !== null;
}

// Maps a raw Admin SDK user object to our shape. Exported for unit testing (pure function).
export function mapDirectoryUser(u: {
  primaryEmail?: string | null;
  name?: { fullName?: string | null } | null;
  thumbnailPhotoUrl?: string | null;
}): DirectoryPerson | null {
  const email = u.primaryEmail ?? null;
  if (!email) return null;
  return {
    email,
    name: u.name?.fullName ?? email,
    photoUrl: u.thumbnailPhotoUrl ?? null,
  };
}

async function directoryClient() {
  const creds = getCreds();
  if (!creds) throw new Error("Google directory not configured");
  const jwt = new googleAuth.JWT({
    email: creds.key.client_email,
    key: creds.key.private_key,
    scopes: SCOPES,
    subject: creds.subject,
  });
  await jwt.authorize();
  return admin({ version: "directory_v1", auth: jwt });
}

// Negated form of the allow-list in `lib/validations.ts` — built from the same exported string
// so the schema and this stripper can never drift apart.
const DISALLOWED = new RegExp(`[^${DIRECTORY_QUERY_CHAR_CLASS}]+`, "gu");

// Defence in depth for the Directory query language (`field:value`, `field=value`, `OR`).
// `directorySearchSchema` already rejects anything outside the allow-list at the API boundary;
// this strips it again here so a direct call can't build a predicate either. `:` and `=` are
// what make a predicate, so removing them is what actually closes the injection.
export function sanitizeDirectoryQuery(query: string): string {
  return query
    .replace(DISALLOWED, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100)
    .trim();
}

// The Admin SDK query for a prefix match on email or full name. Exported for unit testing.
export function buildDirectoryQuery(query: string): string {
  const q = sanitizeDirectoryQuery(query);
  if (!q) return "";
  return `email:${q}* OR name:${q}*`;
}

export async function searchDirectory(query: string): Promise<DirectoryPerson[]> {
  const q = buildDirectoryQuery(query);
  if (!q) return [];
  const dir = await directoryClient();
  const res = await dir.users.list({
    customer: "my_customer",
    query: q,
    viewType: "domain_public",
    maxResults: 10,
    orderBy: "email",
  });
  return (res.data.users ?? [])
    .map(mapDirectoryUser)
    .filter((u): u is DirectoryPerson => u !== null);
}

export async function getDirectoryUserByEmail(email: string): Promise<DirectoryPerson | null> {
  const dir = await directoryClient();
  try {
    const res = await dir.users.get({ userKey: email, viewType: "domain_public" });
    return mapDirectoryUser(res.data);
  } catch {
    return null;
  }
}
