/**
 * Pretend line-item demo for GY-4Cn2RtSJ.
 * Uses real AD amounts from the live folio, with staged guest invoice differences.
 */
import { reconcileReservation } from "../src/reconcile/compare.js";
import { formatReport } from "../src/report/format.js";
import type { GuestyReservation, JournalEntry } from "../src/guesty/types.js";

const adLines: Array<[string, number]> = [
  ["Bed Fee", 64.8],
  ["Damage Waiver", 67.54],
  ["Bed Fee CT", 36.29],
  ["Bed Fee VAT", 3.24],
  ["Damage Waiver VAT", 3.38],
  ["Net Rental Income CT", 1221.94],
  ["Net Rental Income TT", 218.21],
  ["Net Rental Income VAT", 109.1],
  ["Net Rental Income", 2182.04],
];

const adEntries: JournalEntry[] = adLines.map(([description, amount], i) => ({
  _id: `ad-${i}`,
  description,
  amount,
  side: "credit",
  trigger: "Reservation updated",
  transactionDate: "2026-07-13",
  currency: "USD",
  raw: {},
}));

const reservation: GuestyReservation = {
  _id: "68a36c2fb8d851d822bfef9d",
  confirmationCode: "GY-4Cn2RtSJ",
  status: "confirmed",
  money: {
    // Pretend guest paid accommodation + bed fee only
    totalPaid: 2182.04 + 64.8,
    balanceDue: 1659.7,
    currency: "USD",
    payments: [
      {
        _id: "demo-pay-1",
        amount: 2246.84,
        currency: "USD",
        status: "SUCCEEDED",
        paidAt: "2026-07-14",
      },
    ],
    invoiceItems: [
      // MATCH
      { title: "Net Rental Income", amount: 2182.04, normalType: "AF" },
      { title: "Bed Fee", amount: 64.8, normalType: "AFE", secondIdentifier: "ADDITIONAL_BED" },
      { title: "Bed Fee CT", amount: 36.29, normalType: "CT", isTax: true },
      { title: "Bed Fee VAT", amount: 3.24, normalType: "VAT", isTax: true },
      // AMOUNT MISMATCH — guest folio lower than AD
      { title: "Damage Waiver", amount: 50.0, normalType: "AFE", secondIdentifier: "DAMAGE_WAIVER" },
      // GUEST ONLY — on guest invoice, missing from AD
      { title: "Cleaning Fee", amount: 150.0, normalType: "AFE", secondIdentifier: "CLEANING" },
      // AD has Damage Waiver VAT, Net Rental Income CT/TT/VAT — left unmatched intentionally
      // (guest missing those tax/split lines except we omit them → AD ONLY)
    ],
  },
};

const report = reconcileReservation({ reservation, adEntries });
process.stdout.write(`${formatReport(report)}\n`);
