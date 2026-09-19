// Minimal in-memory stand-in for @prisma/client, good enough to drive the real envelope-encryption
// extension in lib/prisma.ts (see __tests__/lib/envelope.test.ts). It is NOT a Prisma emulator:
// it covers User / Article / ArticleCredit and the handful of operations the envelope pipeline
// touches (create incl. nested create, findUnique, findMany, update, updateMany, delete).
//
// Rows are stored as plain objects; Bytes columns hold Buffers, exactly as the pg adapter would
// hand them back (well, as Uint8Array — Buffer is a Uint8Array, and the extension coerces).
//
// Not a *.test.ts file, so Jest's testMatch ignores it.

type Row = Record<string, unknown>;

export type Store = Record<string, Row[]>;

const MODELS = ["user", "article", "articleCredit"] as const;
type ModelName = (typeof MODELS)[number];

// Column shape per model: every column the schema has, so a full (select-less) read returns the
// envelope columns the read path needs. Plaintext columns are NULL on disk post-Phase-5.
const COLUMNS: Record<ModelName, Row> = {
  user: {
    id: null,
    email: null,
    name: null,
    image: null,
    googleImage: null,
    role: "READER",
    isPlaceholder: false,
    emailCiphertext: null,
    emailHash: null,
    nameCiphertext: null,
    imageCiphertext: null,
    encryptedDek: null,
    dekKekVersion: null,
    createdAt: null,
  },
  article: {
    id: null,
    title: null,
    slug: null,
    body: null,
    featuredImage: null,
    section: null,
    createdById: null,
    bodyCiphertext: null,
    featuredImageCiphertext: null,
    encryptedDek: null,
    dekKekVersion: null,
    createdAt: null,
  },
  articleCredit: {
    id: null,
    articleId: null,
    userId: null,
    creditRole: null,
    creditRoleCiphertext: null,
    creditRoleHash: null,
    encryptedDek: null,
    dekKekVersion: null,
    createdAt: null,
  },
};

// relationName -> { model, foreignKey, list }
const RELATIONS: Record<ModelName, Record<string, { model: ModelName; fk: string; list: boolean }>> = {
  user: { articles: { model: "article", fk: "createdById", list: true } },
  article: {
    credits: { model: "articleCredit", fk: "articleId", list: true },
    createdBy: { model: "user", fk: "id", list: false },
  },
  articleCredit: { article: { model: "article", fk: "id", list: false } },
};

export const __store: Store = { user: [], article: [], articleCredit: [] };

export function __resetStore(): void {
  for (const m of MODELS) __store[m] = [];
}

export function __rows(model: ModelName): Row[] {
  return __store[model];
}

let idCounter = 0;

function bytesEqual(a: unknown, b: unknown): boolean {
  if (!(a instanceof Uint8Array) || !(b instanceof Uint8Array)) return false;
  return Buffer.from(a).equals(Buffer.from(b));
}

function valueMatches(rowValue: unknown, condition: unknown): boolean {
  if (condition instanceof Uint8Array) return bytesEqual(rowValue, condition);
  if (condition !== null && typeof condition === "object") {
    const ops = condition as Record<string, unknown>;
    if ("equals" in ops) return valueMatches(rowValue, ops.equals);
    if ("in" in ops && Array.isArray(ops.in)) {
      return (ops.in as unknown[]).some((v) => valueMatches(rowValue, v));
    }
    if ("not" in ops) return !valueMatches(rowValue, ops.not);
    return false;
  }
  return rowValue === condition;
}

function matches(row: Row, where: Row | undefined): boolean {
  if (!where) return true;
  return Object.entries(where).every(([k, v]) => valueMatches(row[k], v));
}

function project(model: ModelName, row: Row, args: Row): Row {
  const select = args.select as Record<string, unknown> | undefined;
  const include = args.include as Record<string, unknown> | undefined;
  const out: Row = {};

  if (select) {
    for (const [key, want] of Object.entries(select)) {
      if (!want) continue;
      const rel = RELATIONS[model][key];
      if (rel) {
        out[key] = resolveRelation(model, row, key, want === true ? {} : (want as Row));
      } else {
        out[key] = row[key];
      }
    }
    return out;
  }

  Object.assign(out, row);
  if (include) {
    for (const [key, want] of Object.entries(include)) {
      if (!want) continue;
      if (!RELATIONS[model][key]) continue;
      out[key] = resolveRelation(model, row, key, want === true ? {} : (want as Row));
    }
  }
  return out;
}

function resolveRelation(model: ModelName, row: Row, name: string, subArgs: Row): unknown {
  const rel = RELATIONS[model][name];
  if (!rel) return undefined;
  if (rel.list) {
    return __store[rel.model]
      .filter((r) => r[rel.fk] === row.id)
      .map((r) => project(rel.model, { ...r }, subArgs));
  }
  // to-one: article.createdBy joins on user.id === row.createdById
  const fkValue = name === "createdBy" ? row.createdById : row[rel.fk];
  const target = __store[rel.model].find((r) => r.id === fkValue);
  return target ? project(rel.model, { ...target }, subArgs) : null;
}

