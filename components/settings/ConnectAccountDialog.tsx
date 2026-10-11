"use client";

import { useAction } from "convex/react";
import { api } from "@/convex/_generated/api";
import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { ChevronDown } from "lucide-react";
import { toast } from "sonner";

const inputCls =
  "w-full h-9 px-2.5 rounded-lg bg-search-field text-primary text-[13px]/4 outline-none placeholder:text-quaternary";
const labelCls = "text-secondary text-[13px]/4 font-medium mb-1 block";

export function ConnectAccountDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const connect = useAction(api.accounts.connect);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [advanced, setAdvanced] = useState(false);
  const [imapHost, setImapHost] = useState("mail.spacemail.com");
  const [imapPort, setImapPort] = useState("993");
  const [smtpHost, setSmtpHost] = useState("mail.spacemail.com");
  const [smtpPort, setSmtpPort] = useState("465");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [syncing, setSyncing] = useState(false);

  const submit = async () => {
    if (!email || !password) {
      setError("Email and password are required");
      return;
    }
    setBusy(true);
    setError(undefined);
    try {
      await connect({
        email,
        password,
        displayName: displayName || undefined,
        imapHost: advanced ? imapHost : undefined,
        imapPort: advanced ? Number(imapPort) : undefined,
        smtpHost: advanced ? smtpHost : undefined,
        smtpPort: advanced ? Number(smtpPort) : undefined,
      });
      setSyncing(true);
      toast("Account connected. Initial sync is running.");
      setTimeout(() => {
        setSyncing(false);
        onClose();
      }, 1200);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Could not connect the mailbox",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog.Root open={open} onOpenChange={(o: boolean) => !o && onClose()}>
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Popup className="dialog-popup fixed left-1/2 top-1/2 z-[61] w-105 max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-menu p-5 menu-shadow ring-1 ring-menu-ring">
          <Dialog.Title className="font-semibold text-primary text-[15px]/5">
            Connect account
          </Dialog.Title>
          <Dialog.Description className="text-tertiary text-[13px]/4.5 mt-1">
            Post validates your mailbox over IMAP and SMTP before saving.
          </Dialog.Description>
          <div className="flex flex-col gap-3 mt-4">
            <div>
              <label className={labelCls}>Email</label>
              <input
                className={inputCls}
                type="email"
                autoComplete="email"
                placeholder="you@spacemail.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Password</label>
              <input
                className={inputCls}
                type="password"
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className={labelCls}>Display name</label>
              <input
                className={inputCls}
                placeholder="Your name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
              />
            </div>
            <button
              onClick={() => setAdvanced((v) => !v)}
              className="flex items-center gap-1 text-tertiary text-xs/4 w-max"
            >
              <ChevronDown
                size={12}
                className={advanced ? "rotate-180 transition-transform" : "transition-transform"}
              />
              Advanced
            </button>
            {advanced && (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className={labelCls}>IMAP host</label>
                  <input
                    className={inputCls}
                    value={imapHost}
                    onChange={(e) => setImapHost(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>IMAP port</label>
                  <input
                    className={inputCls}
                    value={imapPort}
                    onChange={(e) => setImapPort(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>SMTP host</label>
                  <input
                    className={inputCls}
                    value={smtpHost}
                    onChange={(e) => setSmtpHost(e.target.value)}
                  />
                </div>
                <div>
                  <label className={labelCls}>SMTP port</label>
                  <input
                    className={inputCls}
                    value={smtpPort}
                    onChange={(e) => setSmtpPort(e.target.value)}
                  />
                </div>
              </div>
            )}
            {error && (
              <div className="text-danger text-[13px]/4.5">{error}</div>
            )}
            {syncing && (
              <div className="flex items-center gap-2 text-tertiary text-[13px]/4">
                <span className="size-3.5 rounded-full border-2 border-accent border-t-transparent animate-spin" />
                Connected. Starting the initial sync…
              </div>
            )}
          </div>
          <div className="flex justify-end gap-2 mt-5">
            <button
              onClick={onClose}
              className="pressable h-8 px-3 rounded-lg text-primary text-[13px]/4 font-medium bg-search-field"
            >
              Cancel
            </button>
            <button
              onClick={() => void submit()}
              disabled={busy || syncing}
              className="pressable h-8 px-3 rounded-lg bg-accent text-white font-semibold text-[13px]/4 disabled:opacity-50"
            >
              {busy ? "Connecting…" : "Connect"}
            </button>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
