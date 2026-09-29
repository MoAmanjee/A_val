import { route } from "@/lib/api";
import { ValidationError } from "@/lib/errors";
import { publicBusiness, uploadLogo } from "@/services/settings";

export const POST = route(
  async ({ req, session }) => {
    const form = await req.formData();
    const file = form.get("file");
    if (!(file instanceof File)) throw new ValidationError("Attach a PNG or JPEG logo");
    const updated = await uploadLogo(session.actor, Buffer.from(await file.arrayBuffer()), file.type);
    return { business: publicBusiness(updated) };
  },
  { roles: ["BUSINESS_ADMIN"] },
);
