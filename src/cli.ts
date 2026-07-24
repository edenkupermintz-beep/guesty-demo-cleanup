import { loadConfig } from "./guesty/config.js";
import { GuestyClient } from "./guesty/client.js";
import { reconcileReservation } from "./reconcile/compare.js";
import { formatReport } from "./report/format.js";
import type { ReconciliationReport } from "./guesty/types.js";

export type RunOptions = {
  confirmationCode?: string;
  reservationId?: string;
  json?: boolean;
  pastDays?: number;
};

export async function runReconciliation(options: RunOptions): Promise<ReconciliationReport> {
  const config = await loadConfig();
  const client = new GuestyClient(config);

  const reservation = options.reservationId
    ? await client.getReservationById(options.reservationId)
    : options.confirmationCode
      ? await client.getReservationByConfirmationCode(options.confirmationCode)
      : (() => {
          throw new Error("Provide --confirmation <code> or --reservation-id <id>");
        })();

  const code = reservation.confirmationCode;
  if (!code) {
    throw new Error(`Reservation ${reservation._id} has no confirmationCode`);
  }

  const adEntries = await client.getAdvancedDepositEntries(code, {
    pastDays: options.pastDays,
  });

  return reconcileReservation({
    reservation,
    adEntries,
    tolerance: config.tolerance,
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const report = await runReconciliation(args);

  if (args.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatReport(report)}\n`);
  }

  process.exitCode = report.delta.withinTolerance ? 0 : 2;
}

function parseArgs(argv: string[]): RunOptions {
  const options: RunOptions = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--confirmation" || arg === "-c") {
      options.confirmationCode = argv[++i];
    } else if (arg === "--reservation-id" || arg === "-r") {
      options.reservationId = argv[++i];
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--past-days") {
      options.pastDays = Number(argv[++i]);
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    } else if (!arg.startsWith("-") && !options.confirmationCode) {
      options.confirmationCode = arg;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

function printHelp() {
  console.log(`Usage:
  npm run reconcile -- --confirmation <CODE>
  npm run reconcile -- --reservation-id <ID>
  npm run reconcile -- --confirmation <CODE> --json

Exit codes:
  0  balanced within tolerance
  2  delta found
  1  error
`);
}

const isDirectRun =
  process.argv[1]?.endsWith("cli.ts") || process.argv[1]?.endsWith("cli.js");

if (isDirectRun) {
  main().catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
