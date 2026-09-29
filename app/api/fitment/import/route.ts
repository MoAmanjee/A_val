import { NextRequest } from "next/server";
import { route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import {
  FITMENT_IMPORT_FIELDS,
  importFitment,
  parseSpreadsheet,
  suggestMapping,
  type ColumnMapping,
} from "@/services/inventory/import";

const MAX_BYTES = 10 * 1024 * 1024;

async function readFile(req: NextRequest) {
  const form = await req.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new ValidationError("Attach a .csv or .xlsx file");
  if (file.size > MAX_BYTES) throw new ValidationError("File is too large (max 10MB)");
  return { form, sheet: await parseSpreadsheet(Buffer.from(await file.arrayBuffer()), file.name) };
}

export const POST = route(async ({ req, session }) => {
  const action = req.nextUrl.searchParams.get("action") ?? "preview";
  const { form, sheet } = await readFile(req);
  if (action === "preview") {
    return {
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 5),
      totalRows: sheet.rows.length,
      fields: FITMENT_IMPORT_FIELDS.map(({ key, label, required }) => ({ key, label, required: !!required })),
      suggestedMapping: suggestMapping(sheet.headers, FITMENT_IMPORT_FIELDS),
    };
  }
  let mapping: ColumnMapping;
  try {
    mapping = JSON.parse(String(form.get("mapping") ?? "{}"));
  } catch {
    throw new ValidationError("Invalid column mapping");
  }
  return importFitment(session.actor, sheet, mapping);
});
