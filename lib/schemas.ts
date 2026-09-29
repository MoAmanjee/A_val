import { z } from "zod";
import { money } from "@/lib/validation";

export const vehicleBody = z.object({
  customerId: z.string().nullish(),
  vin: z.string().max(40).nullish(),
  registrationNumber: z.string().max(20).nullish(),
  make: z.string().max(60).nullish(),
  model: z.string().max(80).nullish(),
  year: z.coerce.number().int().nullish(),
  variant: z.string().max(80).nullish(),
  engine: z.string().max(80).nullish(),
  engineCode: z.string().max(30).nullish(),
  engineSize: z.string().max(20).nullish(),
  fuelType: z.string().max(30).nullish(),
  transmission: z.string().max(30).nullish(),
  mileage: z.coerce.number().int().nullish(),
});

export const partBody = z.object({
  sku: z.string().min(1).max(80),
  partNumber: z.string().max(80).nullish(),
  barcode: z.string().max(80).nullish(),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).nullish(),
  category: z.string().max(80).nullish(),
  manufacturer: z.string().max(80).nullish(),
  costPrice: money.optional(),
  sellingPrice: money.optional(),
  vatRate: z.coerce.number().min(0).max(100).nullish(),
  quantityInStock: z.coerce.number().int().min(0).optional(),
  minimumStockLevel: z.coerce.number().int().min(0).optional(),
  location: z.string().max(80).nullish(),
  active: z.boolean().optional(),
  universal: z.boolean().optional(),
  recommended: z.boolean().optional(),
});

export const fitmentBody = z.object({
  make: z.string().min(1).max(60),
  model: z.string().max(80).nullish(),
  yearFrom: z.coerce.number().int().nullish(),
  yearTo: z.coerce.number().int().nullish(),
  variant: z.string().max(80).nullish(),
  engine: z.string().max(80).nullish(),
  engineCode: z.string().max(30).nullish(),
  fuelType: z.string().max(30).nullish(),
  transmission: z.string().max(30).nullish(),
  notes: z.string().max(500).nullish(),
});

export const labourBody = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(500).nullish(),
  hourlyRate: z.coerce.number().min(0).nullish(),
  fixedPrice: z.coerce.number().min(0).nullish(),
  defaultHours: z.coerce.number().positive().max(200).optional(),
  active: z.boolean().optional(),
});

const quoteItem = z.object({
  id: z.string().optional(),
  partId: z.string().nullish(),
  description: z.string().min(1).max(300).optional(),
  sku: z.string().max(80).nullish(),
  partNumber: z.string().max(80).nullish(),
  fitmentConfidence: z.string().max(20).nullish(),
  matchNote: z.string().max(500).nullish(),
  quantity: z.coerce.number().positive().max(100_000),
  unitPrice: z.coerce.number().min(0).max(100_000_000).optional(),
  discount: z.coerce.number().min(0).max(100_000_000).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
});

const quoteLabour = z.object({
  id: z.string().optional(),
  labourId: z.string().nullish(),
  description: z.string().min(1).max(300).optional(),
  hours: z.coerce.number().positive().max(1000).optional(),
  unitPrice: z.coerce.number().min(0).max(100_000_000).optional(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
});

export const quoteBody = z.object({
  customerId: z.string().min(1).optional(),
  vehicleId: z.string().nullish(),
  conversationId: z.string().nullish(),
  items: z.array(quoteItem).max(100).optional(),
  labour: z.array(quoteLabour).max(50).optional(),
  notes: z.string().max(4000).nullish(),
  internalNotes: z.string().max(4000).nullish(),
  validUntil: z.coerce.date().nullish(),
  vatRate: z.coerce.number().min(0).max(100).optional(),
  pricesIncludeVat: z.boolean().optional(),
});
