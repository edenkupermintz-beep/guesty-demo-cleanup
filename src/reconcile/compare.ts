import type {
  GuestyReservation,
  InvoiceItem,
  JournalEntry,
  LineItemComparison,
  ReconciliationReport,
} from "../guesty/types.js";

export type ReconcileInput = {
  reservation: GuestyReservation;
  adEntries: JournalEntry[];
  tolerance?: number;
};

/**
 * Primary compare: guest money.totalPaid vs Advanced Deposit payment credits.
 * Also compares guest invoiceItems to AD ledger rows line-by-line.
 */
export function reconcileReservation(input: ReconcileInput): ReconciliationReport {
  const tolerance = input.tolerance ?? 0.01;
  const confirmationCode = input.reservation.confirmationCode ?? "UNKNOWN";
  const money = input.reservation.money ?? {};
  const totalPaid = money.totalPaid ?? 0;
  const balanceDue = money.balanceDue ?? null;
  const currency = money.currency ?? inferCurrency(input.adEntries) ?? "USD";
  const invoiceItems = normalizeInvoiceItems(money.invoiceItems ?? []);

  const totals = summarizeAd(input.adEntries);
  const usePaymentCredits = totals.paymentCredits > 0 || hasPaymentTrigger(input.adEntries);
  const adCompareAmount = usePaymentCredits ? totals.paymentCredits : totals.totalCredits;
  const formula = usePaymentCredits
    ? "guest.totalPaid − AD payment credits (trigger=PAYMENT)"
    : "guest.totalPaid − AD total credits (no PAYMENT triggers found; fallback)";

  const amount = roundMoney(totalPaid - adCompareAmount);
  const absoluteAmount = roundMoney(Math.abs(amount));
  const withinTolerance = absoluteAmount <= tolerance;

  const lineItems = compareLineItems(invoiceItems, input.adEntries, tolerance);

  const highlights: ReconciliationReport["highlights"] = [];

  if (withinTolerance) {
    highlights.push({
      kind: "info",
      message: `Balanced within tolerance (±${tolerance}): totalPaid matches AD payment side.`,
      amount: 0,
    });
  } else if (amount > 0) {
    highlights.push({
      kind: "surplus",
      message: `Guest totalPaid exceeds AD payment credits by ${fmt(absoluteAmount, currency)}. Payments on the guest folio are not fully reflected in Advanced Deposit.`,
      amount: absoluteAmount,
    });
  } else {
    highlights.push({
      kind: "shortfall",
      message: `AD payment credits exceed guest totalPaid by ${fmt(absoluteAmount, currency)}. Advanced Deposit shows more payment credit than the guest folio collected.`,
      amount: absoluteAmount,
    });
  }

  if (lineItems.amountMismatch > 0 || lineItems.guestOnly > 0 || lineItems.adOnly > 0) {
    highlights.push({
      kind: lineItems.netLineDelta >= 0 ? "surplus" : "shortfall",
      message: `Line-item deltas: ${lineItems.amountMismatch} amount mismatch(es), ${lineItems.guestOnly} guest-only, ${lineItems.adOnly} AD-only (net line delta ${fmt(lineItems.netLineDelta, currency)}).`,
      amount: roundMoney(Math.abs(lineItems.netLineDelta)),
    });
  } else if (lineItems.matched > 0) {
    highlights.push({
      kind: "info",
      message: `All ${lineItems.matched} invoice line(s) match AD ledger amounts within tolerance.`,
      amount: 0,
    });
  }

  if (Math.abs(totals.netBalance) > tolerance) {
    highlights.push({
      kind: "info",
      message: `AD net balance is ${fmt(totals.netBalance, currency)} (credits − debits). Non-zero after checkout often means trust funds not fully distributed.`,
      amount: roundMoney(totals.netBalance),
    });
  }

  return {
    confirmationCode,
    reservationId: input.reservation._id,
    currency,
    guest: {
      totalPaid: roundMoney(totalPaid),
      balanceDue: balanceDue === null ? null : roundMoney(balanceDue),
      paymentCount: money.payments?.length ?? 0,
      invoiceItemCount: invoiceItems.length,
    },
    advancedDeposit: {
      entryCount: input.adEntries.length,
      paymentCredits: roundMoney(totals.paymentCredits),
      totalCredits: roundMoney(totals.totalCredits),
      totalDebits: roundMoney(totals.totalDebits),
      netBalance: roundMoney(totals.netBalance),
    },
    delta: {
      amount,
      absoluteAmount,
      withinTolerance,
      tolerance,
      formula,
      interpretation: interpretDelta(amount, withinTolerance, currency),
    },
    lineItems,
    highlights,
    adEntries: input.adEntries.map((e) => ({
      id: e._id,
      trigger: e.trigger,
      chargeCode: e.chargeCode,
      description: e.description ?? e.name,
      amount: e.amount,
      side: e.side,
      transactionDate: e.transactionDate,
    })),
  };
}

