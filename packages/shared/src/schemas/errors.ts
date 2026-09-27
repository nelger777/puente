import { z } from "zod";

export const ApiErrorCodeSchema = z.enum([
  "invalid_request",
  "origin_not_allowed",
  "business_not_found",
  "handoff_not_found",
  "rate_limited",
  "unauthorized",
  "forbidden",
  "invalid_credentials",
  "too_many_attempts",
  "conflict",
  "not_found",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({ code: ApiErrorCodeSchema, message: z.string() }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
