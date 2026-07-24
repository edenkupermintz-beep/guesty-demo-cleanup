import { describe, expect, it } from "vitest";
import { compareLineItems, reconcileReservation } from "../src/reconcile/compare.js";
import type { GuestyReservation, JournalEntry } from "../src/guesty/types.js";
import { formatReport } from "../src/report/format.js";

function reservation(totalPaid: number): GuestyReservation {
  return {
    _id: "res_1",
    confirmationCode: "ABCD1234",
    money: {
      totalPaid,
      balanceDue: 0,
      currency: "USD",
      payments: [{ amount: totalPaid, status: "SUCCEEDED" }],
    },
  };
}

function entry(
  partial: Partial<JournalEntry> & Pick<JournalEntry, "amount">,
): JournalEntry {
  return {
    raw: {},
    ...partial,
  };
}

describe("reconcileReservation", () => {
  it("reports balanced when totalPaid matches PAYMENT credits", () => {
    const report = reconcileReservation({
      reservation: reservation(500),
      adEntries: [
        entry({ amount: 500, side: "credit", trigger: "PAYMENT" }),
        entry({ amount: 500, side: "debit", trigger: "RESERVATION_UPDATED" }),
      ],
    });

    expect(report.delta.withinTolerance).toBe(true);
    expect(report.delta.amount).toBe(0);
    expect(report.advancedDeposit.paymentCredits).toBe(500);
    expect(report.advancedDeposit.netBalance).toBe(0);
  });

  it("highlights positive delta when guest totalPaid exceeds AD payment credits", () => {
    const report = reconcileReservation({
      reservation: reservation(750),
      adEntries: [entry({ amount: 500, side: "credit", trigger: "PAYMENT" })],
    });

    expect(report.delta.withinTolerance).toBe(false);
    expect(report.delta.amount).toBe(250);
    expect(report.highlights[0]?.kind).toBe("surplus");
    expect(formatReport(report)).toContain("DELTA FOUND");
    expect(formatReport(report)).toContain("USD 250.00");
  });

  it("highlights negative delta when AD payment credits exceed totalPaid", () => {
    const report = reconcileReservation({
      reservation: reservation(200),
      adEntries: [entry({ amount: 350, side: "credit", trigger: "PAYMENT" })],
    });

    expect(report.delta.amount).toBe(-150);
    expect(report.highlights[0]?.kind).toBe("shortfall");
  });

  it("falls back to total credits when no PAYMENT triggers exist", () => {
    const report = reconcileReservation({
      reservation: reservation(100),
      adEntries: [entry({ amount: 80, side: "credit", trigger: "MANUAL" })],
    });

    expect(report.delta.formula).toContain("fallback");
    expect(report.delta.amount).toBe(20);
  });
});

describe("compareLineItems", () => {
  it("matches, flags amount mismatches, guest-only, and AD-only rows", () => {
    const result = compareLineItems(
      [
        { title: "Net Rental Income", amount: 2182.04 },
        { title: "Damage Waiver", amount: 50 },
        { title: "Cleaning Fee", amount: 150 },
      ],
      [
        entry({ description: "Net Rental Income", amount: 2182.04, side: "credit" }),
        entry({ description: "Damage Waiver", amount: 67.54, side: "credit" }),
        entry({ description: "Bed Fee", amount: 64.8, side: "credit" }),
      ],
    );

    expect(result.matched).toBe(1);
    expect(result.amountMismatch).toBe(1);
    expect(result.guestOnly).toBe(1);
    expect(result.adOnly).toBe(1);

    const mismatch = result.rows.find((r) => r.status === "amount_mismatch");
    expect(mismatch?.delta).toBe(-17.54);
  });
});
