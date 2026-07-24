import type { GuestyConfig } from "./config.js";

type Json = Record<string, unknown>;

export type ReservationStatusUpdate = "canceled" | "closed" | "declined";

export type SanitizeGuestInput = {
  firstName: string;
  lastName: string;
  notes?: string;
  goodToKnowNotes?: string;
};

/**
 * Write-only Guesty Open API client for demo cleanup.
 * Keep separate from GuestyClient (GET-only reconcile paths).
 */
export class GuestyWriteClient {
  constructor(private readonly config: GuestyConfig) {}

  async updateReservationStatus(
    reservationId: string,
    status: ReservationStatusUpdate,
  ): Promise<Json> {
    return this.put(`/reservations/${reservationId}`, { status });
  }

  async sanitizeGuest(guestId: string, input: SanitizeGuestInput): Promise<Json> {
    const body: Json = {
      firstName: input.firstName,
      lastName: input.lastName,
    };
    if (input.notes !== undefined) body.notes = input.notes;
    if (input.goodToKnowNotes !== undefined) body.goodToKnowNotes = input.goodToKnowNotes;
    return this.put(`/guests/${guestId}`, body);
  }

  /** Update listing nickname only (do not send title unless caller asks). */
  async updateListingNickname(listingId: string, nickname: string): Promise<Json> {
    return this.put(`/listings/${listingId}`, { nickname });
  }

  private async put(path: string, body: Json): Promise<Json> {
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method: "PUT",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Guesty API ${res.status} ${res.statusText} for PUT ${path}: ${text.slice(0, 500)}`,
      );
    }

    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as Json;
  }
}
