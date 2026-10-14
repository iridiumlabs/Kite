"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useMediaQuery } from "@/lib/ui/useMediaQuery";
import { Sidebar } from "@/components/mail/Sidebar";
import { ListHeader as MailListHeader } from "@/components/mail/ListHeader";
import { ThreadList } from "@/components/mail/ThreadList";
import { Reader } from "@/components/mail/Reader";
import {
  ComposeWindow,
  type RecipientChip,
} from "@/components/compose/ComposeWindow";
import {
  useComposeEditor,
  ComposeEditorArea,
} from "@/components/compose/Editor";
import { Tag, Clock, MoreDots, ChevronsUpDown } from "@/components/icons";
import {
  FIXTURE_ACCOUNTS,
  FIXTURE_CATEGORIES,
  FIXTURE_CONTENT,
  FIXTURE_MESSAGES,
  FIXTURE_THREADS,
  FIXTURE_USER,
} from "@/lib/ui/fixtures";

const noop = () => {};

function ListHeader(props: React.ComponentProps<typeof MailListHeader>) {
  const mobile = useMediaQuery("(max-width: 767px)");
  return <MailListHeader {...props} wide={props.wide && !mobile} />;
}

function useDarkParam() {
  const params = useSearchParams();
  const dark = params.get("theme") === "dark";
  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
    return () => document.documentElement.classList.remove("dark");
  }, [dark]);
  return dark;
}

function PreviewSidebar({ profileOpen }: { profileOpen?: boolean }) {
  return (
    <Sidebar
      user={FIXTURE_USER}
      profile={{
        theme: "light",
        onOpenSettings: noop,
        onSetTheme: noop,
        onSignOut: noop,
        defaultOpen: profileOpen,
      }}
      view="primary"
      counts={{ primaryUnread: 12, otherUnread: 3, drafts: 2 }}
      categories={FIXTURE_CATEGORIES}
      accounts={FIXTURE_ACCOUNTS}
      collapsed={{ categories: false, accounts: false }}
      onNavigate={noop}
      onCompose={noop}
      onToggleSection={noop}
      onAddCategory={noop}
      onEditCategory={noop}
      onAddAccount={noop}
      onReconnectAccount={noop}
    />
  );
}

const rowActions = {
  onArchive: noop,
  onTrash: noop,
  onSnooze: noop,
  onToggleRead: noop,
};

function ToolbarIcon({ children }: { children: React.ReactNode }) {
  return (
    <span className="icon-btn w-8 h-7 inline-flex">{children}</span>
  );
}

function PreviewReader({ dark }: { dark: boolean }) {
  const [expanded] = useState(() => new Set(["m-3"]));
  return (
    <Reader
      onClose={noop}
      subject="Re: Kite beta onboarding feedback"
      messageCount={3}
      accountEmail="arham@gmail.com"
      messages={FIXTURE_MESSAGES}
      contentFor={(id) => FIXTURE_CONTENT[id]}
      expandedIds={expanded}
      onToggleMessage={noop}
      onArchive={noop}
      onTrash={noop}
      onTag={
        <ToolbarIcon>
          <Tag />
        </ToolbarIcon>
      }
      onSnooze={
        <ToolbarIcon>
          <Clock />
        </ToolbarIcon>
      }
      onMarkUnread={noop}
      onStar={noop}
      onMore={
        <ToolbarIcon>
          <MoreDots />
        </ToolbarIcon>
      }
      onPrevThread={noop}
      onNextThread={noop}
      hasPrev
      hasNext
      onReply={noop}
      onReplyAll={noop}
      onForward={noop}
      onDownloadAttachment={noop}
      dark={dark}
      recipientSummary={() => "to me, Jonas Weber"}
    />
  );
}

const COMPOSE_BODY = `<p>Hi Lena,</p>
<p>Maya sent over great notes on the new import flow this morning. Before our walkthrough on Thursday, could you take a pass at these three items?</p>
<ol>
<li>Replace the jumpy progress bar with a live count, like "12,400 of 18,000".</li>
<li>Map existing Gmail labels to Categories during import.</li>
<li>Return focus to the message list when Esc closes search.</li>
</ol>
<p>I've attached her notes so you have the full context. Happy to pair on the label mapping if it gets hairy.</p>
<p>Thanks, Arham</p>`;

