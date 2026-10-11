"use client";

import {
  useAction,
  useMutation,
  useQuery,
} from "convex/react";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { composeAccount } from "@/lib/ui/composeAccount";
import {
  ComposeWindow,
  QuotedPreview,
  type ComposeAttachment,
  type RecipientChip,
} from "@/components/compose/ComposeWindow";

import {
  useComposeEditor,
  ComposeEditorArea,
} from "@/components/compose/Editor";
import { useUI, type ComposeWindowState } from "@/lib/ui/store";
import type {
  AccountInfo,
  AddressInfo,
  AttachmentInfo,
} from "@/lib/ui/types";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { Menu } from "@base-ui/react/menu";
import { Popover } from "@base-ui/react/popover";
import {
  Bold,
  Italic,
  Underline as UnderlineIcon,
  Strikethrough,
  List,
  ListOrdered,
  Quote,
  Eraser,
  Clock,
} from "lucide-react";
import { ChevronsUpDown } from "@/components/icons";
import { getCached } from "@/lib/ui/contentCache";
import { replyRecipients, replySubjectFor, forwardSubjectFor, htmlToText } from "@/convex/lib/compose";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function stripHtml(html: string): string | undefined {
  return htmlToText(html) || undefined;
}

function toChip(a: AddressInfo): RecipientChip {
  return { email: a.email, name: a.name };
}

function parseInput(raw: string): RecipientChip[] {
  return raw
    .split(/[,;]+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => {
      const m = s.match(/^(.*?)<([^>]+)>\s*$/);
      const email = m ? m[2].trim() : s;
      const name = m ? m[1].trim().replace(/^"|"$/g, "") : undefined;
      return { email, name, invalid: !EMAIL_RE.test(email) };
    });
}

