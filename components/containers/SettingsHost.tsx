"use client";

import { useAction, useMutation, useQuery } from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useMemo, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Switch } from "@base-ui/react/switch";
import { toast } from "sonner";
import { useAppearance } from "@/lib/ui/useAppearance";
import { useUI, type SettingsTab } from "@/lib/ui/store";
import type { AccountInfo, CategoryInfo } from "@/lib/ui/types";
import {
  claudeCodeCommand,
  claudeDesktopConfig,
  cursorConfig,
  codexConfig,
  vscodeConfig,
} from "@/lib/mcp/clientConfigs";
import { CategoryDialog } from "@/components/settings/CategoryDialog";
import { ProfileEditor } from "@/components/settings/ProfileEditor";
import { Select } from "@/components/ui/Select";
import {
  Settings as SettingsIcon,
  Cable,
  Tags,
  Sun,
  KeyRound,
  Keyboard,
  Copy,
  Check,
  Trash2,
  Plus,
  X,
} from "lucide-react";

const inputCls =
  "w-full h-8 px-2.5 rounded-lg bg-search-field text-primary text-[13px]/4 outline-none placeholder:text-quaternary";

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-divider last:border-0">
      <div className="min-w-0">
        <div className="text-primary text-[13px]/4.5 font-medium">{label}</div>
        {hint && <div className="text-tertiary text-xs/4 mt-0.5">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
  label,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
}) {
  return (
    <Switch.Root
      render={<button type="button" />}
      nativeButton
      checked={checked}
      aria-label={label}
      onCheckedChange={onChange}
      className="inline-flex shrink-0 w-9 h-5.5 rounded-full bg-[#0000001F] dark:bg-[#FFFFFF29] data-[checked]:bg-accent switch-track relative"
    >
      <Switch.Thumb className="absolute top-0.5 left-0.5 size-4.5 rounded-full bg-white shadow switch-thumb data-[checked]:translate-x-3.5" />
    </Switch.Root>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      aria-label="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="icon-btn size-7 text-tertiary"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

function GeneralTab() {
  const settings = useQuery(api.settings.get, {});
  const update = useMutation(api.settings.update);
  const accounts = useQuery(api.accounts.list, {});
  if (settings === undefined)
    return <div className="skeleton h-40 w-full rounded-lg" />;
  return (
    <div>
      <ProfileEditor />
      <Row
        label="Automatically load remote images"
        hint="External images can tell senders when you open mail. Off protects your privacy."
      >
        <Toggle
          label="Automatically load remote images"
          checked={settings.loadRemoteImages}
          onChange={(v) => void update({ loadRemoteImages: v }).catch(() => toast.error("Could not save image preference."))}
        />
      </Row>
      <Row label="Undo send" hint="Delay before a sent message leaves Post.">
        <div className="flex rounded-lg bg-search-field p-0.5 gap-0.5">
          {[0, 5, 10, 20].map((s) => (
            <button
              key={s}
              onClick={() => void update({ undoSendSeconds: s })}
              className={`pressable h-6.5 px-2.5 rounded-md text-xs/4 font-medium ${
                settings.undoSendSeconds === s
                  ? "bg-app shadow-sm text-primary"
                  : "text-tertiary"
              }`}
            >
              {s === 0 ? "Off" : `${s}s`}
            </button>
          ))}
        </div>
      </Row>
      <Row label="Default account" hint="Used for new messages.">
        <Select
          label="Default account"
          value={("defaultAccountId" in settings ? settings.defaultAccountId : undefined) ?? ""}
          disabled={accounts === undefined}
          options={[{ value: "", label: "First account" }, ...(accounts ?? []).map(account => ({ value: account._id, label: account.email }))]}
          onChange={value => void update({ defaultAccountId: value ? value as Id<"accounts"> : null }).catch(() => toast.error("Could not save default account."))}
        />
      </Row>
    </div>
  );
}

function ConnectionsTab({
  accounts,
  onConnect,
}: {
  accounts: AccountInfo[];
  onConnect: () => void;
}) {
  const update = useMutation(api.accounts.update);
  const updateCreds = useAction(api.accounts.updateCredentials);
  const remove = useMutation(api.accounts.remove);
  const syncNow = useMutation(api.accounts.syncNow);
  const [editing, setEditing] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [signature, setSignature] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const saveRow = async (a: AccountInfo) => {
    setBusy(a.id);
    try {
      await update({
        accountId: a.id as Id<"accounts">,
        displayName: name || undefined,
        signatureHtml: signature || undefined,
      });
      if (password) {
        await updateCreds({
          accountId: a.id as Id<"accounts">,
          password,
        });
      }
      toast("Account updated");
      setEditing(null);
      setPassword("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {accounts.length === 0 && (
        <div className="text-tertiary text-[13px]/4.5 py-6 text-center">
          No mailboxes connected yet.
        </div>
      )}
      {accounts.map((a) => (
        <div
          key={a.id}
          className="rounded-xl border border-divider p-3.5 flex flex-col gap-2"
        >
          <div className="flex items-center gap-2.5">
            <div className="flex items-center justify-center size-7 rounded-md bg-badge-bg text-[13px] font-semibold text-icon-strong">
              {(a.displayName || a.email)[0]?.toUpperCase()}
            </div>
            <div className="min-w-0 grow">
              <div className="text-primary text-[13px]/4 font-medium truncate">
                {a.displayName || a.email}
              </div>
              <div className="text-tertiary text-xs/4 truncate">{a.email}</div>
            </div>
            <div
              className={`size-2 rounded-full ${
                a.status === "error" || a.status === "auth_error"
                  ? "bg-danger"
                  : "bg-[#34C759]"
              }`}
              title={a.lastError ?? a.status}
            />
            <button
              onClick={() => {
                setBusy(a.id);
                void syncNow({ accountId: a.id as Id<"accounts"> })
                  .catch(() => {})
                  .finally(() => setBusy(null));
              }}
              className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-primary"
            >
              {busy === a.id ? "Syncing…" : "Sync now"}
            </button>
          </div>
          {a.lastError && (
            <div className="text-danger text-xs/4">{a.lastError}</div>
          )}
          {editing === a.id ? (
            <div className="flex flex-col gap-2 pt-1">
              <input
                className={inputCls}
                placeholder="Display name"
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
              <input
                className={inputCls}
                placeholder="Signature (HTML allowed)"
                value={signature}
                onChange={(e) => setSignature(e.target.value)}
              />
              <input
                className={inputCls}
                type="password"
                placeholder="New password (leave blank to keep)"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => setEditing(null)}
                  className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-primary"
                >
                  Cancel
                </button>
                <button
                  onClick={() => void saveRow(a)}
                  className="pressable h-7 px-2.5 rounded-md text-xs/4 font-semibold bg-accent text-white"
                >
                  Save
                </button>
              </div>
            </div>
          ) : (
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => {
                  setEditing(a.id);
                  setName(a.displayName ?? "");
                  setSignature("");
                  setPassword("");
                }}
                className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-primary"
              >
                Edit
              </button>
              <button
                onClick={() => {
                  if (window.confirm(`Remove ${a.email}? This deletes its synced mail.`)) {
                    void remove({ accountId: a.id as Id<"accounts"> }).then(
                      () => toast("Account removed"),
                      (e) =>
                        toast.error(
                          e instanceof Error ? e.message : "Remove failed",
                        ),
                    );
                  }
                }}
                className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-danger"
              >
                Remove
              </button>
            </div>
          )}
        </div>
      ))}
      <button
        onClick={onConnect}
        className="pressable flex items-center justify-center gap-1.5 h-9 rounded-lg bg-search-field text-primary text-[13px]/4 font-medium"
      >
        <Plus size={14} /> Connect account
      </button>
    </div>
  );
}

