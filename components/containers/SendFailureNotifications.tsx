"use client";

import { useEffect, useRef } from "react";
import { useQuery } from "convex/react";
import { toast } from "sonner";
import { api } from "@/convex/_generated/api";
import { useUI } from "@/lib/ui/store";
import { draftSendProblem } from "@/lib/ui/draftSendProblem";

export function SendFailureNotifications() {
  const problems = useQuery(api.drafts.sendProblems, {});
  const seen = useRef(new Map<string, string>());
  useEffect(() => {
    if (!problems) return;
    const active = new Set<string>(problems.map(draft => draft.draftId));
    for (const id of seen.current.keys()) {
      if (!active.has(id)) {
        toast.dismiss(`send-problem-${id}`);
        seen.current.delete(id);
      }
    }
    for (const draft of problems) {
      const version = JSON.stringify([draft.updatedAt, draft.status, draft.sendError]);
      if (seen.current.get(draft.draftId) === version) continue;
      seen.current.set(draft.draftId, version);
      toast.error(draftSendProblem(draft), {
        id: `send-problem-${draft.draftId}`,
        description: draft.subject || "(no subject)",
        duration: Infinity,
        action: {
          label: "View draft",
          onClick: () => useUI.getState().openCompose({ mode: "draft", draftId: draft.draftId }),
        },
      });
    }
  }, [problems]);
  return null;
}
