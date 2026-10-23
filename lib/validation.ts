import { z } from "zod";

export const pageQuery = {
  page: z.coerce.number().int().min(1).optional(),
  pageSize: z.coerce.number().int().min(1).max(200).optional(),
};

export const optionalText = z
  .string()
  .max(2000)
  .nullish()
  .transform((v) => (v === undefined ? undefined : v === null ? null : v));

/** Accepts numbers or numeric strings from JSON bodies. */
export const money = z.coerce.number().finite().min(0).max(100_000_000);
export const qty = z.coerce.number().finite().positive().max(100_000);

export const idParam = z.object({ id: z.string().min(1) });
