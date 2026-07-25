import type { GuestyConfig } from "./config.js";

type Json = Record<string, unknown>;

export type ReservationStatusUpdate = "canceled" | "closed" | "declined";

export type SanitizeGuestInput = {
  firstName: string;
  lastName: string;
  notes?: string;
  goodToKnowNotes?: string;
};

/** Write-capable Guesty Open API client for demo account cleanup. */
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

  /** Cancel a task instance (does not stop recurring series generators). */
  async cancelTask(taskId: string): Promise<Json> {
    return this.put(`/tasks-open-api/${taskId}`, { status: "canceled" });
  }

  /** Hard-delete a task instance (does not stop recurring series generators). */
  async deleteTask(taskId: string): Promise<Json> {
    return this.delete(`/tasks-open-api/${taskId}`);
  }

  private async put(path: string, body: Json): Promise<Json> {
    return this.request("PUT", path, body);
  }

  private async delete(path: string): Promise<Json> {
    return this.request("DELETE", path);
  }

  private async request(method: "PUT" | "DELETE", path: string, body?: Json): Promise<Json> {
    const url = `${this.config.baseUrl}${path.startsWith("/") ? path : `/${path}`}`;
    const res = await fetch(url, {
      method,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${this.config.accessToken}`,
        ...(body ? { "Content-Type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(
        `Guesty API ${res.status} ${res.statusText} for ${method} ${path}: ${text.slice(0, 500)}`,
      );
    }

    if (res.status === 204) return {};
    const text = await res.text();
    if (!text) return {};
    return JSON.parse(text) as Json;
  }
}
