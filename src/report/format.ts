import type { ReconciliationReport } from "../guesty/types.js";

export function formatReport(report: ReconciliationReport): string {
  const lines: string[] = [];
  const lineIssues =
    report.lineItems.amountMismatch + report.lineItems.guestOnly + report.lineItems.adOnly;
  const status =
    report.delta.withinTolerance && lineIssues === 0 ? "BALANCED" : "DELTA FOUND";

  lines.push(`# Guesty folio reconciliation — ${status}`);
  lines.push("");
  lines.push(`Confirmation: ${report.confirmationCode}`);
  lines.push(`Reservation ID: ${report.reservationId}`);
  lines.push(`Currency: ${report.currency}`);
  lines.push("");
  lines.push("## Guest folio");
  lines.push(`- totalPaid: ${money(report.guest.totalPaid, report.currency)}`);
  lines.push(
    `- balanceDue: ${
      report.guest.balanceDue === null
        ? "n/a"
        : money(report.guest.balanceDue, report.currency)
    }`,
  );
  lines.push(`- payments recorded: ${report.guest.paymentCount}`);
  lines.push(`- invoice items: ${report.guest.invoiceItemCount}`);
  lines.push("");
  lines.push("## Advanced Deposit (AD)");
  lines.push(`- entries: ${report.advancedDeposit.entryCount}`);
  lines.push(
    `- payment credits: ${money(report.advancedDeposit.paymentCredits, report.currency)}`,
  );
  lines.push(
    `- total credits: ${money(report.advancedDeposit.totalCredits, report.currency)}`,
  );
  lines.push(
    `- total debits: ${money(report.advancedDeposit.totalDebits, report.currency)}`,
  );
  lines.push(
    `- net balance (credits − debits): ${money(report.advancedDeposit.netBalance, report.currency)}`,
  );
  lines.push("");
  lines.push("## Totals delta");
  lines.push(`- formula: ${report.delta.formula}`);
  lines.push(`- amount: ${money(report.delta.amount, report.currency)}`);
  lines.push(`- |amount|: ${money(report.delta.absoluteAmount, report.currency)}`);
  lines.push(`- tolerance: ±${report.delta.tolerance}`);
  lines.push(`- ${report.delta.interpretation}`);
  lines.push("");
  lines.push("## Line-item comparison (guest invoice ↔ AD)");
  lines.push(
    `- matched: ${report.lineItems.matched} | amount mismatch: ${report.lineItems.amountMismatch} | guest-only: ${report.lineItems.guestOnly} | AD-only: ${report.lineItems.adOnly}`,
  );
  lines.push(
    `- net line delta (guest − AD): ${money(report.lineItems.netLineDelta, report.currency)}`,
  );
  lines.push("");
  lines.push("| Status | Item | Guest | AD | Delta |");
  lines.push("| --- | --- | ---: | ---: | ---: |");
  for (const row of report.lineItems.rows) {
    lines.push(
      `| ${statusLabel(row.status)} | ${row.label} | ${cell(row.guestAmount, report.currency)} | ${cell(row.adAmount, report.currency)} | ${money(row.delta, report.currency)} |`,
    );
  }

  lines.push("");
  lines.push("## Highlights");
  for (const h of report.highlights) {
    const amt =
      typeof h.amount === "number" ? ` (${money(h.amount, report.currency)})` : "";
    lines.push(`- [${h.kind}] ${h.message}${amt}`);
  }

  if (report.adEntries.length > 0) {
    lines.push("");
    lines.push("## AD journal entries");
    for (const e of report.adEntries) {
      const side = e.side ?? "?";
      const when = e.transactionDate ?? "no-date";
      const trig = e.trigger ?? "no-trigger";
      const desc = e.description ?? e.chargeCode ?? e.id ?? "";
      lines.push(
        `- ${when} | ${side} | ${money(e.amount, report.currency)} | ${trig} | ${desc}`,
      );
    }
  }

  return lines.join("\n");
}

function statusLabel(status: string): string {
  switch (status) {
    case "matched":
      return "MATCH";
    case "amount_mismatch":
      return "AMOUNT≠";
    case "guest_only":
      return "GUEST ONLY";
    case "ad_only":
      return "AD ONLY";
    default:
      return status;
  }
}

function cell(n: number | null, currency: string): string {
  return n === null ? "—" : money(n, currency);
}

function money(n: number, currency: string): string {
  return `${currency} ${n.toFixed(2)}`;
}
