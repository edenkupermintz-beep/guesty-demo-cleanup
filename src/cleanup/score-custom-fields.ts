import type {
  CustomFieldCatalogEntry,
  CustomFieldObject,
  CustomFieldType,
} from "./zero-state.js";

export type LiveCustomField = {
  id?: string;
  _id?: string;
  /** Guesty account custom-fields list uses `fieldId`. */
  fieldId?: string;
  key?: string;
  object?: string;
  type?: string;
  isPublic?: boolean;
  displayName?: string;
  options?: string[];
};

export type CustomFieldDeleteOp = {
  op: "delete_custom_field";
  fieldId: string;
  key: string;
  object: string;
  type: string;
  reason: string;
};

export type CustomFieldCreateOp = {
  op: "create_custom_field";
  key: string;
  object: CustomFieldObject;
  type: CustomFieldType;
  isPublic: boolean;
  options?: string[];
  displayName?: string;
  reason: string;
};

export type CustomFieldFixOptionsOp = {
  op: "update_custom_field_options";
  fieldId: string;
  key: string;
  object: CustomFieldObject;
  type: "enum";
  isPublic: boolean;
  options: string[];
  beforeOptions: string[];
  reason: string;
};

export type CustomFieldMutation =
  | CustomFieldDeleteOp
  | CustomFieldCreateOp
  | CustomFieldFixOptionsOp;

export type CustomFieldScoreResult = {
  metric: "dirtyCount";
  liveCount: number;
  catalogCount: number;
  keep: number;
  dirtyCount: number;
  toDelete: CustomFieldDeleteOp[];
  toCreate: CustomFieldCreateOp[];
  toFixOptions: CustomFieldFixOptionsOp[];
  sample: CustomFieldMutation[];
};

function fieldId(f: LiveCustomField): string {
  return String(f.fieldId || f.id || f._id || "");
}

function catalogKey(entry: { key: string; object: string }): string {
  return `${entry.object}::${entry.key}`;
}

function optionsEqual(a: string[] | undefined, b: string[] | undefined): boolean {
  const left = a ?? [];
  const right = b ?? [];
  if (left.length !== right.length) return false;
  return left.every((v, i) => v === right[i]);
}

/**
 * Compare live account custom-field definitions to the zero-state catalog.
 * Match by key + object (+ type). Plan deletes, creates, and enum option fixes.
 */
export function scoreCustomFields(
  live: LiveCustomField[],
  catalog: CustomFieldCatalogEntry[],
): CustomFieldScoreResult {
  const toDelete: CustomFieldDeleteOp[] = [];
  const toCreate: CustomFieldCreateOp[] = [];
  const toFixOptions: CustomFieldFixOptionsOp[] = [];
  let keep = 0;

  const catalogByKey = new Map<string, CustomFieldCatalogEntry>();
  for (const entry of catalog) {
    catalogByKey.set(catalogKey(entry), entry);
  }

  /** First matching live field claimed per catalog key. */
  const claimed = new Map<string, LiveCustomField>();

  for (const field of live) {
    const id = fieldId(field);
    const key = String(field.key ?? "");
    const object = String(field.object ?? "");
    const type = String(field.type ?? "");
    const ck = catalogKey({ key, object });
    const wanted = catalogByKey.get(ck);

    if (!wanted) {
      toDelete.push({
        op: "delete_custom_field",
        fieldId: id,
        key,
        object,
        type,
        reason: "not_in_catalog",
      });
      continue;
    }

    if (claimed.has(ck)) {
      toDelete.push({
        op: "delete_custom_field",
        fieldId: id,
        key,
        object,
        type,
        reason: "duplicate_key",
      });
      continue;
    }

    if (type !== wanted.type) {
      // Type is immutable — delete then recreate.
      toDelete.push({
        op: "delete_custom_field",
        fieldId: id,
        key,
        object,
        type,
        reason: "wrong_type",
      });
      // Leave unclaimed so create path runs for this catalog entry.
      continue;
    }

    claimed.set(ck, field);

    if (wanted.type === "enum" && !optionsEqual(field.options, wanted.options)) {
      toFixOptions.push({
        op: "update_custom_field_options",
        fieldId: id,
        key: wanted.key,
        object: wanted.object,
        type: "enum",
        isPublic: wanted.isPublic,
        options: wanted.options ?? [],
        beforeOptions: field.options ?? [],
        reason: "options_drift",
      });
      continue;
    }

    keep += 1;
  }

  for (const entry of catalog) {
    const ck = catalogKey(entry);
    if (claimed.has(ck)) continue;
    toCreate.push({
      op: "create_custom_field",
      key: entry.key,
      object: entry.object,
      type: entry.type,
      isPublic: entry.isPublic,
      options: entry.type === "enum" ? (entry.options ?? []) : undefined,
      displayName: entry.displayName,
      reason: "missing",
    });
  }

  const dirtyCount = toDelete.length + toCreate.length + toFixOptions.length;
  const sample = [...toDelete, ...toFixOptions, ...toCreate].slice(0, 12);

  return {
    metric: "dirtyCount",
    liveCount: live.length,
    catalogCount: catalog.length,
    keep,
    dirtyCount,
    toDelete,
    toCreate,
    toFixOptions,
    sample,
  };
}

/** Build ordered mutations: deletes → option fixes → creates. */
export function buildCustomFieldsPlan(
  live: LiveCustomField[],
  catalog: CustomFieldCatalogEntry[],
): {
  score: CustomFieldScoreResult;
  mutations: CustomFieldMutation[];
} {
  const score = scoreCustomFields(live, catalog);
  return {
    score,
    mutations: [...score.toDelete, ...score.toFixOptions, ...score.toCreate],
  };
}
