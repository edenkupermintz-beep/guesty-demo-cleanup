import type { GuestyConfig } from "./config.js";
import type {
  CustomFieldObject,
  CustomFieldType,
} from "../cleanup/zero-state.js";

type Json = Record<string, unknown>;

export type ReservationStatusUpdate = "canceled" | "closed" | "declined";

export type SanitizeGuestInput = {
  firstName: string;
  lastName: string;
  notes?: string;
  goodToKnowNotes?: string;
};

export type CustomFieldCreateInput = {
  key: string;
  object: CustomFieldObject;
  type: CustomFieldType;
  isPublic: boolean;
  options?: string[];
};

export type CustomFieldLive = {
  id?: string;
  _id?: string;
  fieldId?: string;
  key?: string;
  object?: string;
  type?: string;
  isPublic?: boolean;
  displayName?: string;
  options?: string[];
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

  /** Resolve authenticated account id via GET /accounts/me. */
  async getAccountMe(): Promise<{ id: string; raw: Json }> {
    const raw = await this.get("/accounts/me");
    const id = String(
      raw._id ?? raw.id ?? (raw.account as Json | undefined)?._id ?? "",
    );
    if (!id) {
      throw new Error("GET /accounts/me did not return an account id");
    }
    return { id, raw };
  }

  /** List account custom-field definitions. */
  async listCustomFields(accountId: string): Promise<CustomFieldLive[]> {
    const raw = await this.get(`/accounts/${accountId}/custom-fields`);
    if (Array.isArray(raw)) return raw as CustomFieldLive[];
    const nested =
      (raw as { customFields?: CustomFieldLive[]; results?: CustomFieldLive[] })
        .customFields ??
      (raw as { results?: CustomFieldLive[] }).results;
    if (Array.isArray(nested)) return nested;
    return [];
  }

  /** Create one or more custom-field definitions. */
  async createCustomFields(
    accountId: string,
    fields: CustomFieldCreateInput[],
  ): Promise<Json> {
    return this.post(`/accounts/${accountId}/custom-fields`, {
      customFields: fields.map((f) => {
        const row: Json = {
          key: f.key,
          object: f.object,
          type: f.type,
          isPublic: f.isPublic,
        };
        if (f.type === "enum") row.options = f.options ?? [];
        return row;
      }),
    });
  }

  /** Delete a custom-field definition. */
  async deleteCustomField(accountId: string, fieldId: string): Promise<Json> {
    return this.delete(`/accounts/${accountId}/custom-fields/${fieldId}`);
  }

  /**
   * Update enum options on a custom field.
   * Guesty only allows editing `options` on type:enum; send the full object.
   */
  async updateCustomFieldOptions(
    accountId: string,
    input: {
      fieldId: string;
      key: string;
      object: CustomFieldObject;
      isPublic: boolean;
      options: string[];
    },
  ): Promise<Json> {
    return this.put(`/accounts/${accountId}/custom-fields`, {
      customFields: [
        {
          fieldId: input.fieldId,
          key: input.key,
          object: input.object,
          type: "enum",
          isPublic: input.isPublic,
          options: input.options,
        },
      ],
    });
  }

  private async get(path: string): Promise<Json> {
    return this.request("GET", path);
  }

  private async post(path: string, body: Json): Promise<Json> {
    return this.request("POST", path, body);
  }

  private async put(path: string, body: Json): Promise<Json> {
    return this.request("PUT", path, body);
  }

  private async delete(path: string): Promise<Json> {
    return this.request("DELETE", path);
  }

  private async request(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    body?: Json,
  ): Promise<Json> {
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