function applyNestedCreates(model: ModelName, parent: Row, data: Row): void {
  for (const [name, rel] of Object.entries(RELATIONS[model])) {
    const value = data[name];
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    const block = value as Record<string, unknown>;
    const items: Row[] = [];
    if (block.create) {
      const created = Array.isArray(block.create) ? block.create : [block.create];
      for (const item of created) if (item && typeof item === "object") items.push(item as Row);
    }
    if (block.createMany && typeof block.createMany === "object") {
      const inner = block.createMany as Record<string, unknown>;
      if (Array.isArray(inner.data)) {
        for (const item of inner.data) if (item && typeof item === "object") items.push(item as Row);
      }
    }
    if (!rel.list) continue;
    for (const item of items) {
      insert(rel.model, { ...item, [rel.fk]: parent.id });
    }
    delete data[name];
  }
}

function insert(model: ModelName, data: Row): Row {
  const row: Row = { ...COLUMNS[model] };
  const payload = { ...data };
  row.id = typeof payload.id === "string" ? payload.id : `${model}-${++idCounter}`;
  row.createdAt = new Date("2026-01-02T03:04:05.000Z");
  applyNestedCreates(model, row, payload);
  for (const [k, v] of Object.entries(payload)) {
    if (v !== undefined && typeof v === "object" && v !== null && !Array.isArray(v) && !(v instanceof Uint8Array) && !(v instanceof Date)) {
      // nested relation blocks we do not model (connect etc.) — ignore
      continue;
    }
    row[k] = v;
  }
  __store[model].push(row);
  return row;
}

function delegate(model: ModelName) {
  return {
    create: async (args: Row) => {
      const row = insert(model, (args.data ?? {}) as Row);
      return project(model, { ...row }, args);
    },
    createMany: async (args: Row) => {
      const items = Array.isArray(args.data) ? (args.data as Row[]) : [args.data as Row];
      for (const item of items) insert(model, item);
      return { count: items.length };
    },
    // Present so the envelope pipeline can be tested against a writing operation it does not
    // implement; it must never actually run.
    createManyAndReturn: async (args: Row) => {
      const items = Array.isArray(args.data) ? (args.data as Row[]) : [args.data as Row];
      return items.map((item) => project(model, { ...insert(model, item) }, args));
    },
    findUnique: async (args: Row) => {
      const row = __store[model].find((r) => matches(r, args.where as Row));
      return row ? project(model, { ...row }, args) : null;
    },
    findFirst: async (args: Row) => {
      const row = __store[model].find((r) => matches(r, args.where as Row));
      return row ? project(model, { ...row }, args) : null;
    },
    findMany: async (args: Row) => {
      return __store[model]
        .filter((r) => matches(r, (args.where ?? {}) as Row))
        .map((r) => project(model, { ...r }, args));
    },
    update: async (args: Row) => {
      const row = __store[model].find((r) => matches(r, args.where as Row));
      if (!row) throw new Error(`fake-prisma: ${model}.update found no row`);
      const data = { ...((args.data ?? {}) as Row) };
      applyNestedCreates(model, row, data);
      Object.assign(row, data);
      return project(model, { ...row }, args);
    },
    updateMany: async (args: Row) => {
      const rows = __store[model].filter((r) => matches(r, (args.where ?? {}) as Row));
      for (const row of rows) Object.assign(row, (args.data ?? {}) as Row);
      return { count: rows.length };
    },
    delete: async (args: Row) => {
      const idx = __store[model].findIndex((r) => matches(r, args.where as Row));
      if (idx < 0) throw new Error(`fake-prisma: ${model}.delete found no row`);
      const [row] = __store[model].splice(idx, 1);
      return project(model, { ...row }, args);
    },
    deleteMany: async (args: Row) => {
      const before = __store[model].length;
      __store[model] = __store[model].filter((r) => !matches(r, (args.where ?? {}) as Row));
      return { count: before - __store[model].length };
    },
    count: async (args: Row) =>
      __store[model].filter((r) => matches(r, (args?.where ?? {}) as Row)).length,
  };
}

type QueryHook = (params: {
  model: string;
  operation: string;
  args: Row;
  query: (args: Row) => Promise<unknown>;
}) => Promise<unknown>;

export class PrismaClient {
  constructor(_options?: unknown) {
    for (const model of MODELS) {
      (this as unknown as Record<string, unknown>)[model] = delegate(model);
    }
  }

  // Mirrors the shape lib/prisma.ts uses: $extends({ query: { $allOperations } }).
  $extends(extension: { query?: { $allOperations?: QueryHook } }) {
    const hook = extension.query?.$allOperations;
    const self = this as unknown as Record<string, Record<string, (args: Row) => Promise<unknown>>>;
    if (!hook) return this;

    const wrapped: Record<string, unknown> = {};
    for (const model of MODELS) {
      const base = self[model];
      const proxied: Record<string, (args: Row) => Promise<unknown>> = {};
      for (const operation of Object.keys(base)) {
        proxied[operation] = (args: Row = {}) =>
          hook({
            model,
            operation,
            args,
            query: (finalArgs: Row) => base[operation](finalArgs),
          }) as Promise<unknown>;
      }
      wrapped[model] = proxied;
    }
    wrapped.$transaction = async (arg: unknown) => {
      if (typeof arg === "function") return (arg as (tx: unknown) => unknown)(wrapped);
      if (Array.isArray(arg)) return Promise.all(arg);
      return undefined;
    };
    return wrapped;
  }
}
