"use client";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";
import { Select } from "../ui/Select";

export function UncertainSendResolution({ draftId, onResolved }: { draftId: Id<"drafts">; onResolved: (outcome: "delivered" | "notDelivered") => void }) {
  const [refreshAt, setRefreshAt] = useState(() => Date.now());
  const [selected, setSelected] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const attempts = useQuery(api.send.uncertainDraftAttempts, { draftId, refreshAt });
  const resolve = useMutation(api.send.resolveUncertainDraft);
  // Crashed attempts become eligible with age, even without a database write.
  useEffect(() => { const id = setInterval(() => setRefreshAt(Date.now()), 60_000); return () => clearInterval(id); }, []);
  const attempt = selected ? attempts?.find(a => a.sendLogId === selected) : attempts?.length === 1 ? attempts[0] : undefined;
  const settle = async (outcome: "delivered" | "notDelivered") => {
    if (!attempt || !confirmed || pending || !(outcome === "delivered" ? attempt.canConfirmDelivered : attempt.canConfirmNotDelivered)) return;
    setPending(true); setError("");
    try {
      await resolve({ draftId, sendLogId: attempt.sendLogId, outcome, confirmed: true });
      onResolved(outcome);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not resolve delivery"); }
    finally { setPending(false); }
  };
  return <div className="mt-3 space-y-2 text-primary">
    <p>Check Sent and delivery evidence first. An empty Sent folder does not prove non-delivery; retrying can send duplicates.</p>
    {attempts && attempts.length > 1 && <Select label="Send attempt" value={selected} disabled={pending} onChange={value => { setSelected(value); setConfirmed(false); }} options={[
      { value: "", label: "Select the attempt you checked" },
      ...attempts.map(a => ({ value: a.sendLogId, label: `${new Date(a.createdAt).toLocaleString()} · ${a.messageIdHeader}` })),
    ]} />}
    {attempt && <p className="text-secondary break-all">Attempt: {attempt.messageIdHeader}</p>}
    <label className="flex items-start gap-2"><input type="checkbox" checked={confirmed} disabled={pending} onChange={e => setConfirmed(e.target.checked)} className="mt-1" />I verified the outcome and understand the duplicate-send risk.</label>
    <div className="flex flex-wrap gap-2">
      <button type="button" className="pressable rounded-md border border-divider px-2 py-1 disabled:opacity-50" disabled={!confirmed || pending || !attempt?.canConfirmDelivered} onClick={() => void settle("delivered")}>Confirm delivered · remove draft</button>
      <button type="button" className="pressable rounded-md border border-divider px-2 py-1 disabled:opacity-50" disabled={!confirmed || pending || !attempt?.canConfirmNotDelivered} onClick={() => void settle("notDelivered")}>Confirm not delivered · unlock draft</button>
    </div>
    {!attempt && <p className="text-secondary">{attempts === undefined ? "Loading send attempts…" : attempts.length ? "Select a send attempt before confirming." : "No uncertain send attempt was found."}</p>}
    {attempt && !attempt.canConfirmDelivered && !attempt.canConfirmNotDelivered && <p className="text-secondary">This attempt is still active or awaiting delivery finalization. Keep it locked until that finishes.</p>}
    {error && <p role="alert" className="text-red-500">{error}</p>}
  </div>;
}
