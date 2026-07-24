import type { GuestyConfig } from "./config.js";
import type { GuestyReservation, JournalEntry, JournalSide } from "./types.js";

type Json = Record<string, unknown>;

export class GuestyClient {
  constructor(private readonly config: GuestyConfig) {}

  async getReservationByConfirmationCode(
    confirmationCode: string,
  ): Promise<GuestyReservation> {
    const fields = [
      "_id",
      "confirmationCode",
      "status",
      "checkInDateLocalized",
      "checkOutDateLocalized",
      "money.totalPaid",
      "money.balanceDue",
      "money.currency",
      "money.payments._id",
      "money.payments.amount",
      "money.payments.currency",
      "money.payments.status",
      "money.payments.paidAt",
      "money.invoiceItems",
    ].join(" ");

    // Exact match via filters — the loose confirmationCode query param can return unrelated rows.
    const filters = encodeURIComponent(
      JSON.stringify([
        { field: "confirmationCode", operator: "$eq", value: confirmationCode },
      ]),
    );
    const params = new URLSearchParams({ fields, limit: "5" });

    const data = await this.request<{ results?: GuestyReservation[]; result?: GuestyReservation[] }>(
      `/reservations?${params.toString()}&filters=${filters}`,
    );

    const results = data.results ?? data.result ?? [];
    const reservation =
      results.find((r) => r.confirmationCode === confirmationCode) ?? results[0];
    if (!reservation?._id || reservation.confirmationCode !== confirmationCode) {
      throw new Error(`No reservation found for confirmationCode=${confirmationCode}`);
    }
    return reservation;
  }

  async getReservationById(id: string): Promise<GuestyReservation> {
    const fields = [
      "_id",
      "confirmationCode",
      "status",
      "checkInDateLocalized",
      "checkOutDateLocalized",
      "money.totalPaid",
      "money.balanceDue",
      "money.currency",
      "money.payments._id",
      "money.payments.amount",
      "money.payments.currency",
      "money.payments.status",
      "money.payments.paidAt",
      "money.invoiceItems",
    ].join("%20");

    return this.request<GuestyReservation>(`/reservations/${id}?fields=${fields}`);
  }

  /**
   * Fetch Advanced Deposit journal entries for a confirmation code.
   * Guesty requires a transactionDate filter; we default to a wide past window.
   */
  async getAdvancedDepositEntries(
    confirmationCode: string,
    options?: { pastDays?: number },
  ): Promise<JournalEntry[]> {
    const pastDays = options?.pastDays ?? 3650;
    const transactionDate = encodeURIComponent(
      JSON.stringify({ operator: "@in_past_days", value: pastDays }),
    );

    const entries: JournalEntry[] = [];
    let skip = 0;
    const limit = 100;

    for (;;) {
      const params = [
        `transactionDate=${transactionDate}`,
        `ledger=AD`,
        `reservationConfirmationCodes=${encodeURIComponent(confirmationCode)}`,
        `skip=${skip}`,
        `limit=${limit}`,
        `sortByDate=ASC`,
      ].join("&");

      // Official path: GET /accounting-api/journal-entries/all
      const data = await this.requestAccounting<{
        results?: Json[];
        data?: Json[];
        count?: number;
      }>(`/journal-entries/all?${params}`);

      const page = data.results ?? data.data ?? [];
      for (const raw of page) {
        entries.push(normalizeJournalEntry(raw, confirmationCode));
      }

      if (page.length < limit) break;
      skip += limit;
    }

    return entries;
  }

  private async request<T>(path: string): Promise<T> {
    return this.requestUrl<T>(
      `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`,
      path,
    );
  }

  private async requestAccounting<T>(path: string): Promise<T> {
    return this.requestUrl<T>(
      `${this.config.accountingBaseUrl}${path.startsWith("/") ? path : `/${path}`}`,
      `accounting:${path}`,
    );
  }

  private async requestUrl<T>(url: string, label: string): Promise<T> {
    const res = await fetch(url, {
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
    });

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(
        `Guesty API ${res.status} ${res.statusText} for ${label}: ${body.slice(0, 500)}`,
      );
    }

    return (await res.json()) as T;
  }
}

function normalizeJournalEntry(raw: Json, fallbackCode: string): JournalEntry {
  const nestedAmount = nestedNumber(raw.amount, ["value", "amount"]);
  const amount =
    nestedAmount ?? numberField(raw, ["amount", "value", "total", "balance"]) ?? 0;
  const signed = numberField(raw, ["signedAmount", "netAmount"]);
  const side = inferSide(raw, amount, signed);
  const absAmount = Math.abs(signed ?? amount);

  const confirmationFromLink = linkTitle(raw.reservationConfirmationCode);

  return {
    _id: stringField(raw, ["_id", "id"]),
    name: stringField(raw, ["name", "title"]),
    description: stringField(raw, ["description", "memo"]),
    ledger: stringField(raw, ["ledger", "ledgerType"]) ?? "AD",
    amount: absAmount,
    side,
    currency:
      nestedString(raw.amount, ["currency"]) ??
      stringField(raw, ["currency", "currencyCode"]),
    trigger: stringField(raw, ["trigger", "triggerType", "event"]),
    chargeCode: stringField(raw, ["chargeCode", "transactionCode", "code"]),
    transactionDate: stringField(raw, [
      "transactionDate",
      "date",
      "recognizedAt",
      "createdAt",
    ]),
    reservationConfirmationCode:
      confirmationFromLink ??
      stringField(raw, [
        "reservationConfirmationCode",
        "confirmationCode",
        "reservationConfirmationCodes",
      ]) ??
      fallbackCode,
    raw,
  };
}

function nestedNumber(value: unknown, keys: string[]): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  return numberField(value as Json, keys);
}

function nestedString(value: unknown, keys: string[]): string | undefined {
  if (!value || typeof value !== "object") return undefined;
  return stringField(value as Json, keys);
}

function linkTitle(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  if (value && typeof value === "object") {
    const title = (value as Json).title;
    if (typeof title === "string" && title.length > 0) return title;
  }
  return undefined;
}

function inferSide(
  raw: Json,
  amount: number,
  signed: number | undefined,
): JournalSide | undefined {
  const explicit = stringField(raw, ["side", "type", "entryType", "debitCredit"])?.toLowerCase();
  if (explicit === "debit" || explicit === "dr" || explicit === "d") return "debit";
  if (explicit === "credit" || explicit === "cr" || explicit === "c") return "credit";

  if (typeof raw.isDebit === "boolean") return raw.isDebit ? "debit" : "credit";
  if (typeof raw.isCredit === "boolean") return raw.isCredit ? "credit" : "debit";

  if (typeof signed === "number") {
    if (signed < 0) return "debit";
    if (signed > 0) return "credit";
  }

  // Guesty AD liability: positive amounts without side often arrive as absolute; leave undefined.
  if (amount < 0) return "debit";
  return undefined;
}

function stringField(raw: Json, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "string" && value.length > 0) return value;
    if (Array.isArray(value) && typeof value[0] === "string") return value[0];
  }
  return undefined;
}

function numberField(raw: Json, keys: string[]): number | undefined {
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === "number" && Number.isFinite(value)) return value;
    if (typeof value === "string" && value.trim() !== "" && !Number.isNaN(Number(value))) {
      return Number(value);
    }
  }
  return undefined;
}
