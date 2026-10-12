import type { Address, InboxBucket } from "./types";

export const JEV_CATEGORY_THRESHOLD = 0.6;
export const JEV_MAX_QUESTIONS = 32;
const FIXED_QUESTION_COUNT = 6;
const BODY_EXCERPT_MAX = 2000;
const MAX_ATTACHMENTS = 10;
const MAX_PREVIOUS_MESSAGES = 3;

export interface JevCategoryInput {
  id: string;
  name: string;
  description: string;
}

export interface JevOwnerInput {
  name?: string;
  addresses: string[];
}

export interface JevEmailInput {
  from: Address;
  to: Address[];
  cc: Address[];
  subject: string;
  date: number;
  folder: string;
  bodyExcerpt: string;
  attachments?: string[];
  headers?: {
    listUnsubscribe: boolean;
    listId?: string;
    precedence?: string;
    autoSubmitted?: string;
  };
}

export interface JevThreadContext {
  ownerStarted: boolean;
  ownerParticipated: boolean;
  directReplyToOwner: boolean;
  messageCount: number;
  previousMessages: { from: string; snippet: string }[];
}

export interface JevRequestInput {
  owner: JevOwnerInput;
  email: JevEmailInput;
  thread?: JevThreadContext;
  categories: JevCategoryInput[];
  model?: string;
}

// The API takes `questions` as an object keyed by question id. Choice
// questions carry a criteria map (option -> description); noul questions
// carry no criteria.
export type JevQuestion =
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "noul"; instructions: string };

export interface JevRequestBody {
  model?: string;
  state: Record<string, unknown>;
  questions: Record<string, JevQuestion>;
}

const INBOX_QUESTION_INSTRUCTIONS =
  "Which inbox should `email` be filed in for the mailbox owner described " +
  "in `owner`? Use the sender, headers, body, and `thread` context.";

const INBOX_CRITERIA: Record<string, string> = {
  primary:
    "Relevant to the owner personally: a real person writing to the owner " +
    "directly, a genuine human reply in a conversation the owner started " +
    "or took part in, personal correspondence, work or business " +
    "conversations with people the owner knows or has engaged with, and " +
    "messages that need the owner's attention, decision, reply, or " +
    "action (for example security alerts, account problems, or " +
    "time-sensitive requests).",
  other:
    "Not important to read promptly: newsletters, digests, promotions, " +
    "marketing, product updates, social and app notifications, automated " +
    "receipts and confirmations that need no action, automatic replies " +
    "such as out-of-office and delivery notices (even inside the owner's " +
    "threads), unsolicited cold outreach or sales pitches from strangers, " +
    "mass mail, and spam-like messages.",
};

const FIXED_NOUL_QUESTIONS: Record<string, string> = {
  automated:
    "Was `email` generated automatically by a system (a notification, " +
    "receipt, alert, or auto-reply) rather than written personally by a " +
    "person?",
  bulk:
    "Is `email` a newsletter, promotion, marketing message, or other " +
    "mass mailing sent to many recipients?",
  cold_outreach:
    "Is `email` unsolicited outreach from someone with no prior " +
    "conversation with the owner, such as a sales pitch, recruiting " +
    "message, or partnership request?",
  needs_attention:
    "Does `email` ask the owner to reply, decide, or take action, or " +
    "contain information the owner personally needs to know soon, such " +
    "as a security alert or an account problem?",
  genuine_reply:
    "Is `email` a reply written by a real person in a conversation that " +
    "the owner started or took part in, according to `thread`?",
};

function buildState(input: JevRequestInput): Record<string, unknown> {
  const { email, thread, owner } = input;
  const headers = email.headers;
  return {
    owner: {
      ...(owner.name !== undefined ? { name: owner.name } : {}),
      addresses: owner.addresses,
    },
    email: {
      from: email.from,
      to: email.to,
      cc: email.cc,
      subject: email.subject,
      date: new Date(email.date).toISOString(),
      folder: email.folder,
      body_excerpt: email.bodyExcerpt.slice(0, BODY_EXCERPT_MAX),
      attachments: (email.attachments ?? []).slice(0, MAX_ATTACHMENTS),
      headers: headers
        ? {
            list_unsubscribe: headers.listUnsubscribe,
            ...(headers.listId !== undefined
              ? { list_id: headers.listId }
              : {}),
            ...(headers.precedence !== undefined
              ? { precedence: headers.precedence }
              : {}),
            ...(headers.autoSubmitted !== undefined
              ? { auto_submitted: headers.autoSubmitted }
              : {}),
          }
        : { list_unsubscribe: false },
    },
    ...(thread
      ? {
          thread: {
            owner_started: thread.ownerStarted,
            owner_participated: thread.ownerParticipated,
            direct_reply_to_owner: thread.directReplyToOwner,
            message_count: thread.messageCount,
            previous_messages: thread.previousMessages.slice(
              -MAX_PREVIOUS_MESSAGES,
            ),
          },
        }
      : {}),
  };
}

function categoryInstructions(cat: JevCategoryInput): string {
  return (
    `Does \`email\` clearly belong in the owner's custom category ` +
    `"${cat.name}"? Category description: ${cat.description}`
  );
}

