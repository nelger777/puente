import type { ApiErrorCode, ApiErrorResponse } from "@puente/shared";
import type { z } from "zod";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }

  toBody(): ApiErrorResponse {
    return { error: { code: this.code, message: this.message } };
  }
}

/** Parses untrusted input; any failure becomes a 400 invalid_request. */
export function parseInput<S extends z.ZodType>(schema: S, data: unknown): z.infer<S> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const fields = [...new Set(result.error.issues.map((i) => i.path.join(".") || "(body)"))];
    throw new ApiError(400, "invalid_request", `Invalid fields: ${fields.join(", ")}`);
  }
  return result.data;
}