export function compareLineItems(
  invoiceItems: InvoiceItem[],
  adEntries: JournalEntry[],
  tolerance = 0.01,
): ReconciliationReport["lineItems"] {
  type AdCand = { entry: JournalEntry; key: string; used: boolean };
  const adCands: AdCand[] = adEntries.map((entry) => ({
    entry,
    key: normalizeLabel(entry.description ?? entry.name ?? entry.chargeCode ?? ""),
    used: false,
  }));

  const rows: LineItemComparison[] = [];

  for (const item of invoiceItems) {
    const label = item.title || item.description || item.secondIdentifier || "untitled";
    const key = normalizeLabel(label);
    const altKeys = [
      key,
      normalizeLabel(item.description ?? ""),
      normalizeLabel(item.secondIdentifier ?? ""),
    ].filter(Boolean);

    const matchIdx = adCands.findIndex((c) => !c.used && altKeys.includes(c.key));
    if (matchIdx === -1) {
      rows.push({
        status: "guest_only",
        label,
        guestAmount: roundMoney(item.amount),
        adAmount: null,
        delta: roundMoney(item.amount),
        guestTitle: item.title,
        normalType: item.normalType,
        secondIdentifier: item.secondIdentifier,
      });
      continue;
    }

    const cand = adCands[matchIdx]!;
    cand.used = true;
    const guestAmount = roundMoney(item.amount);
    const adAmount = roundMoney(cand.entry.amount);
    const delta = roundMoney(guestAmount - adAmount);
    const matched = Math.abs(delta) <= tolerance;

    rows.push({
      status: matched ? "matched" : "amount_mismatch",
      label,
      guestAmount,
      adAmount,
      delta,
      guestTitle: item.title,
      adDescription: cand.entry.description ?? cand.entry.name,
      normalType: item.normalType,
      secondIdentifier: item.secondIdentifier,
      chargeCode: cand.entry.chargeCode,
    });
  }

  for (const cand of adCands) {
    if (cand.used) continue;
    const label = cand.entry.description ?? cand.entry.name ?? cand.entry.chargeCode ?? "untitled";
    rows.push({
      status: "ad_only",
      label,
      guestAmount: null,
      adAmount: roundMoney(cand.entry.amount),
      delta: roundMoney(-cand.entry.amount),
      adDescription: cand.entry.description ?? cand.entry.name,
      chargeCode: cand.entry.chargeCode,
    });
  }

  const statusOrder: Record<LineItemComparison["status"], number> = {
    amount_mismatch: 0,
    guest_only: 1,
    ad_only: 2,
    matched: 3,
  };
  rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status] || a.label.localeCompare(b.label));

  return {
    matched: rows.filter((r) => r.status === "matched").length,
    amountMismatch: rows.filter((r) => r.status === "amount_mismatch").length,
    guestOnly: rows.filter((r) => r.status === "guest_only").length,
    adOnly: rows.filter((r) => r.status === "ad_only").length,
    netLineDelta: roundMoney(rows.reduce((sum, r) => sum + r.delta, 0)),
    rows,
  };
}

function normalizeInvoiceItems(items: unknown[]): InvoiceItem[] {
  const out: InvoiceItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== "object") continue;
    const obj = raw as Record<string, unknown>;
    const amount =
      typeof obj.amount === "number"
        ? obj.amount
        : typeof obj.baseAmount === "number"
          ? obj.baseAmount
          : null;
    if (amount === null) continue;
    out.push({
      _id: typeof obj._id === "string" ? obj._id : undefined,
      title: typeof obj.title === "string" ? obj.title : undefined,
      description: typeof obj.description === "string" ? obj.description : undefined,
      amount,
      currency: typeof obj.currency === "string" ? obj.currency : undefined,
      normalType: typeof obj.normalType === "string" ? obj.normalType : undefined,
      secondIdentifier:
        typeof obj.secondIdentifier === "string" ? obj.secondIdentifier : undefined,
      type: typeof obj.type === "string" ? obj.type : undefined,
      isTax: typeof obj.isTax === "boolean" ? obj.isTax : undefined,
    });
  }
  return out;
}

/** Lowercase, strip punctuation/spaces for fuzzy title matching across folio ↔ AD. */
export function normalizeLabel(value: string): string {
  return value
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function summarizeAd(entries: JournalEntry[]) {
  let paymentCredits = 0;
  let totalCredits = 0;
  let totalDebits = 0;

  for (const entry of entries) {
    const side = entry.side ?? defaultSideForTrigger(entry.trigger);
    if (side === "debit") {
      totalDebits += entry.amount;
    } else {
      totalCredits += entry.amount;
      if (isPaymentTrigger(entry.trigger)) {
        paymentCredits += entry.amount;
      }
    }
  }

  return {
    paymentCredits,
    totalCredits,
    totalDebits,
    netBalance: totalCredits - totalDebits,
  };
}

function hasPaymentTrigger(entries: JournalEntry[]): boolean {
  return entries.some((e) => isPaymentTrigger(e.trigger));
}

function isPaymentTrigger(trigger?: string): boolean {
  if (!trigger) return false;
  const t = trigger.toUpperCase();
  return t === "PAYMENT" || t.includes("PAYMENT");
}

function defaultSideForTrigger(trigger?: string): "debit" | "credit" {
  if (!trigger) return "credit";
  const t = trigger.toUpperCase();
  if (
    t.includes("CHECK_IN") ||
    t.includes("CHECK_OUT") ||
    t.includes("CHECKOUT") ||
    t.includes("RECOGN") ||
    t.includes("CANCEL") ||
    t === "PERIODIC" ||
    t === "DISBURSEMENT"
  ) {
    return "debit";
  }
  return "credit";
}

function interpretDelta(
  amount: number,
  withinTolerance: boolean,
  currency: string,
): string {
  if (withinTolerance) {
    return "No material delta between guest totalPaid and Advanced Deposit payment credits.";
  }
  if (amount > 0) {
    return `Positive delta ${fmt(amount, currency)}: guest folio collected more than AD payment credits.`;
  }
  return `Negative delta ${fmt(amount, currency)}: AD payment credits exceed guest totalPaid.`;
}

function inferCurrency(entries: JournalEntry[]): string | undefined {
  return entries.find((e) => e.currency)?.currency;
}

function roundMoney(n: number): number {
  return Math.round(n * 100) / 100;
}

function fmt(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
}
