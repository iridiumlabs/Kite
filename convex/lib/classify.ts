import type { Address, InboxBucket } from "./types";

export const JEV_CATEGORY_THRESHOLD = 0.6;
export const JEV_MAX_QUESTIONS = 32;
const BODY_EXCERPT_MAX = 2000;
const MAX_THREAD_CONTEXT_MESSAGES = 5;

export interface JevCategoryInput {
  id: string;
  name: string;
  description: string;
}

export interface JevMessageInput {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  date: number;
  snippet: string;
  bodyExcerpt?: string;
  bulk: boolean;
  isReply: boolean;
  folderRole: string;
}

export interface JevThreadContext {
  ownerParticipated: boolean;
  isDirectReplyToOwner: boolean;
  previousSenders: string[];
  messageCount: number;
}

export interface JevRequestInput {
  owner: { emails: string[] };
  message: JevMessageInput;
  thread?: JevThreadContext;
  categories: JevCategoryInput[];
  model?: string;
}

export interface JevQuestion {
  id: string;
  type: "choice" | "noul";
  prompt: string;
  choices?: { value: string; criteria: string }[];
  criteria?: string;
}

export interface JevRequestBody {
  model?: string;
  state: Record<string, unknown>;
  questions: JevQuestion[];
}

const INBOX_CRITERIA = {
  primary:
    "Personal mail that needs the owner's attention: genuine human replies in " +
    "threads the owner started or participated in, direct one-to-one messages, " +
    "and anything requiring a response or action.",
  other:
    "Everything else: automated replies and notifications, receipts and " +
    "confirmations that need no action, newsletters, promotions, marketing, " +
    "cold outreach, bulk mail, and spam-like messages.",
};

function buildState(input: JevRequestInput): Record<string, unknown> {
  const { message, thread, owner } = input;
  const excerpt = (message.bodyExcerpt ?? message.snippet).slice(
    0,
    BODY_EXCERPT_MAX,
  );
  return {
    owner_emails: owner.emails,
    from: message.from,
    to: message.to,
    cc: message.cc,
    subject: message.subject,
    date: new Date(message.date).toISOString(),
    is_reply: message.isReply,
    is_bulk: message.bulk,
    folder: message.folderRole,
    body_excerpt: excerpt,
    thread: thread
      ? {
          owner_participated: thread.ownerParticipated,
          direct_reply_to_owner: thread.isDirectReplyToOwner,
          message_count: thread.messageCount,
          previous_senders: thread.previousSenders.slice(
            0,
            MAX_THREAD_CONTEXT_MESSAGES,
          ),
        }
      : undefined,
  };
}

function inboxQuestion(): JevQuestion {
  return {
    id: "inbox",
    type: "choice",
    prompt: "Which inbox should this email be filed under?",
    choices: [
      { value: "primary", criteria: INBOX_CRITERIA.primary },
      { value: "other", criteria: INBOX_CRITERIA.other },
    ],
  };
}

function categoryQuestion(index: number, cat: JevCategoryInput): JevQuestion {
  return {
    id: `c${index}`,
    type: "noul",
    prompt: `Does this email belong to the category "${cat.name}"?`,
    criteria: cat.description,
  };
}

// One request carries the `inbox` choice plus up to 31 category questions;
// additional requests carry categories in chunks of 32. Category question ids
// are `c<globalIndex>` so responses can be mapped back across requests.
export function buildJevRequests(input: JevRequestInput): JevRequestBody[] {
  const state = buildState(input);
  const cats = input.categories;
  const requests: JevRequestBody[] = [];

  const firstCats = cats.slice(0, JEV_MAX_QUESTIONS - 1);
  requests.push({
    model: input.model,
    state,
    questions: [
      inboxQuestion(),
      ...firstCats.map((c, i) => categoryQuestion(i, c)),
    ],
  });

  for (let i = firstCats.length; i < cats.length; i += JEV_MAX_QUESTIONS) {
    const chunk = cats.slice(i, i + JEV_MAX_QUESTIONS);
    requests.push({
      model: input.model,
      state,
      questions: chunk.map((c, j) => categoryQuestion(i + j, c)),
    });
  }

  return requests;
}

export interface JevAnswerChoice {
  type: "choice";
  choice?: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}

export interface JevAnswerNoul {
  type: "noul";
  noul?: number;
}

export interface JevResponseBody {
  answers?: Record<string, JevAnswerChoice | JevAnswerNoul | undefined>;
}

export interface ParsedJevClassification {
  inbox: InboxBucket | null;
  inboxConfidence?: number;
  categoryIds: string[];
}

export function parseJevResponses(
  responses: JevResponseBody[],
  categories: JevCategoryInput[],
): ParsedJevClassification {
  const answers: Record<string, JevAnswerChoice | JevAnswerNoul | undefined> =
    {};
  for (const res of responses) {
    Object.assign(answers, res.answers ?? {});
  }

  let inbox: InboxBucket | null = null;
  let inboxConfidence: number | undefined;
  const inboxAnswer = answers["inbox"];
  if (inboxAnswer && inboxAnswer.type === "choice") {
    const choice = inboxAnswer.choice;
    if (choice === "primary" || choice === "other") inbox = choice;
    inboxConfidence = inboxAnswer.confidence;
  }

  const categoryIds: string[] = [];
  for (let i = 0; i < categories.length; i++) {
    const answer = answers[`c${i}`];
    if (
      answer &&
      answer.type === "noul" &&
      typeof answer.noul === "number" &&
      answer.noul >= JEV_CATEGORY_THRESHOLD
    ) {
      categoryIds.push(categories[i].id);
    }
  }

  return { inbox, inboxConfidence, categoryIds };
}

export interface HeuristicInput {
  folderRole: string;
  from: Address;
  bulk: boolean;
  headers?: {
    listUnsubscribe?: boolean;
    listId?: boolean;
    precedence?: string;
    autoSubmitted?: string;
    esp?: boolean;
  };
  isReplyToOwnerThread: boolean;
}

const NOREPLY_RE =
  /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|notifications?|notify|mailer[-_.]?daemon|bounce[ds]?|newsletter|news|updates?|marketing|promo|promotions|info|hello|support|bot|auto)@/i;

export function heuristicClassify(input: HeuristicInput): InboxBucket {
  if (input.folderRole === "junk") return "other";
  const h = input.headers;
  if (
    input.bulk ||
    h?.listUnsubscribe ||
    h?.listId ||
    h?.esp ||
    (h?.precedence !== undefined &&
      /^(bulk|list|junk)$/i.test(h.precedence)) ||
    (h?.autoSubmitted !== undefined &&
      h.autoSubmitted.toLowerCase() !== "no")
  ) {
    return "other";
  }
  if (NOREPLY_RE.test(input.from.email)) return "other";
  if (input.isReplyToOwnerThread) return "primary";
  return "primary";
}