// The first request carries the six fixed questions plus up to 26
// categories; extra requests carry categories in chunks of 32 with the
// same state. Category question ids are `c<globalIndex>`.
export function buildJevRequests(input: JevRequestInput): JevRequestBody[] {
  const state = buildState(input);
  const cats = input.categories;
  const requests: JevRequestBody[] = [];

  const firstCats = cats.slice(0, JEV_MAX_QUESTIONS - FIXED_QUESTION_COUNT);
  const firstQuestions: Record<string, JevQuestion> = {
    inbox: {
      type: "choice",
      instructions: INBOX_QUESTION_INSTRUCTIONS,
      criteria: { ...INBOX_CRITERIA },
    },
  };
  for (const [id, instructions] of Object.entries(FIXED_NOUL_QUESTIONS)) {
    firstQuestions[id] = { type: "noul", instructions };
  }
  for (let i = 0; i < firstCats.length; i++) {
    firstQuestions[`c${i}`] = {
      type: "noul",
      instructions: categoryInstructions(firstCats[i]),
    };
  }
  requests.push({ model: input.model, state, questions: firstQuestions });

  for (let i = firstCats.length; i < cats.length; i += JEV_MAX_QUESTIONS) {
    const chunk = cats.slice(i, i + JEV_MAX_QUESTIONS);
    const questions: Record<string, JevQuestion> = {};
    for (let j = 0; j < chunk.length; j++) {
      questions[`c${i + j}`] = {
        type: "noul",
        instructions: categoryInstructions(chunk[j]),
      };
    }
    requests.push({ model: input.model, state, questions });
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

export type JevAnswer = JevAnswerChoice | JevAnswerNoul;

export interface JevResponseBody {
  answers?: Record<string, JevAnswer | undefined>;
}

export function mergeJevAnswers(
  responses: JevResponseBody[],
): Record<string, JevAnswer | undefined> {
  const answers: Record<string, JevAnswer | undefined> = {};
  for (const res of responses) {
    Object.assign(answers, res.answers ?? {});
  }
  return answers;
}

export function noulValue(
  answers: Record<string, JevAnswer | undefined>,
  id: string,
): number | undefined {
  const a = answers[id];
  return a && a.type === "noul" ? a.noul : undefined;
}

const GENUINE_REPLY_MIN = 0.6;
const AUTOMATED_REPLY_MAX = 0.5;
const NEEDS_ATTENTION_MIN = 0.75;
const ATTENTION_OTHER_MAX = 0.5;
const OTHER_MIN = 0.6;

export function decideInbox(
  answers: Record<string, JevAnswer | undefined>,
  opts: { folderRole: string },
): InboxBucket {
  if (opts.folderRole === "junk") return "other";
  const genuineReply = noulValue(answers, "genuine_reply");
  const automated = noulValue(answers, "automated");
  const bulk = noulValue(answers, "bulk");
  const coldOutreach = noulValue(answers, "cold_outreach");
  const needsAttention = noulValue(answers, "needs_attention");
  if (
    genuineReply !== undefined &&
    genuineReply >= GENUINE_REPLY_MIN &&
    (automated === undefined || automated < AUTOMATED_REPLY_MAX)
  ) {
    return "primary";
  }
  if (
    needsAttention !== undefined &&
    needsAttention >= NEEDS_ATTENTION_MIN &&
    (bulk === undefined || bulk < ATTENTION_OTHER_MAX) &&
    (coldOutreach === undefined || coldOutreach < ATTENTION_OTHER_MAX)
  ) {
    return "primary";
  }
  if (
    (automated !== undefined && automated >= OTHER_MIN) ||
    (bulk !== undefined && bulk >= OTHER_MIN) ||
    (coldOutreach !== undefined && coldOutreach >= OTHER_MIN)
  ) {
    return "other";
  }
  const inboxAnswer = answers["inbox"];
  if (
    inboxAnswer &&
    inboxAnswer.type === "choice" &&
    (inboxAnswer.choice === "primary" || inboxAnswer.choice === "other")
  ) {
    return inboxAnswer.choice;
  }
  return "primary";
}

export interface ParsedJevClassification {
  inbox: InboxBucket;
  inboxConfidence?: number;
  categoryIds: string[];
}

export function parseJevResponses(
  responses: JevResponseBody[],
  categories: JevCategoryInput[],
  opts: { folderRole: string },
): ParsedJevClassification {
  const answers = mergeJevAnswers(responses);
  const inboxAnswer = answers["inbox"];
  return {
    inbox: decideInbox(answers, opts),
    inboxConfidence:
      inboxAnswer && inboxAnswer.type === "choice"
        ? inboxAnswer.confidence
        : undefined,
    categoryIds: categories
      .filter((_, i) => (noulValue(answers, `c${i}`) ?? 0) >= JEV_CATEGORY_THRESHOLD)
      .map((c) => c.id),
  };
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
  /^(no[-_.]?reply|donotreply|do[-_.]?not[-_.]?reply|notifications?|mailer[-_.]?daemon|bounce[ds]?|newsletters?|marketing|promo|promotions|automated?)@/i;

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
  return "primary";
}