function AddressField({
  onAdd,
  onBackspace,
  hasChips,
  suggestions,
  onSelectSuggestion,
  onQuery,
  placeholder,
}: {
  onAdd: (chips: RecipientChip[]) => void;
  onBackspace: () => void;
  hasChips: boolean;
  suggestions: { name?: string; email: string }[];
  onSelectSuggestion: (s: { name?: string; email: string }) => void;
  onQuery: (q: string) => void;
  placeholder?: string;
}) {
  const [value, setValue] = useState("");
  const [open, setOpen] = useState(false);

  const commit = (raw: string) => {
    const parsed = parseInput(raw);
    if (parsed.length) {
      onAdd(parsed);
      setValue("");
      onQuery("");
    }
  };

  return (
    <div className="relative flex items-center grow basis-24 min-w-20">
      <input
        value={value}
        placeholder={hasChips ? undefined : placeholder}
        onChange={(e) => {
          const v = e.target.value;
          if (/[,;]/.test(v)) {
            commit(v);
            return;
          }
          setValue(v);
          onQuery(v);
          setOpen(true);
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && value.trim()) {
            e.preventDefault();
            commit(value);
            setOpen(false);
          } else if (e.key === "Backspace" && !value && hasChips) {
            onBackspace();
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
        onBlur={() => {
          setTimeout(() => setOpen(false), 150);
          if (value.trim()) commit(value);
        }}
        onFocus={() => value && setOpen(true)}
        onPaste={(e) => {
          const text = e.clipboardData.getData("text");
          if (/[,;]/.test(text)) {
            e.preventDefault();
            commit((value + " " + text).trim());
          }
        }}
        className="w-full bg-transparent text-primary text-[13px]/4 outline-none placeholder:text-quaternary"
      />
      {open && suggestions.length > 0 && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-[10px] bg-menu p-1 menu-shadow ring-1 ring-menu-ring overflow-clip">
          {suggestions.map((s) => (
            <button
              key={s.email}
              onMouseDown={(e) => {
                e.preventDefault();
                onSelectSuggestion(s);
                setValue("");
                onQuery("");
                setOpen(false);
              }}
              className="flex w-full items-center rounded-md px-2 h-8 gap-2 text-left hover:bg-hover data-[hovered]:bg-hover"
            >
              <span className="text-primary text-[13px]/4 font-medium truncate">
                {s.name || s.email}
              </span>
              <span className="text-tertiary text-xs/4 truncate">{s.email}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FormatBar({ editor }: { editor: ReturnType<typeof useComposeEditor> }) {
  if (!editor) return null;
  const btn = (
    label: string,
    active: boolean,
    onClick: () => void,
    icon: React.ReactNode,
  ) => (
    <button
      aria-label={label}
      title={label}
      data-active={active || undefined}
      onMouseDown={(e) => {
        e.preventDefault();
        onClick();
      }}
      className="icon-btn w-7 h-7 data-[active]:bg-hover-strong"
    >
      {icon}
    </button>
  );
  return (
    <div className="flex items-center shrink-0 h-9 px-3 gap-0.5 border-b border-divider">
      {btn("Bold", editor.isActive("bold"), () => editor.chain().focus().toggleBold().run(), <Bold size={14} strokeWidth={2} />)}
      {btn("Italic", editor.isActive("italic"), () => editor.chain().focus().toggleItalic().run(), <Italic size={14} strokeWidth={2} />)}
      {btn("Underline", editor.isActive("underline"), () => editor.chain().focus().toggleUnderline().run(), <UnderlineIcon size={14} strokeWidth={2} />)}
      {btn("Strikethrough", editor.isActive("strike"), () => editor.chain().focus().toggleStrike().run(), <Strikethrough size={14} strokeWidth={2} />)}
      <div className="w-px h-4 bg-divider mx-1.5" />
      {btn("Bullet list", editor.isActive("bulletList"), () => editor.chain().focus().toggleBulletList().run(), <List size={14} strokeWidth={2} />)}
      {btn("Numbered list", editor.isActive("orderedList"), () => editor.chain().focus().toggleOrderedList().run(), <ListOrdered size={14} strokeWidth={2} />)}
      {btn("Quote", editor.isActive("blockquote"), () => editor.chain().focus().toggleBlockquote().run(), <Quote size={14} strokeWidth={2} />)}
      <div className="w-px h-4 bg-divider mx-1.5" />
      {btn("Clear formatting", false, () => editor.chain().focus().unsetAllMarks().clearNodes().run(), <Eraser size={14} strokeWidth={2} />)}
    </div>
  );
}

function SchedulePopover({ onSchedule }: { onSchedule: (at: number) => void }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState("");
  const presets: { label: string; at: () => number }[] = [
    {
      label: "Tomorrow morning",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(9, 0, 0, 0);
        return d.getTime();
      },
    },
    {
      label: "Tomorrow afternoon",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 1);
        d.setHours(13, 0, 0, 0);
        return d.getTime();
      },
    },
    {
      label: "Next week",
      at: () => {
        const d = new Date();
        d.setDate(d.getDate() + 7);
        d.setHours(9, 0, 0, 0);
        return d.getTime();
      },
    },
  ];
  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger
        aria-label="Schedule send"
        className="icon-btn w-7.5 h-7.5"
      >
        <Clock size={16} strokeWidth={1.8} />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="start" sideOffset={8} className="z-50">
          <Popover.Popup className="popover-popup w-64 rounded-[10px] bg-menu p-1.5 menu-shadow ring-1 ring-menu-ring">
            {presets.map((pr) => (
              <button
                key={pr.label}
                onClick={() => {
                  onSchedule(pr.at());
                  setOpen(false);
                }}
                className="flex w-full items-center rounded-md px-2 h-8 text-primary text-[13px]/4 hover:bg-hover"
              >
                {pr.label}
              </button>
            ))}
            <div className="flex items-center gap-2 px-2 py-1.5 mt-1 border-t border-divider">
              <input
                type="datetime-local"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                className="grow bg-search-field rounded-md px-2 h-7 text-primary text-xs outline-none"
              />
              <button
                onClick={() => {
                  const t = new Date(custom).getTime();
                  if (t > Date.now()) {
                    onSchedule(t);
                    setOpen(false);
                  }
                }}
                className="pressable h-7 px-2 rounded-md bg-accent text-white font-semibold text-xs"
              >
                Set
              </button>
            </div>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

function ComposePane({
  win,
  accounts,
  undoSendSeconds,
  defaultAccountId,
}: {
  win: ComposeWindowState;
  accounts: AccountInfo[];
  undoSendSeconds: number;
  defaultAccountId?: string;
}) {
  const ui = useUI();
  const isMobile = useMediaQuery("(max-width: 767px)");
  const existingDraft = useQuery(
    api.drafts.get,
    win.mode === "draft" && win.draftId
      ? { draftId: win.draftId as Id<"drafts"> }
      : "skip",
  );
  const replyTo = useQuery(
    api.mail.getMessage,
    win.replyToMessageId
      ? { messageId: win.replyToMessageId as Id<"messages"> }
      : "skip",
  );

  const createDraft = useMutation(api.drafts.create);
  const updateDraft = useMutation(api.drafts.update);
  const addAttachment = useMutation(api.drafts.addAttachment);
  const removeAttachment = useMutation(api.drafts.removeAttachment);
  const discardDraft = useMutation(api.drafts.discard);
  const scheduleSend = useMutation(api.drafts.scheduleSend);
  const cancelSchedule = useMutation(api.drafts.cancelScheduledSend);
  const genUploadUrl = useMutation(api.drafts.generateUploadUrl);
  const getContent = useAction(api.content.getMessageContent);

  const [to, setTo] = useState<RecipientChip[]>([]);
  const [cc, setCc] = useState<RecipientChip[]>([]);
  const [bcc, setBcc] = useState<RecipientChip[]>([]);
  const [showCc, setShowCc] = useState(false);
  const [showBcc, setShowBcc] = useState(false);
  const [subject, setSubject] = useState("");
  const [accountId, setAccountId] = useState<string | undefined>(
    composeAccount(accounts, win.accountId, defaultAccountId)?.id,
  );
  const [status, setStatus] = useState<
    "idle" | "saving" | "saved" | "scheduled" | "error"
  >("idle");
  const [scheduledLabel, setScheduledLabel] = useState<string>();
  const [attachments, setAttachments] = useState<ComposeAttachment[]>([]);
  const [formatOpen, setFormatOpen] = useState(false);
  const [suggestQuery, setSuggestQuery] = useState("");
  const [initialized, setInitialized] = useState(false);
  const draftIdRef = useRef<Id<"drafts"> | undefined>(
    win.mode === "draft" ? (win.draftId as Id<"drafts">) : undefined,
  );
  const dirtyRef = useRef(false);
  const savingRef = useRef<Promise<Id<"drafts"> | undefined> | null>(null);
  const saveLatestRef = useRef<(() => Promise<Id<"drafts"> | undefined>) | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const htmlRef = useRef("");
  const textRef = useRef("");
  const forwardAttsRef = useRef<AttachmentInfo[]>([]);
  const fileInput = useRef<HTMLInputElement>(null);

  const suggestions =
    useQuery(
      api.mail.suggestRecipients,
      suggestQuery.trim().length > 0 ? { prefix: suggestQuery } : "skip",
    ) ?? [];

  // prefill once the data the mode needs has loaded. Runs as a render
  // adjustment (React's setState-during-render pattern) so it stays synchronous.
  const ready =
    win.mode === "draft"
      ? existingDraft !== undefined
      : win.replyToMessageId
        ? replyTo !== undefined
        : true;

  if (!initialized && ready) {
    setInitialized(true);
    if (win.mode === "draft" && existingDraft) {
      setTo(existingDraft.to.map(toChip));
      setCc(existingDraft.cc.map(toChip));
      setBcc(existingDraft.bcc.map(toChip));
      setShowCc(existingDraft.cc.length > 0);
      setShowBcc(existingDraft.bcc.length > 0);
      setSubject(existingDraft.subject);
      setAccountId(existingDraft.accountId);
      setAttachments(
        existingDraft.attachments.map((a) => ({
          filename: a.filename,
          contentType: a.contentType,
          size: a.size,
        })),
      );
      if (existingDraft.scheduledAt) {
        setStatus("scheduled");
        setScheduledLabel(
          `Scheduled for ${new Date(existingDraft.scheduledAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
        );
      }
    } else if (win.replyToMessageId && replyTo) {
      const orig = replyTo;
      setAccountId(orig.accountId);
      const recipients = replyRecipients(orig, win.mode === "replyAll", accounts.map(a => a.email));
      if (win.mode === "forward") {
        setSubject(forwardSubjectFor(orig));
      } else {
        setTo(recipients.to.map(toChip));
        setCc(recipients.cc.map(toChip));
        setShowCc(recipients.cc.length > 0);
        setSubject(replySubjectFor(orig));
      }
    }
  }

  // quoted-text preview for replies/forwards: the send action appends the
  // original server-side, so the composer only shows a collapsed preview.
  const [quoteText, setQuoteText] = useState<string | undefined>();
  const quoteFetchedRef = useRef(false);
  const quoteSourceId = (win.replyToMessageId ??
    (win.mode === "draft"
      ? (existingDraft?.replyToMessageId as string | undefined)
      : undefined)) as string | undefined;

  // forward mode: copy the original attachments into the draft once
  const forwardedRef = useRef(false);
  const forwardLoadRef = useRef<Promise<boolean> | null>(null);
  useEffect(() => {
    if (
      forwardedRef.current ||
      win.mode !== "forward" ||
      !win.replyToMessageId
    ) {
      return;
    }
    forwardedRef.current = true;
    forwardLoadRef.current = getContent({
      messageId: win.replyToMessageId as Id<"messages">,
    })
      .then((c) => {
        const content = c as {
          attachments?: AttachmentInfo[];
          text?: string;
          html?: string;
        };
        setQuoteText(
          content.text ?? stripHtml(content.html ?? "") ?? undefined,
        );
        const atts = content.attachments ?? [];
        forwardAttsRef.current = atts;
        setAttachments((prev) => [
          ...prev,
          ...atts.map((a) => ({
            filename: a.filename,
            contentType: a.contentType,
            size: a.size,
          })),
        ]);
        return true;
      })
      .catch(() => false);
  }, [win, getContent]);

  const wantsQuote =
    win.mode === "reply" ||
    win.mode === "replyAll" ||
    (win.mode === "draft" && quoteSourceId !== undefined);
  useEffect(() => {
    if (quoteFetchedRef.current || !wantsQuote || !quoteSourceId) return;
    quoteFetchedRef.current = true;
    const cached = getCached(quoteSourceId);
    void (cached && !cached.error ? Promise.resolve(cached) : getContent({ messageId: quoteSourceId as Id<"messages"> }))
      .then((c) => {
        const content = c as { text?: string; html?: string };
        setQuoteText(
          content.text ?? stripHtml(content.html ?? "") ?? undefined,
        );
      })
      .catch(() => {});
  }, [wantsQuote, quoteSourceId, getContent]);

  const save = useCallback(async (): Promise<Id<"drafts"> | undefined> => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    // Create the forward draft only after its original attachments are known.
    // Every save/send/attachment path shares this gate, so no early autosave
    // can permanently omit attachments that finish loading later.
    if (win.mode === "forward" && forwardLoadRef.current && !await forwardLoadRef.current) {
      toast.error("Could not load forwarded attachments. Reopen the forward to try again.");
      return undefined;
    }
    while (savingRef.current) await savingRef.current;
    const operation = async (): Promise<Id<"drafts"> | undefined> => {
    const acct = composeAccount(accounts, accountId, defaultAccountId)?.id as Id<"accounts"> | undefined;
    if (!acct) return undefined;
    setStatus((s) => (s === "scheduled" ? s : "saving"));
    try {
      if (!draftIdRef.current) {
        const id = await createDraft({
          accountId: acct,
          to: to.map(({ email, name }) => ({ email, name })),
          cc: cc.map(({ email, name }) => ({ email, name })),
          bcc: bcc.map(({ email, name }) => ({ email, name })),
          subject,
          html: htmlRef.current,
          text: textRef.current,
          mode:
            win.mode === "draft"
              ? "new"
              : (win.mode as "new" | "reply" | "replyAll" | "forward"),
          threadId: win.threadId as Id<"threads"> | undefined,
          replyToMessageId: win.replyToMessageId as
            | Id<"messages">
            | undefined,
          attachments:
            win.mode === "forward" && win.replyToMessageId
              ? forwardAttsRef.current.map((a) => ({
                  kind: "forward" as const,
                  messageId: win.replyToMessageId as Id<"messages">,
                  attachmentId: a.id,
                  filename: a.filename,
                  contentType: a.contentType,
                  size: a.size,
                }))
              : undefined,
        });
        draftIdRef.current = id;
        ui.setComposeDraft(win.id, id);
      } else {
        await updateDraft({
          draftId: draftIdRef.current,
          accountId: acct,
          to: to.map(({ email, name }) => ({ email, name })),
          cc: cc.map(({ email, name }) => ({ email, name })),
          bcc: bcc.map(({ email, name }) => ({ email, name })),
          subject,
          html: htmlRef.current,
          text: textRef.current,
        });
      }
      setStatus((s) => (s === "scheduled" ? s : "saved"));
      dirtyRef.current = false;
      return draftIdRef.current;
    } catch {
      setStatus("error");
      return undefined;
    }
    };
    const promise = operation();
    savingRef.current = promise;
    try { return await promise; }
    finally { savingRef.current = null; }
  }, [accountId, accounts, defaultAccountId, createDraft, updateDraft, to, cc, bcc, subject, win, ui]);

  useEffect(() => { saveLatestRef.current = save; }, [save]);
  useEffect(() => () => { if (saveTimer.current) clearTimeout(saveTimer.current); }, []);

  const queueSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => void saveLatestRef.current?.(), 800);
  }, []);

  const editor = useComposeEditor({
    initialHtml: "",
    placeholder: "Write your message",
    onUpdate: (html, text) => {
      htmlRef.current = html;
      textRef.current = text;
      queueSave();
    },
  });

  // load initial draft body into editor once ready
  useEffect(() => {
    if (!editor || !initialized) return;
    const html = existingDraft?.html ?? "";
    if (html && !editor.getText().trim()) {
      editor.commands.setContent(html, { emitUpdate: false });
      htmlRef.current = existingDraft?.html ?? "";
      textRef.current = existingDraft?.text ?? "";
    }
  }, [editor, initialized, existingDraft]);

  const onFieldChange = () => queueSave();

  const attachFiles = async (files: FileList | null) => {
    if (!files?.length) return;
    const id = await save();
    if (!id) {
      toast.error("Connect an account before attaching files");
      return;
    }
    let nextIndex = attachments.length;
    for (const file of Array.from(files)) {
      const idx = nextIndex++;
      setAttachments((prev) => [
        ...prev,
        {
          filename: file.name,
          contentType: file.type || "application/octet-stream",
          size: file.size,
          uploading: true,
          progress: 0,
        },
      ]);
      try {
        const url = await genUploadUrl({});
        const res = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": file.type || "application/octet-stream" },
          body: file,
        });
        if (!res.ok) throw new Error("upload failed");
        const { storageId } = (await res.json()) as {
          storageId: Id<"_storage">;
        };
        await addAttachment({
          draftId: id,
          attachment: {
            kind: "upload",
            storageId,
            filename: file.name,
            contentType: file.type || "application/octet-stream",
            size: file.size,
          },
        });
        setAttachments((prev) =>
          prev.map((a, i) => (i === idx ? { ...a, uploading: false } : a)),
        );
      } catch {
        setAttachments((prev) => prev.filter((_, i) => i !== idx));
        nextIndex--;
        toast.error(`Could not attach ${file.name}`);
      }
    }
  };

  const onSend = async () => {
    if (to.length === 0) {
      toast.error("Add a recipient first");
      return;
    }
    if (attachments.some(a => a.uploading)) {
      toast.error("Wait for attachments to finish uploading");
      return;
    }
    if (to.some((c) => c.invalid)) {
      toast.error("Fix invalid addresses");
      return;
    }
    const id = await save();
    if (!id) return;
    const delay = Math.max(undoSendSeconds, 0) * 1000;
    try {
      // Persist the send before closing. Reloading or closing this tab cannot
      // destroy the undo countdown or the eventual SMTP job.
      await scheduleSend({ draftId: id, at: Date.now() + delay });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue message");
      return;
    }
    ui.closeCompose(win.id);
    toast("Sending…", {
      duration: delay || 2000,
      action: delay > 0 ? {
        label: "Undo",
        onClick: async () => {
          try {
            await cancelSchedule({ draftId: id });
            ui.openCompose({ mode: "draft", draftId: id });
          } catch (error) {
            toast.error(error instanceof Error ? error.message : "The send can no longer be undone");
          }
        },
      } : undefined,
    });
  };

  const onSchedule = async (at: number) => {
    if (to.length === 0) {
      toast.error("Add a recipient first");
      return;
    }
    const id = await save();
    if (!id) return;
    try {
      await scheduleSend({ draftId: id, at });
      setStatus("scheduled");
      setScheduledLabel(
        `Scheduled for ${new Date(at).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}`,
      );
      toast("Send scheduled");
      ui.closeCompose(win.id);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not schedule");
    }
  };

  const onDiscard = async () => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    while (savingRef.current) await savingRef.current;
    ui.closeCompose(win.id);
    if (draftIdRef.current) {
      try {
        await discardDraft({ draftId: draftIdRef.current });
        toast("Draft discarded");
      } catch {
        toast.error("Could not discard the draft");
      }
    }
  };

  const onClose = () => {
    void save();
    ui.closeCompose(win.id);
  };

  const onInsertLink = () => {
    const url = window.prompt("Link URL");
    if (url && editor) {
      editor
        .chain()
        .focus()
        .extendMarkRange("link")
        .setLink({ href: url })
        .run();
    }
  };

  const acct = composeAccount(accounts, accountId, defaultAccountId);

  // Cmd+Enter to send
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      onClose();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      void onSend();
    }
  };

  const windowEl = (
    <div onKeyDown={onKeyDown} className="contents">
      <ComposeWindow
        expanded={win.expanded}
        mobile={isMobile}
        subject={subject}
        status={status}
        scheduledLabel={scheduledLabel}
        fromLabel={
          <Menu.Root>
            <Menu.Trigger className="flex items-center gap-1.5 min-w-0">
              <span className="text-primary text-[13px]/4 truncate">
                {acct ? `${acct.displayName || acct.email} <${acct.email}>` : "No account"}
              </span>
              <ChevronsUpDown className="text-tertiary shrink-0" />
            </Menu.Trigger>
            <Menu.Portal>
              <Menu.Positioner side="bottom" align="start" sideOffset={6} className="z-50">
                <Menu.Popup className="popover-popup w-64 rounded-[10px] bg-menu p-1 menu-shadow ring-1 ring-menu-ring">
                  {accounts.map((a) => (
                    <Menu.Item
                      key={a.id}
                      onClick={() => {
                        setAccountId(a.id);
                        queueSave();
                      }}
                      className="flex items-center rounded-md px-2 h-8 cursor-default text-primary text-[13px]/4 data-[highlighted]:bg-hover outline-none"
                    >
                      <span className="truncate">
                        {a.displayName ? `${a.displayName} ` : ""}
                        <span className="text-tertiary">{a.email}</span>
                      </span>
                    </Menu.Item>
                  ))}
                </Menu.Popup>
              </Menu.Positioner>
            </Menu.Portal>
          </Menu.Root>
        }
        to={to}
        cc={cc}
        bcc={bcc}
        showCc={showCc}
        showBcc={showBcc}
        onShowCc={() => setShowCc(true)}
        onShowBcc={() => setShowBcc(true)}
        toInput={
          <AddressField
            hasChips={to.length > 0}
            onAdd={(chips) => {
              setTo((p) => [...p, ...chips]);
              onFieldChange();
            }}
            onBackspace={() => {
              setTo((p) => p.slice(0, -1));
              onFieldChange();
            }}
            suggestions={suggestions}
            onSelectSuggestion={(s) => {
              setTo((p) => [...p, s]);
              onFieldChange();
            }}
            onQuery={setSuggestQuery}
            placeholder="To"
          />
        }
        ccInput={
          <AddressField
            hasChips={cc.length > 0}
            onAdd={(chips) => {
              setCc((p) => [...p, ...chips]);
              onFieldChange();
            }}
            onBackspace={() => {
              setCc((p) => p.slice(0, -1));
              onFieldChange();
            }}
            suggestions={suggestions}
            onSelectSuggestion={(s) => {
              setCc((p) => [...p, s]);
              onFieldChange();
            }}
            onQuery={setSuggestQuery}
          />
        }
        bccInput={
          <AddressField
            hasChips={bcc.length > 0}
            onAdd={(chips) => {
              setBcc((p) => [...p, ...chips]);
              onFieldChange();
            }}
            onBackspace={() => {
              setBcc((p) => p.slice(0, -1));
              onFieldChange();
            }}
            suggestions={suggestions}
            onSelectSuggestion={(s) => {
              setBcc((p) => [...p, s]);
              onFieldChange();
            }}
            onQuery={setSuggestQuery}
          />
        }
        subjectInput={
          <input
            value={subject}
            onChange={(e) => {
              setSubject(e.target.value);
              onFieldChange();
            }}
            placeholder="Subject"
            className="w-full bg-transparent font-semibold text-primary text-[13px]/4 outline-none placeholder:text-quaternary placeholder:font-normal"
          />
        }
        editor={<ComposeEditorArea editor={editor} />}
        quoted={quoteText ? <QuotedPreview text={quoteText} /> : undefined}
        attachments={attachments}
        onRemoveAttachment={async (i) => {
          setAttachments((prev) => prev.filter((_, j) => j !== i));
          if (draftIdRef.current) {
            await removeAttachment({
              draftId: draftIdRef.current,
              index: i,
            }).catch(() => {});
          }
        }}
        formatBar={formatOpen ? <FormatBar editor={editor} /> : undefined}
        onMinimize={() => ui.minimizeCompose(win.id)}
        onExpand={() => ui.toggleExpandCompose(win.id)}
        onClose={onClose}
        onSend={() => void onSend()}
        onAttach={() => fileInput.current?.click()}
        onInsertLink={onInsertLink}
        onSchedule={status === "scheduled" ? (
          <button className="pressable text-accent text-xs px-2" onClick={async () => {
            if (!draftIdRef.current) return;
            try {
              await cancelSchedule({ draftId: draftIdRef.current });
              setStatus("saved");
              setScheduledLabel(undefined);
              toast("Scheduled send cancelled");
            } catch { toast.error("Could not cancel scheduled send"); }
          }}>Cancel schedule</button>
        ) : <SchedulePopover onSchedule={(at) => void onSchedule(at)} />}
        onToggleFormat={() => setFormatOpen((v) => !v)}
        formatOpen={formatOpen}
        onDiscard={() => void onDiscard()}
        sendDisabled={accounts.length === 0}
      />
      <input
        ref={fileInput}
        type="file"
        multiple
        hidden
        onChange={(e) => {
          void attachFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );

  if (win.minimized) {
    return (
      <div
        className="flex items-center w-70 h-9 rounded-t-lg bg-menu ring-1 ring-menu-ring menu-shadow"
      >
        <button
          onClick={() => ui.restoreCompose(win.id)}
          className="pressable flex items-center grow h-full px-3 min-w-0 text-left"
        >
          <span className="grow font-semibold text-primary text-[13px]/4 truncate">
            {subject || "New message"}
          </span>
        </button>
        <button
          aria-label="Close draft"
          onClick={(e) => {
            e.stopPropagation();
            onClose();
          }}
          className="icon-btn size-5 mr-2.5 text-tertiary"
        >
          ×
        </button>
      </div>
    );
  }

  return windowEl;
}

export function ComposeLayer({
  accounts,
}: {
  categories: unknown;
  accounts: AccountInfo[];
}) {
  const compose = useUI((s) => s.compose);
  const settings = useQuery(api.settings.get, {});
  const undoSendSeconds = settings?.undoSendSeconds ?? 5;
  const isMobile = useMediaQuery("(max-width: 767px)");
  const visible = compose.filter((w) => !w.minimized);
  const activeMobile = visible.at(-1) ?? compose.at(-1);
  const defaultAccountId = settings && "defaultAccountId" in settings ? settings.defaultAccountId : undefined;
  // Draft lifetime belongs to the store, not an animation completion callback.
  // Wait for sender preferences before mounting a new composer.
  if (compose.length === 0 || settings === undefined) return null;
  return (
    <div className={isMobile
      ? "fixed inset-0 z-40 pointer-events-none"
      : "fixed bottom-6 right-6 z-40 flex items-end gap-3 pointer-events-none"}>
      {compose.map((w) => (
        // Keep every pane at the same keyed tree position across breakpoints.
        // CSS hides background mobile panes without losing unsaved editor state.
        <div key={w.id} className={isMobile
          ? w.id === activeMobile?.id
            ? "compose-surface pointer-events-auto h-full bg-app"
            : "hidden"
          : "compose-surface pointer-events-auto"}>
          <ComposePane
            defaultAccountId={defaultAccountId}
            win={w}
            accounts={accounts}
            undoSendSeconds={undoSendSeconds}
          />
        </div>
      ))}
    </div>
  );
}