function CategoriesTab({ categories }: { categories: CategoryInfo[] }) {
  const remove = useMutation(api.categories.remove);
  const [dialog, setDialog] = useState<
    { mode: "create" } | { mode: "edit"; category: CategoryInfo } | null
  >(null);
  return (
    <div className="flex flex-col gap-2">
      {categories.map((c) => (
        <div
          key={c.id}
          className="flex items-center gap-2.5 rounded-xl border border-divider px-3 h-12"
        >
          <div
            className="size-3 rounded-[4px] shrink-0"
            style={{ background: c.color }}
          />
          <div className="min-w-0 grow">
            <div className="text-primary text-[13px]/4 font-medium truncate">
              {c.name}
            </div>
            {c.description && (
              <div className="text-tertiary text-xs/4 truncate">
                {c.description}
              </div>
            )}
          </div>
          <button
            onClick={() => setDialog({ mode: "edit", category: c })}
            className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-primary"
          >
            Edit
          </button>
          <button
            aria-label={`Delete ${c.name}`}
            onClick={() => {
              if (window.confirm(`Delete category "${c.name}"?`)) {
                void remove({ categoryId: c.id as Id<"categories"> }).then(
                  () => toast("Category deleted"),
                  (e) =>
                    toast.error(
                      e instanceof Error ? e.message : "Delete failed",
                    ),
                );
              }
            }}
            className="icon-btn size-7 text-tertiary"
          >
            <Trash2 size={14} />
          </button>
        </div>
      ))}
      <button
        onClick={() => setDialog({ mode: "create" })}
        className="pressable flex items-center justify-center gap-1.5 h-9 rounded-lg bg-search-field text-primary text-[13px]/4 font-medium"
      >
        <Plus size={14} /> New category
      </button>
      <div className="text-tertiary text-xs/4 px-1">
        Categories classify new mail only. Existing mail is never reclassified.
      </div>
      {dialog && (
        <CategoryDialog
          mode={dialog.mode}
          category={dialog.mode === "edit" ? dialog.category : undefined}
          onClose={() => setDialog(null)}
        />
      )}
    </div>
  );
}

