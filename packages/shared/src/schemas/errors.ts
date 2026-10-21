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
  "user_disabled",
  "user_not_found",
  "email_taken",
  "slug_taken",
  "last_admin",
  "cannot_change_self",
  "conflict",
  "not_found",
  "internal_error",
]);
export type ApiErrorCode = z.infer<typeof ApiErrorCodeSchema>;

export const ApiErrorResponseSchema = z.object({
  error: z.object({ code: ApiErrorCodeSchema, message: z.string() }),
});
export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
