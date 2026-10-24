import { redirect } from "next/navigation";

/** Customer-facing root goes to the order menu. Kitchen stays at /kitchen (or kitchen. subdomain). */
export default function HomePage() {
  redirect("/order");
}