function AppearanceTab() {
  const { theme, setAppearance } = useAppearance();
  const options = [
    { id: "light", label: "Light" },
    { id: "dark", label: "Dark" },
    { id: "system", label: "System" },
  ] as const;
  return (
    <div className="flex gap-3">
      {options.map((o) => (
        <button
          key={o.id}
          onClick={() => setAppearance(o.id)}
          className={`pressable flex flex-col items-center gap-2 p-3 rounded-xl border w-28 ${
            theme === o.id ? "border-accent" : "border-divider"
          }`}
        >
          <div
            className={`w-full h-14 rounded-lg ${
              o.id === "dark"
                ? "bg-[#1C1C1E]"
                : o.id === "light"
                  ? "bg-white border border-divider"
                  : "bg-gradient-to-r from-white via-white to-[#1C1C1E] border border-divider"
            }`}
          />
          <span className="text-primary text-[13px]/4 font-medium">
            {o.label}
          </span>
        </button>
      ))}
    </div>
  );
}

const TOOL_LIST = [
  "list_accounts",
  "sync_mailboxes",
  "load_older_emails",
  "list_threads",
  "search_emails",
  "get_thread",
  "get_email",
  "get_attachment",
  "get_unread_counts",
  "send_email",
  "reply_to_email",
  "forward_email",
  "list_drafts",
  "get_draft",
  "create_draft",
  "update_draft",
  "delete_draft",
  "send_draft",
  "cancel_scheduled_send",
  "mark_read",
  "mark_unread",
  "star",
  "unstar",
  "archive",
  "trash",
  "restore",
  "delete_permanently",
  "snooze",
  "move_to_inbox",
  "list_categories",
  "create_category",
  "update_category",
  "delete_category",
  "assign_categories",
];

