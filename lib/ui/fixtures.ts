import type {
  AccountInfo,
  CategoryInfo,
  MessageItem,
  ThreadItem,
  UserInfo,
  MessageContent,
} from "./types";

function at(daysAgo: number, h: number, m = 0): number {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h, m, 0, 0);
  return d.getTime();
}

/** Most recent occurrence of weekday `target` (0=Sun) before today */
function lastWeekday(target: number, h: number, m = 0): number {
  const d = new Date();
  const diff = (d.getDay() - target + 7) % 7 || 7;
  return at(diff, h, m);
}

export const FIXTURE_CATEGORIES: CategoryInfo[] = [
  { id: "cat-murmurs", name: "Murmurs", color: "#AF52DE", unread: 4 },
  { id: "cat-support", name: "Support", color: "#34C759", unread: 1 },
  { id: "cat-outreach", name: "Outreach", color: "#FF9F0A" },
];

const murmurs = FIXTURE_CATEGORIES[0];
const support = FIXTURE_CATEGORIES[1];
const outreach = FIXTURE_CATEGORIES[2];

export const FIXTURE_ACCOUNTS: AccountInfo[] = [
  { id: "acc-1", email: "arham@gmail.com", status: "active", unread: 9 },
  { id: "acc-2", email: "arham@kitemail.app", status: "active", unread: 3 },
];

export const FIXTURE_USER: UserInfo = {
  name: "Arham",
  initial: "A",
  accountsConnected: 2,
};

export const FIXTURE_THREADS: ThreadItem[] = [
  {
    id: "t-maya",
    subject: "Re: Kite beta onboarding feedback",
    participants: [{ name: "Maya Okafor", email: "maya@okafor.studio" }],
    snippet:
      "Went through the new import flow twice this morning. The OAuth step is so much smoother than the last build.",
    lastMessageAt: at(0, 10, 42),
    messageCount: 3,
    unread: false,
    hasAttachments: true,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-stripe",
    subject: "Your payout of $4,280.00 is on the way",
    participants: [{ name: "Stripe", email: "notifications@stripe.com" }],
    snippet:
      "Expected to arrive in your account ending 4421 on Tuesday, October 13.",
    lastMessageAt: at(0, 9, 15),
    messageCount: 1,
    unread: true,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-jonas",
    subject: "Dinner Thursday?",
    participants: [{ name: "Jonas Weber", email: "jonas@weber.io" }],
    snippet:
      "We found a tiny Georgian place in Kreuzberg. Khachapuri the size of a steering wheel, apparently.",
    lastMessageAt: at(0, 8, 3),
    messageCount: 1,
    unread: true,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-priya",
    subject: "Contract draft v2",
    participants: [{ name: "Priya Raman", email: "priya@raman.co" }],
    snippet:
      "Attached the revised SOW with the milestones we discussed. Section 4 now covers the handoff.",
    lastMessageAt: at(0, 7, 48),
    messageCount: 2,
    unread: true,
    hasAttachments: true,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-nadia",
    subject: "Can't connect my Outlook account",
    participants: [{ name: "Nadia Flores", email: "nadia@flores.dev" }],
    snippet:
      'Getting an "invalid grant" error right after the Microsoft sign-in screen. Screenshots attached.',
    lastMessageAt: at(0, 7, 12),
    messageCount: 1,
    unread: true,
    categories: [support],
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-github",
    subject: "[kite/app] Fix thread grouping for forwarded messages (#214)",
    participants: [{ name: "GitHub", email: "notifications@github.com" }],
    snippet:
      "@lena-dev approved these changes. Looks great, merging once CI is green.",
    lastMessageAt: at(1, 18, 40),
    messageCount: 1,
    unread: false,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-elena",
    subject: "Murmurs #12: notes from the listening session",
    participants: [{ name: "Elena Marsh", email: "elena@murmu.rs" }],
    snippet:
      "Transcribed the voice memos. A few quotes are worth pulling for the opening essay.",
    lastMessageAt: at(1, 16, 18),
    messageCount: 1,
    unread: false,
    categories: [murmurs],
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-theo",
    subject: "Re: Intro, Kite × Halcyon",
    participants: [{ name: "Theo Laurent", email: "theo@halcyon.app" }],
    snippet:
      "Thanks for the intro, Arham! I'd love to hear how you're thinking about shared inboxes.",
    lastMessageAt: at(1, 14, 5),
    messageCount: 1,
    unread: true,
    categories: [outreach],
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-lena",
    subject: "Design review notes",
    participants: [{ name: "Lena Fischer", email: "lena@fischer.design" }],
    snippet:
      "Left a few comments on the reader spacing. The collapsed message rows feel just right now.",
    lastMessageAt: at(1, 11, 30),
    messageCount: 1,
    unread: false,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-vercel",
    subject: "Deployment ready: kite-web",
    participants: [{ name: "Vercel", email: "notifications@vercel.com" }],
    snippet:
      "Production deployment for main (a3f9c21) completed in 41 seconds.",
    lastMessageAt: lastWeekday(5, 17, 22),
    messageCount: 1,
    unread: false,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-sam",
    subject: "Quick question about the API",
    participants: [{ name: "Sam Chen", email: "sam@chenmail.com" }],
    snippet:
      "Is there a way to fetch threads by category through the MCP server, or only by label?",
    lastMessageAt: lastWeekday(4, 15, 47),
    messageCount: 1,
    unread: false,
    categories: [support],
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-apple",
    subject: "Your receipt from Apple",
    participants: [{ name: "Apple", email: "no_reply@email.apple.com" }],
    snippet: "Apple Developer Program · Annual membership · $99.00",
    lastMessageAt: lastWeekday(4, 9, 2),
    messageCount: 1,
    unread: false,
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-marco",
    subject: "Podcast invite: Tools for Thought",
    participants: [{ name: "Marco Bianchi", email: "marco@tft.fm" }],
    snippet:
      "We're recording season three in November and would love to have you on to talk about Kite.",
    lastMessageAt: lastWeekday(3, 20, 15),
    messageCount: 1,
    unread: false,
    categories: [outreach],
    accountEmail: "arham@gmail.com",
  },
  {
    id: "t-hannah",
    subject: "Photos from Sunday",
    participants: [{ name: "Hannah Lee", email: "hannah@lee.photos" }],
    snippet:
      "Finally got around to exporting them. The one of the lake at golden hour is my favorite.",
    lastMessageAt: lastWeekday(2, 19, 30),
    messageCount: 1,
    unread: false,
    hasAttachments: true,
    accountEmail: "arham@gmail.com",
  },
];