function PreviewCompose({ mobile = false }: { mobile?: boolean }) {
  const editor = useComposeEditor({ initialHtml: COMPOSE_BODY });
  const to: RecipientChip[] = [
    { name: "Lena Fischer", email: "lena@fischer.design" },
  ];
  const cc: RecipientChip[] = [
    { name: "Maya Okafor", email: "maya@okafor.studio" },
  ];
  return (
    <ComposeWindow
      mobile={mobile}
      subject="Thursday walkthrough: import flow fixes"
      status="saved"
      fromLabel={
        <>
          <div className="text-primary text-[13px]/4">Arham</div>
          <div className="text-tertiary text-[13px]/4">arham@gmail.com</div>
          <ChevronsUpDown className="text-tertiary shrink-0" />
        </>
      }
      to={to}
      cc={cc}
      bcc={[]}
      showCc
      showBcc={false}
      toInput={<span className="grow" />}
      ccInput={<span className="grow" />}
      subjectInput={
        <input
          className="w-full bg-transparent outline-none tracking-[-0.005em] font-semibold text-primary text-sm/4.5"
          defaultValue="Thursday walkthrough: import flow fixes"
        />
      }
      editor={<ComposeEditorArea editor={editor} />}
      attachments={[
        {
          filename: "import-flow-notes.pdf",
          contentType: "application/pdf",
          size: 253952,
        },
      ]}
      onRemoveAttachment={noop}
      onMinimize={noop}
      onExpand={noop}
      onClose={noop}
      onSend={noop}
      onAttach={noop}
      onInsertLink={noop}
      onSchedule={
        <span className="icon-btn w-7.5 h-7.5 inline-flex">
          <Clock size={16} />
        </span>
      }
      onToggleFormat={noop}
      onDiscard={noop}
    />
  );
}

export function PreviewApp() {
  const params = useSearchParams();
  const dark = useDarkParam();
  const frame = params.get("frame") ?? "inbox-selected";
  const isMobile = useMediaQuery("(max-width: 767px)");

  const sidebar = <div className="max-[1099px]:hidden shrink-0"><PreviewSidebar profileOpen={frame === "profile"} /></div>;

  if (frame === "empty") {
    return (
      <div className="flex h-dvh w-full overflow-clip bg-app antialiased">
        {sidebar}
        <div className="flex flex-col grow basis-0 min-w-0">
          <ListHeader
            title="Primary"
            wide
            filter="all"
            onFilterChange={noop}
            onOpenSearch={noop}
          />
          <div className="flex flex-col items-center justify-center grow gap-3">
            <div className="font-semibold text-primary text-[15px]/4.5">
              You&rsquo;re all caught up
            </div>
            <div className="text-tertiary text-[13px]/4">
              New mail will show up here after your next sync.
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (frame === "loading") {
    return (
      <div className="flex h-dvh w-full overflow-clip bg-app antialiased">
        {sidebar}
        <div className="flex flex-col grow basis-0 min-w-0">
          <ListHeader
            title="Primary"
            wide
            filter="all"
            onFilterChange={noop}
            onOpenSearch={noop}
          />
          <div className="flex flex-col pb-6 px-4">
            <div className="pl-8 py-1.5">
              <div className="skeleton h-4 w-14" />
            </div>
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="flex items-center h-11 pr-3.5 pl-2.5 gap-3 shrink-0"
              >
                <div className="w-2.5 shrink-0" />
                <div className="skeleton h-3.5 w-45 shrink-0" />
                <div className="skeleton h-3.5 grow" />
                <div className="skeleton h-3.5 w-16 shrink-0" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (frame === "inbox-no-selection" || frame === "compose") {
    return (
      <div className="relative flex h-dvh w-full overflow-clip bg-app antialiased">
        {sidebar}
        <div className="flex flex-col grow basis-0 h-full min-w-0">
          <ListHeader
            title="Primary"
            unread={12}
            wide
            filter="all"
            onFilterChange={noop}
            onOpenSearch={noop}
          />
          <div className="flex-1 overflow-y-auto">
            <ThreadList
              threads={FIXTURE_THREADS}
              layout={isMobile ? "compact" : "wide"}
              onOpen={noop}
              actions={rowActions}
            />
          </div>
        </div>
        {frame === "compose" && (
          <div className={isMobile ? "absolute inset-0" : "absolute right-6 bottom-6"}>
            <PreviewCompose mobile={isMobile} />
          </div>
        )}
      </div>
    );
  }

  // inbox-selected + profile
  return (
    <div className="flex h-dvh w-full overflow-clip bg-app antialiased">
      {sidebar}
      <div className="flex flex-col w-95 h-full shrink-0 bg-app border-r border-sidebar-border max-[767px]:hidden">
        <ListHeader
          title="Primary"
          unread={12}
          filter="all"
          onFilterChange={noop}
          onOpenSearch={noop}
        />
        <div className="flex shrink-0 pb-2.5 px-3">
          <button className="flex items-center grow basis-0 h-7.5 pr-2 pl-2.25 rounded-lg gap-1.75 bg-search-field text-left">
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              className="text-tertiary"
            >
              <circle
                cx="11"
                cy="11"
                r="7.5"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
              <path
                d="m20.5 20.5-4.2-4.2"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.1"
                strokeLinecap="round"
              />
            </svg>
            <div className="grow basis-0 text-tertiary text-[13px]/4">
              Search
            </div>
            <div className="kbd">⌘K</div>
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          <ThreadList
            threads={FIXTURE_THREADS}
            layout="compact"
            selectedId="t-maya"
            onOpen={noop}
          />
        </div>
      </div>
      <PreviewReader dark={dark} />
    </div>
  );
}
