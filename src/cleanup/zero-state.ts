import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

export type ZeroStateAudit = {
  exportMaxAgeHours: number;
  thresholds: {
    guestsRenameCount: number;
    listingNicknameRenameCount: number;
    tasksDeleteCount: number;
  };
};

export type ZeroState = {
  guests?: {
    allowlistGuestIds?: string[];
    duplicateFullNameThreshold?: number;
    forbiddenNameSubstrings?: string[];
  };
  tasks?: {
    keepPerTitle?: number;
    keepableStatuses?: string[];
  };
  listings?: {
    sharedNicknameCities?: string[];
    unitTypes?: string[];
    maxPreferredPerBaseNickname?: number;
  };
  audit?: Partial<ZeroStateAudit> & {
    thresholds?: Partial<ZeroStateAudit["thresholds"]>;
  };
  inbox?: { action?: string; note?: string };
};

const DEFAULT_AUDIT: ZeroStateAudit = {
  exportMaxAgeHours: 6,
  thresholds: {
    guestsRenameCount: 10,
    listingNicknameRenameCount: 3,
    tasksDeleteCount: 100,
  },
};

export function zeroStatePath(cwd = process.cwd()): string {
  return resolve(cwd, ".cursor/skills/guesty-demo-cleanup/zero-state.json");
}

export function loadZeroState(cwd = process.cwd()): ZeroState {
  const path = zeroStatePath(cwd);
  if (!existsSync(path)) return {};
  return JSON.parse(readFileSync(path, "utf8")) as ZeroState;
}

export function resolveAuditConfig(zs: ZeroState = loadZeroState()): ZeroStateAudit {
  const t: Partial<ZeroStateAudit["thresholds"]> = zs.audit?.thresholds ?? {};
  return {
    exportMaxAgeHours:
      zs.audit?.exportMaxAgeHours && Number.isFinite(zs.audit.exportMaxAgeHours)
        ? zs.audit.exportMaxAgeHours
        : DEFAULT_AUDIT.exportMaxAgeHours,
    thresholds: {
      guestsRenameCount:
        t.guestsRenameCount ?? DEFAULT_AUDIT.thresholds.guestsRenameCount,
      listingNicknameRenameCount:
        t.listingNicknameRenameCount ??
        DEFAULT_AUDIT.thresholds.listingNicknameRenameCount,
      tasksDeleteCount:
        t.tasksDeleteCount ?? DEFAULT_AUDIT.thresholds.tasksDeleteCount,
    },
  };
}