function ApiKeysTab() {
  const keys = useQuery(api.apiKeys.list, {});
  const create = useMutation(api.apiKeys.create);
  const revoke = useMutation(api.apiKeys.revoke);
  const [name, setName] = useState("");
  const [newKey, setNewKey] = useState<string>();
  const [client, setClient] = useState<
    "claude-code" | "claude-desktop" | "cursor" | "codex" | "vscode"
  >("claude-code");
  const [showTools, setShowTools] = useState(false);
  const url =
    typeof window !== "undefined" ? `${window.location.origin}/api/mcp` : "";
  const snippet = useMemo(() => {
    switch (client) {
      case "claude-code":
        return claudeCodeCommand(url);
      case "claude-desktop":
        return claudeDesktopConfig(url);
      case "cursor":
        return cursorConfig(url);
      case "codex":
        return codexConfig(url);
      case "vscode":
        return vscodeConfig(url);
    }
  }, [client, url]);

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="text-primary text-[13px]/4.5 font-medium mb-1">
          Server URL
        </div>
        <div className="flex items-center gap-1 rounded-lg bg-search-field pl-2.5 h-8">
          <code className="grow text-primary text-xs truncate">{url}</code>
          <CopyButton text={url} />
        </div>
        <p className="mt-2 text-tertiary text-xs/4">
          This URL follows the site you are using. After deployment, open Settings
          on your production domain to copy its MCP URL. Connect using a Post API
          key as a Bearer token.
        </p>
      </div>

      {newKey && (
        <div className="rounded-xl border border-[#FF9F0A66] bg-[#FF9F0A14] p-3">
          <div className="text-primary text-[13px]/4.5 font-medium">
            Copy this key now. It will not be shown again.
          </div>
          <div className="flex items-center gap-1 mt-2 rounded-lg bg-app px-2.5 h-8">
            <code className="grow text-primary text-xs truncate">{newKey}</code>
            <CopyButton text={newKey} />
          </div>
          <button
            onClick={() => setNewKey(undefined)}
            className="text-tertiary text-xs/4 mt-2"
          >
            Done
          </button>
        </div>
      )}

      <div className="flex gap-2">
        <input
          className={inputCls}
          placeholder="Key name (e.g. Claude Desktop)"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          disabled={!name.trim()}
          onClick={() => {
            void create({ name: name.trim() })
              .then((r) => {
                setNewKey(r.key);
                setName("");
              })
              .catch((e) =>
                toast.error(
                  e instanceof Error ? e.message : "Could not create key",
                ),
              );
          }}
          className="pressable shrink-0 h-8 px-3 rounded-lg bg-accent text-white font-semibold text-[13px]/4 disabled:opacity-50"
        >
          Create key
        </button>
      </div>

      <div className="flex flex-col">
        {(keys ?? []).map((k) => (
          <div
            key={k._id}
            className="flex items-center gap-2.5 py-2.5 border-b border-divider last:border-0"
          >
            <KeyRound size={14} className="text-tertiary shrink-0" />
            <div className="min-w-0 grow">
              <div className="text-primary text-[13px]/4 font-medium truncate">
                {k.name}
              </div>
              <div className="text-tertiary text-xs/4">
                {k.prefix}… · created{" "}
                {new Date(k.createdAt).toLocaleDateString()}
                {k.lastUsedAt
                  ? ` · last used ${new Date(k.lastUsedAt).toLocaleDateString()}`
                  : ""}
                {k.revokedAt ? " · revoked" : ""}
              </div>
            </div>
            {!k.revokedAt && (
              <button
                onClick={() => {
                  if (window.confirm(`Revoke "${k.name}"? Clients using it will lose access.`)) {
                    void revoke({ apiKeyId: k._id }).then(
                      () => toast("Key revoked"),
                      (e) =>
                        toast.error(
                          e instanceof Error ? e.message : "Revoke failed",
                        ),
                    );
                  }
                }}
                className="pressable h-7 px-2.5 rounded-md text-xs/4 font-medium bg-search-field text-danger"
              >
                Revoke
              </button>
            )}
          </div>
        ))}
        {keys?.length === 0 && (
          <div className="text-tertiary text-[13px]/4.5 py-3">
            No API keys yet.
          </div>
        )}
      </div>

      <div>
        <div className="text-primary text-[13px]/4.5 font-medium mb-1.5">
          Client setup
        </div>
        <div className="flex rounded-lg bg-search-field p-0.5 gap-0.5 mb-2 w-max">
          {(
            [
              ["claude-code", "Claude Code"],
              ["claude-desktop", "Claude Desktop"],
              ["cursor", "Cursor"],
              ["codex", "Codex"],
              ["vscode", "VS Code"],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              onClick={() => setClient(id)}
              className={`pressable h-6.5 px-2.5 rounded-md text-xs/4 font-medium ${
                client === id
                  ? "bg-app shadow-sm text-primary"
                  : "text-tertiary"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="relative rounded-lg bg-search-field p-2.5">
          <pre className="text-primary text-[11px]/4 whitespace-pre-wrap break-all">
            {snippet}
          </pre>
          <div className="absolute top-1.5 right-1.5">
            <CopyButton text={snippet} />
          </div>
        </div>
      </div>

      <div>
        <button
          onClick={() => setShowTools((v) => !v)}
          className="text-tertiary text-xs/4"
        >
          {showTools ? "Hide" : "Show"} available tools ({TOOL_LIST.length})
        </button>
        {showTools && (
          <div className="flex flex-wrap gap-1.5 mt-2">
            {TOOL_LIST.map((t) => (
              <code
                key={t}
                className="px-1.5 py-0.5 rounded bg-search-field text-primary text-[11px]"
              >
                {t}
              </code>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["j / ↓", "Next thread"],
  ["k / ↑", "Previous thread"],
  ["Enter", "Open thread"],
  ["Esc", "Close / back"],
  ["e", "Archive"],
  ["# or Del", "Trash"],
  ["s", "Star"],
  ["u", "Toggle read"],
  ["r / a / f", "Reply / Reply all / Forward"],
  ["c", "Compose"],
  ["/ or ⌘K", "Search"],
  ["z", "Undo"],
  ["g then p/o/s/d/a/t", "Go to view"],
  ["[ / ]", "Previous / next in reader"],
  ["⌘↵", "Send"],
  ["⌘,", "Settings"],
  ["?", "This sheet"],
];

function KeyboardTab() {
  return (
    <div className="flex flex-col">
      {SHORTCUTS.map(([k, d]) => (
        <div
          key={k}
          className="flex items-center justify-between py-2 border-b border-divider last:border-0"
        >
          <span className="text-primary text-[13px]/4">{d}</span>
          <span className="kbd">{k}</span>
        </div>
      ))}
    </div>
  );
}

const TABS: { id: SettingsTab; label: string; icon: React.ReactNode }[] = [
  { id: "general", label: "General", icon: <SettingsIcon size={15} /> },
  { id: "connections", label: "Connections", icon: <Cable size={15} /> },
  { id: "categories", label: "Categories", icon: <Tags size={15} /> },
  { id: "appearance", label: "Appearance", icon: <Sun size={15} /> },
  { id: "mcp", label: "MCP & API Keys", icon: <KeyRound size={15} /> },
  { id: "keyboard", label: "Keyboard", icon: <Keyboard size={15} /> },
];

export function SettingsHost({
  categories,
  accounts,
  onConnectAccount,
}: {
  categories: CategoryInfo[];
  accounts: AccountInfo[];
  onConnectAccount: () => void;
}) {
  const open = useUI((s) => s.settingsOpen);
  const tab = useUI((s) => s.settingsTab);
  const ui = useUI();

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(o: boolean) => !o && ui.closeSettings()}
    >
      <Dialog.Portal>
        <Dialog.Backdrop className="dialog-backdrop fixed inset-0 z-[60] bg-black/25" />
        <Dialog.Popup className="dialog-popup fixed left-1/2 top-1/2 z-[61] w-176 max-w-[94vw] h-[min(36rem,88vh)] -translate-x-1/2 -translate-y-1/2 rounded-xl bg-app menu-shadow ring-1 ring-menu-ring overflow-clip flex">
          <div className="w-14 sm:w-44 shrink-0 bg-sidebar border-r border-sidebar-border p-2 pt-4 flex flex-col gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                aria-label={t.label}
                title={t.label}
                onClick={() => ui.openSettings(t.id)}
                className={`pressable flex items-center gap-2 h-8 px-2.5 rounded-lg text-[13px]/4 text-left ${
                  tab === t.id
                    ? "bg-sidebar-selected text-primary font-medium"
                    : "text-secondary"
                }`}
              >
                {t.icon}
                <span className="hidden sm:inline">{t.label}</span>
              </button>
            ))}
          </div>
          <div className="grow min-w-0 flex flex-col">
            <div className="flex items-center justify-between h-12 px-5 border-b border-divider shrink-0">
              <Dialog.Title className="font-semibold text-primary text-[15px]/5">
                {TABS.find((t) => t.id === tab)?.label}
              </Dialog.Title>
              <button
                aria-label="Close settings"
                onClick={() => ui.closeSettings()}
                className="icon-btn size-7 text-tertiary"
              >
                <X size={16} />
              </button>
            </div>
            <div className="grow overflow-y-auto p-5">
              {tab === "general" && <GeneralTab />}
              {tab === "connections" && (
                <ConnectionsTab
                  accounts={accounts}
                  onConnect={onConnectAccount}
                />
              )}
              {tab === "categories" && <CategoriesTab categories={categories} />}
              {tab === "appearance" && <AppearanceTab />}
              {tab === "mcp" && <ApiKeysTab />}
              {tab === "keyboard" && <KeyboardTab />}
            </div>
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
