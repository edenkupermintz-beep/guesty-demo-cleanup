import { hasGuestyAuthConfigured, loadConfig } from "../guesty/config.js";
import { GuestyWriteClient } from "../guesty/write-client.js";
import type {
  ApplyPlanReport,
  CleanupMutation,
  MutationPlan,
  MutationResult,
} from "./types.js";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function applyMutationPlan(
  plan: MutationPlan,
  options: {
    apply: boolean;
    pauseMsBetweenCalls?: number;
  },
): Promise<ApplyPlanReport> {
  const dryRun = !options.apply;
  let tokenConfigured = hasGuestyAuthConfigured();
  let client: GuestyWriteClient | undefined;

  if (!dryRun) {
    const config = await loadConfig();
    tokenConfigured = Boolean(config.accessToken);
    client = new GuestyWriteClient(config);
  }

  const pauseMs = options.pauseMsBetweenCalls ?? 200;
  const results: MutationResult[] = [];

  for (const mutation of plan.mutations) {
    const result = await runOne(mutation, dryRun, client);
    results.push(result);
    if (!dryRun && pauseMs > 0) await sleep(pauseMs);
  }

  return {
    dryRun,
    tokenConfigured,
    results,
    successCount: results.filter((r) => r.ok).length,
    failureCount: results.filter((r) => !r.ok).length,
  };
}

async function runOne(
  mutation: CleanupMutation,
  dryRun: boolean,
  client: GuestyWriteClient | undefined,
): Promise<MutationResult> {
  const base = { type: mutation.type, id: mutation.id, dryRun };

  if (dryRun) {
    return {
      ...base,
      ok: true,
      detail: describeMutation(mutation),
    };
  }

  if (!client) {
    return { ...base, ok: false, error: "Write client not initialized" };
  }

  try {
    if (mutation.type === "reservation_status") {
      await client.updateReservationStatus(mutation.id, mutation.status);
      return {
        ...base,
        ok: true,
        detail: `status → ${mutation.status}`,
      };
    }

    const body = {
      firstName: mutation.firstName,
      lastName: mutation.lastName,
      ...(mutation.clearNotes ? { notes: "" } : {}),
      ...(mutation.clearGoodToKnowNotes ? { goodToKnowNotes: "" } : {}),
    };
    await client.sanitizeGuest(mutation.id, body);
    return {
      ...base,
      ok: true,
      detail: `name → ${mutation.firstName} ${mutation.lastName}`,
    };
  } catch (err) {
    return {
      ...base,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

function describeMutation(mutation: CleanupMutation): string {
  if (mutation.type === "reservation_status") {
    const code = mutation.confirmationCode ? ` (${mutation.confirmationCode})` : "";
    return `would set reservation ${mutation.id}${code} → ${mutation.status}`;
  }
  return `would sanitize guest ${mutation.id} → ${mutation.firstName} ${mutation.lastName}`;
}

export function parseMutationPlan(raw: unknown): MutationPlan {
  if (!raw || typeof raw !== "object") {
    throw new Error("Mutation plan must be a JSON object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`Unsupported mutation plan version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.mutations)) {
    throw new Error("Mutation plan.mutations must be an array");
  }

  const mutations: CleanupMutation[] = [];
  for (const item of obj.mutations) {
    mutations.push(parseMutation(item));
  }

  return {
    version: 1,
    createdAt: typeof obj.createdAt === "string" ? obj.createdAt : undefined,
    mutations,
    manual: Array.isArray(obj.manual)
      ? (obj.manual as MutationPlan["manual"])
      : undefined,
  };
}

function parseMutation(item: unknown): CleanupMutation {
  if (!item || typeof item !== "object") {
    throw new Error("Each mutation must be an object");
  }
  const m = item as Record<string, unknown>;
  if (m.type === "reservation_status") {
    const status = m.status;
    if (status !== "canceled" && status !== "closed" && status !== "declined") {
      throw new Error(`Invalid reservation status: ${String(status)}`);
    }
    if (typeof m.id !== "string" || !m.id) {
      throw new Error("reservation_status mutation requires id");
    }
    return {
      type: "reservation_status",
      id: m.id,
      status,
      confirmationCode:
        typeof m.confirmationCode === "string" ? m.confirmationCode : undefined,
      reason: typeof m.reason === "string" ? m.reason : undefined,
    };
  }

  if (m.type === "sanitize_guest") {
    if (typeof m.id !== "string" || !m.id) {
      throw new Error("sanitize_guest mutation requires id");
    }
    if (typeof m.firstName !== "string" || typeof m.lastName !== "string") {
      throw new Error("sanitize_guest mutation requires firstName and lastName");
    }
    return {
      type: "sanitize_guest",
      id: m.id,
      firstName: m.firstName,
      lastName: m.lastName,
      clearNotes: m.clearNotes === true,
      clearGoodToKnowNotes: m.clearGoodToKnowNotes === true,
      reason: typeof m.reason === "string" ? m.reason : undefined,
    };
  }

  throw new Error(`Unknown mutation type: ${String(m.type)}`);
}
