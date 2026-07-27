export type ThresholdVerdict = "MET" | "NOT_MET";

export type AuditedAreaKey =
  | "guests"
  | "listingNicknames"
  | "tasks"
  | "customFields";

export type ThresholdLine = {
  area: AuditedAreaKey;
  metric: string;
  value: number;
  threshold: number;
  comparison: ">=" | "<";
  verdict: ThresholdVerdict;
  summary: string;
};

export type AreaAuditResult = {
  area: AuditedAreaKey;
  metric: string;
  value: number;
  threshold: number;
  dirty: boolean;
  verdict: ThresholdVerdict;
  action: "propose" | "skip";
  summary: string;
  sample?: unknown[];
  extra?: Record<string, unknown>;
};

export type NonGatedArea = {
  area: "inbox" | "reservations";
  action: "report_only" | "skip";
  note: string;
};

export type AuditReport = {
  createdAt: string;
  tokenConfigured: boolean;
  thresholds: {
    guestsRenameCount: number;
    listingNicknameRenameCount: number;
    tasksDeleteCount: number;
    customFieldsDirtyCount: number;
  };
  areas: {
    guests: AreaAuditResult;
    listingNicknames: AreaAuditResult;
    tasks: AreaAuditResult;
    customFields: AreaAuditResult;
    inbox: NonGatedArea;
    reservations: NonGatedArea;
  };
  /** Areas where value >= threshold (propose cleanup). */
  thresholdsMet: ThresholdLine[];
  /** Areas where value < threshold (skip cleanup). */
  thresholdsNotMet: ThresholdLine[];
  propose: AuditedAreaKey[];
  skip: AuditedAreaKey[];
};

export function gateThreshold(
  area: AuditedAreaKey,
  metric: string,
  value: number,
  threshold: number,
): Omit<AreaAuditResult, "sample" | "extra"> {
  const dirty = value >= threshold;
  const verdict: ThresholdVerdict = dirty ? "MET" : "NOT_MET";
  const comparison = dirty ? ">=" : "<";
  const summary = dirty
    ? `${area} ${metric} ${value} >= ${threshold} (MET — propose)`
    : `${area} ${metric} ${value} < ${threshold} (NOT MET — skip)`;
  return {
    area,
    metric,
    value,
    threshold,
    dirty,
    verdict,
    action: dirty ? "propose" : "skip",
    summary,
  };
}

export function buildAuditReport(input: {
  thresholds: {
    guestsRenameCount: number;
    listingNicknameRenameCount: number;
    tasksDeleteCount: number;
    customFieldsDirtyCount: number;
  };
  guests: {
    renameCount: number;
    totalGuests: number;
    sample?: unknown[];
  };
  listingNicknames: {
    renameCount: number;
    totalListings: number;
    missingCity?: number;
    sample?: unknown[];
  };
  tasks: {
    deleteCount: number;
    keep: number;
    keepableCandidates: number;
    keepPerTitle: number;
    exported: number;
    topDeleteTitles?: unknown[];
  };
  customFields: {
    dirtyCount: number;
    liveCount: number;
    catalogCount: number;
    keep: number;
    sample?: unknown[];
  };
  inboxNote?: string;
}): AuditReport {
  const guests = {
    ...gateThreshold(
      "guests",
      "renameCount",
      input.guests.renameCount,
      input.thresholds.guestsRenameCount,
    ),
    sample: input.guests.sample,
    extra: { totalGuests: input.guests.totalGuests },
  };

  const listingNicknames = {
    ...gateThreshold(
      "listingNicknames",
      "renameCount",
      input.listingNicknames.renameCount,
      input.thresholds.listingNicknameRenameCount,
    ),
    sample: input.listingNicknames.sample,
    extra: {
      totalListings: input.listingNicknames.totalListings,
      missingCity: input.listingNicknames.missingCity ?? 0,
    },
  };

  const tasks = {
    ...gateThreshold(
      "tasks",
      "deleteCount",
      input.tasks.deleteCount,
      input.thresholds.tasksDeleteCount,
    ),
    sample: input.tasks.topDeleteTitles,
    extra: {
      keep: input.tasks.keep,
      keepableCandidates: input.tasks.keepableCandidates,
      keepPerTitle: input.tasks.keepPerTitle,
      exported: input.tasks.exported,
    },
  };

  const customFields = {
    ...gateThreshold(
      "customFields",
      "dirtyCount",
      input.customFields.dirtyCount,
      input.thresholds.customFieldsDirtyCount,
    ),
    sample: input.customFields.sample,
    extra: {
      liveCount: input.customFields.liveCount,
      catalogCount: input.customFields.catalogCount,
      keep: input.customFields.keep,
    },
  };

  const gated = [guests, listingNicknames, tasks, customFields];
  const thresholdsMet: ThresholdLine[] = [];
  const thresholdsNotMet: ThresholdLine[] = [];
  const propose: AuditedAreaKey[] = [];
  const skip: AuditedAreaKey[] = [];

  for (const area of gated) {
    const line: ThresholdLine = {
      area: area.area,
      metric: area.metric,
      value: area.value,
      threshold: area.threshold,
      comparison: area.dirty ? ">=" : "<",
      verdict: area.verdict,
      summary: area.summary,
    };
    if (area.dirty) {
      thresholdsMet.push(line);
      propose.push(area.area);
    } else {
      thresholdsNotMet.push(line);
      skip.push(area.area);
    }
  }

  return {
    createdAt: new Date().toISOString(),
    tokenConfigured: true,
    thresholds: input.thresholds,
    areas: {
      guests,
      listingNicknames,
      tasks,
      customFields,
      inbox: {
        area: "inbox",
        action: "report_only",
        note:
          input.inboxNote ??
          "Open API cannot delete or archive conversations; archive manually in Guesty UI.",
      },
      reservations: {
        area: "reservations",
        action: "skip",
        note: "Reservation planner not wired yet — not audited.",
      },
    },
    thresholdsMet,
    thresholdsNotMet,
    propose,
    skip,
  };
}
