import type { ReservationStatusUpdate } from "../guesty/write-client.js";

export type ReservationStatusMutation = {
  type: "reservation_status";
  id: string;
  status: ReservationStatusUpdate;
  confirmationCode?: string;
  reason?: string;
};

export type SanitizeGuestMutation = {
  type: "sanitize_guest";
  id: string;
  firstName: string;
  lastName: string;
  clearNotes?: boolean;
  clearGoodToKnowNotes?: boolean;
  reason?: string;
};

export type CleanupMutation = ReservationStatusMutation | SanitizeGuestMutation;

export type MutationPlan = {
  version: 1;
  createdAt?: string;
  dryRunDefault?: boolean;
  mutations: CleanupMutation[];
  manual?: Array<{
    kind: "inbox" | "channel_reservation" | "other";
    id?: string;
    summary: string;
  }>;
};

export type MutationResult = {
  type: CleanupMutation["type"];
  id: string;
  ok: boolean;
  dryRun: boolean;
  error?: string;
  detail?: string;
};

export type ApplyPlanReport = {
  dryRun: boolean;
  tokenConfigured: boolean;
  results: MutationResult[];
  successCount: number;
  failureCount: number;
};
