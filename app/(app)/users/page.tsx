"use client";

import { KeyRound, Plus, Power } from "lucide-react";
import { useState } from "react";
import { Badge, Button, Card, EmptyState, ErrorBanner, Field, Input, Modal, PageHeader, Select, Spinner, Table, Td, Th, errText, useToast } from "@/components/ui";
import { api, useApi } from "@/lib/client";
import { dateOnly } from "@/lib/format";

interface U { id: string; name: string; email: string; role: string; active: boolean; createdAt: string }

export default function UsersPage() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<{ items: U[] }>("/api/users");
  const me = useApi<{ user: { id: string } }>("/api/auth/me");
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ name: "", email: "", password: "", role: "STAFF" });
  const [pw, setPw] = useState<{ user: U; password: string } | null>(null);
  const [busy, setBusy] = useState(false);

  async function create() {
    setBusy(true);
    try {
      await api("/api/users", { body: form });
      toast.success("User created");
      setCreating(false);
      setForm({ name: "", email: "", password: "", role: "STAFF" });
      void reload();
    } catch (e) {
      toast.error(errText(e));
    } finally {
      setBusy(false);
    }
  }
  async function patch(u: U, body: object, ok: string) {
    try {
      await api(`/api/users/${u.id}`, { method: "PUT", body });
      toast.success(ok);
      setPw(null);
      void reload();
    } catch (e) {
      toast.error(errText(e));
    }
  }

  return (
    <>
      <PageHeader title="Users" subtitle="People who can sign in to this business's dashboard" actions={<Button onClick={() => setCreating(true)}><Plus className="h-4 w-4" /> Add user</Button>} />
      <ErrorBanner message={error} onRetry={reload} />
      <Card padded={false}>
        {loading && !data ? <Spinner /> : !data?.items.length ? <EmptyState title="No users" /> : (
          <Table>
            <thead><tr><Th>Name</Th><Th>Email</Th><Th>Role</Th><Th>Status</Th><Th>Added</Th><Th /></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {data.items.map((u) => (
                <tr key={u.id} className={u.active ? "" : "opacity-60"}>
                  <Td className="font-medium text-slate-900">{u.name}{me.data?.user.id === u.id && <Badge className="ml-2">you</Badge>}</Td>
                  <Td>{u.email}</Td>
                  <Td>
                    <Select className="w-40 !py-1" value={u.role} disabled={u.role === "SUPER_ADMIN" || me.data?.user.id === u.id} onChange={(e) => void patch(u, { role: e.target.value }, "Role updated")} aria-label={`Role for ${u.name}`}>
                      {u.role === "SUPER_ADMIN" && <option value="SUPER_ADMIN">Platform admin</option>}
                      <option value="BUSINESS_ADMIN">Business admin</option><option value="STAFF">Staff</option>
                    </Select>
                  </Td>
                  <Td><Badge tone={u.active ? "green" : "slate"}>{u.active ? "Active" : "Deactivated"}</Badge></Td>
                  <Td>{dateOnly(u.createdAt)}</Td>
                  <Td align="right">
                    <div className="flex justify-end gap-1">
                      <Button size="sm" variant="ghost" title="Reset password" aria-label={`Reset password for ${u.name}`} onClick={() => setPw({ user: u, password: "" })}><KeyRound className="h-4 w-4" /></Button>
                      {me.data?.user.id !== u.id && <Button size="sm" variant="ghost" title={u.active ? "Deactivate" : "Reactivate"} aria-label={u.active ? `Deactivate ${u.name}` : `Reactivate ${u.name}`} onClick={() => void patch(u, { active: !u.active }, u.active ? "User deactivated" : "User reactivated")}><Power className={`h-4 w-4 ${u.active ? "text-red-600" : "text-emerald-600"}`} /></Button>}
                    </div>
                  </Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>

      <Modal size="sm" open={creating} onClose={() => setCreating(false)} title="Add user" footer={<><Button variant="secondary" onClick={() => setCreating(false)}>Cancel</Button><Button loading={busy} disabled={!form.name || !form.email || form.password.length < 10} onClick={create}>Create user</Button></>}>
        <div className="space-y-4">
          <Field label="Name"><Input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
          <Field label="Email"><Input type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label="Temporary password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          <Field label="Role"><Select value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}><option value="STAFF">Staff - day to day work</option><option value="BUSINESS_ADMIN">Business admin - settings and users</option></Select></Field>
        </div>
      </Modal>
      <Modal size="sm" open={!!pw} onClose={() => setPw(null)} title={pw ? `Reset password - ${pw.user.name}` : ""} footer={<><Button variant="secondary" onClick={() => setPw(null)}>Cancel</Button><Button disabled={!pw || pw.password.length < 10} onClick={() => pw && void patch(pw.user, { password: pw.password }, "Password updated")}>Update password</Button></>}>
        {pw && <Field label="New password" hint="At least 10 characters"><Input type="password" autoComplete="new-password" value={pw.password} onChange={(e) => setPw({ ...pw, password: e.target.value })} /></Field>}
      </Modal>
    </>
  );
}
