/** Guesty reservation money / guest folio fields we use for reconciliation. */
export type InvoiceItem = {
  _id?: string;
  title?: string;
  description?: string;
  amount: number;
  currency?: string;
  normalType?: string;
  secondIdentifier?: string;
  type?: string;
  isTax?: boolean;
};

export type GuestMoney = {
  totalPaid?: number;
  balanceDue?: number;
  currency?: string;
  invoiceItems?: InvoiceItem[];
  payments?: Array<{
    _id?: string;
    amount?: number;
    currency?: string;
    status?: string;
    paidAt?: string;
  }>;
};

export type GuestyReservation = {
  _id: string;
  confirmationCode?: string;
  status?: string;
  checkInDateLocalized?: string;
  checkOutDateLocalized?: string;
  money?: GuestMoney;
};

export type JournalSide = "debit" | "credit";

/** Normalized journal entry for Advanced Deposit (AD) ledger work. */
export type JournalEntry = {
  _id?: string;
  name?: string;
  description?: string;
  ledger?: string;
  amount: number;
  /** Absolute amount from Guesty; side distinguishes debit vs credit when available. */
  side?: JournalSide;
  currency?: string;
  trigger?: string;
  chargeCode?: string;
  transactionDate?: string;
  reservationConfirmationCode?: string;
  raw: Record<string, unknown>;
};

export type LineMatchStatus =
  | "matched"
  | "amount_mismatch"
  | "guest_only"
  | "ad_only";

export type LineItemComparison = {
  status: LineMatchStatus;
  label: string;
  guestAmount: number | null;
  adAmount: number | null;
  /** guestAmount − adAmount when both sides exist; else the present side amount with sign by status. */
  delta: number;
  guestTitle?: string;
  adDescription?: string;
  normalType?: string;
  secondIdentifier?: string;
  chargeCode?: string;
};

export type ReconciliationReport = {
  confirmationCode: string;
  reservationId: string;
  currency: string;
  guest: {
    totalPaid: number;
    balanceDue: number | null;
    paymentCount: number;
    invoiceItemCount: number;
  };
  advancedDeposit: {
    entryCount: number;
    paymentCredits: number;
    totalCredits: number;
    totalDebits: number;
    netBalance: number;
  };
  /** Primary delta: guest totalPaid − AD payment credits (PAYMENT-triggered credits, else all credits). */
  delta: {
    amount: number;
    absoluteAmount: number;
    withinTolerance: boolean;
    tolerance: number;
    formula: string;
    interpretation: string;
  };
  /** Line-by-line guest invoice items vs AD ledger rows. */
  lineItems: {
    matched: number;
    amountMismatch: number;
    guestOnly: number;
    adOnly: number;
    netLineDelta: number;
    rows: LineItemComparison[];
  };
  highlights: Array<{
    kind: "surplus" | "shortfall" | "info";
    message: string;
    amount?: number;
  }>;
  adEntries: Array<{
    id?: string;
    trigger?: string;
    chargeCode?: string;
    description?: string;
    amount: number;
    side?: JournalSide;
    transactionDate?: string;
  }>;
};