export const FIXTURE_MESSAGES: MessageItem[] = [
  {
    id: "m-1",
    threadId: "t-maya",
    from: { name: "Arham", email: "arham@gmail.com" },
    to: [{ name: "Maya Okafor", email: "maya@okafor.studio" }],
    subject: "Re: Kite beta onboarding feedback",
    date: at(3, 9, 12),
    snippet:
      "Hey Maya, the new beta build is up on TestFlight. Would love your eyes on the import flow before we ship.",
    unread: false,
    own: true,
  },
  {
    id: "m-2",
    threadId: "t-maya",
    from: { name: "Maya Okafor", email: "maya@okafor.studio" },
    to: [{ name: "Arham", email: "arham@gmail.com" }],
    subject: "Re: Kite beta onboarding feedback",
    date: at(2, 21, 5),
    snippet:
      "Downloading now! I'll run it against both of my accounts first thing tomorrow and report back.",
    unread: false,
  },
  {
    id: "m-3",
    threadId: "t-maya",
    from: { name: "Maya Okafor", email: "maya@okafor.studio" },
    to: [
      { name: "Arham", email: "arham@gmail.com" },
      { name: "Jonas Weber", email: "jonas@weber.io" },
    ],
    subject: "Re: Kite beta onboarding feedback",
    date: at(0, 10, 42),
    snippet:
      "Went through the new import flow twice this morning. The OAuth step is so much smoother",
    unread: false,
  },
];

const MAYA_BODY = `Hi Arham,

Went through the new import flow twice this morning, once with my personal Gmail and once with the studio account. The OAuth step is so much smoother than the last build; I didn't have to think at all.

A few small things I noticed:

1. The progress bar jumps from 40% straight to done on large inboxes. A count like "12,400 of 18,000" would feel more honest.
2. Categories didn't pick up my existing Gmail labels. Is that planned?
3. ⌘K opened search, but Esc didn't return focus to the message list.

Otherwise it already feels like the calmest mail app I've used. Happy to hop on a call Thursday if it's easier to walk through. Notes attached.

Maya`;

export const FIXTURE_CONTENT: Record<string, MessageContent> = {
  "m-3": {
    text: MAYA_BODY,
    html: MAYA_BODY.split("\n\n").map((paragraph, i, paragraphs) => {
      const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      if (paragraph.startsWith("1. ")) {
        return `<ol>${paragraph.split("\n").map(line => `<li>${escape(line.replace(/^\d+\. /, ""))}</li>`).join("")}</ol>`;
      }
      return `<p${paragraphs[i + 1]?.startsWith("1. ") ? ' style="margin-bottom:6px"' : ""}>${escape(paragraph)}</p>`;
    }).join(""),
    attachments: [
      {
        id: "att-1",
        filename: "import-flow-notes.pdf",
        contentType: "application/pdf",
        size: 253952,
      },
    ],
  },
};
