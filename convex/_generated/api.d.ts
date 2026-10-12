/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as accounts from "../accounts.js";
import type * as apiKeys from "../apiKeys.js";
import type * as categories from "../categories.js";
import type * as content from "../content.js";
import type * as crons from "../crons.js";
import type * as drafts from "../drafts.js";
import type * as http from "../http.js";
import type * as ingest from "../ingest.js";
import type * as lib_addresses from "../lib/addresses.js";
import type * as lib_apiKeyFormat from "../lib/apiKeyFormat.js";
import type * as lib_attachmentLimits from "../lib/attachmentLimits.js";
import type * as lib_classify from "../lib/classify.js";
import type * as lib_compose from "../lib/compose.js";
import type * as lib_counters from "../lib/counters.js";
import type * as lib_draftAttachment from "../lib/draftAttachment.js";
import type * as lib_html from "../lib/html.js";
import type * as lib_idempotency from "../lib/idempotency.js";
import type * as lib_jev from "../lib/jev.js";
import type * as lib_mailServers from "../lib/mailServers.js";
import type * as lib_ports from "../lib/ports.js";
import type * as lib_quoteSplit from "../lib/quoteSplit.js";
import type * as lib_searchHits from "../lib/searchHits.js";
import type * as lib_smtpDelivery from "../lib/smtpDelivery.js";
import type * as lib_smtpFailure from "../lib/smtpFailure.js";
import type * as lib_snippet from "../lib/snippet.js";
import type * as lib_subject from "../lib/subject.js";
import type * as lib_syncEngine from "../lib/syncEngine.js";
import type * as lib_syncPlan from "../lib/syncPlan.js";
import type * as lib_threadSummary from "../lib/threadSummary.js";
import type * as lib_types from "../lib/types.js";
import type * as lib_uidset from "../lib/uidset.js";
import type * as lib_uncertainSend from "../lib/uncertainSend.js";
import type * as liveSupport from "../liveSupport.js";
import type * as mail from "../mail.js";
import type * as model_auth from "../model/auth.js";
import type * as model_draftCleanup from "../model/draftCleanup.js";
import type * as model_ingest from "../model/ingest.js";
import type * as model_pendingOps from "../model/pendingOps.js";
import type * as model_threading from "../model/threading.js";
import type * as model_threads from "../model/threads.js";
import type * as node_accountsOps from "../node/accountsOps.js";
import type * as node_classify from "../node/classify.js";
import type * as node_content from "../node/content.js";
import type * as node_crypto from "../node/crypto.js";
import type * as node_draftAttachments from "../node/draftAttachments.js";
import type * as node_draftsOps from "../node/draftsOps.js";
import type * as node_imap from "../node/imap.js";
import type * as node_lease from "../node/lease.js";
import type * as node_mailParser from "../node/mailParser.js";
import type * as node_ops from "../node/ops.js";
import type * as node_sendOps from "../node/sendOps.js";
import type * as node_store from "../node/store.js";
import type * as node_sync from "../node/sync.js";
import type * as send from "../send.js";
import type * as settings from "../settings.js";
import type * as syncStore from "../syncStore.js";
import type * as validators from "../validators.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  accounts: typeof accounts;
  apiKeys: typeof apiKeys;
  categories: typeof categories;
  content: typeof content;
  crons: typeof crons;
  drafts: typeof drafts;
  http: typeof http;
  ingest: typeof ingest;
  "lib/addresses": typeof lib_addresses;
  "lib/apiKeyFormat": typeof lib_apiKeyFormat;
  "lib/attachmentLimits": typeof lib_attachmentLimits;
  "lib/classify": typeof lib_classify;
  "lib/compose": typeof lib_compose;
  "lib/counters": typeof lib_counters;
  "lib/draftAttachment": typeof lib_draftAttachment;
  "lib/html": typeof lib_html;
  "lib/idempotency": typeof lib_idempotency;
  "lib/jev": typeof lib_jev;
  "lib/mailServers": typeof lib_mailServers;
  "lib/ports": typeof lib_ports;
  "lib/quoteSplit": typeof lib_quoteSplit;
  "lib/searchHits": typeof lib_searchHits;
  "lib/smtpDelivery": typeof lib_smtpDelivery;
  "lib/smtpFailure": typeof lib_smtpFailure;
  "lib/snippet": typeof lib_snippet;
  "lib/subject": typeof lib_subject;
  "lib/syncEngine": typeof lib_syncEngine;
  "lib/syncPlan": typeof lib_syncPlan;
  "lib/threadSummary": typeof lib_threadSummary;
  "lib/types": typeof lib_types;
  "lib/uidset": typeof lib_uidset;
  "lib/uncertainSend": typeof lib_uncertainSend;
  liveSupport: typeof liveSupport;
  mail: typeof mail;
  "model/auth": typeof model_auth;
  "model/draftCleanup": typeof model_draftCleanup;
  "model/ingest": typeof model_ingest;
  "model/pendingOps": typeof model_pendingOps;
  "model/threading": typeof model_threading;
  "model/threads": typeof model_threads;
  "node/accountsOps": typeof node_accountsOps;
  "node/classify": typeof node_classify;
  "node/content": typeof node_content;
  "node/crypto": typeof node_crypto;
  "node/draftAttachments": typeof node_draftAttachments;
  "node/draftsOps": typeof node_draftsOps;
  "node/imap": typeof node_imap;
  "node/lease": typeof node_lease;
  "node/mailParser": typeof node_mailParser;
  "node/ops": typeof node_ops;
  "node/sendOps": typeof node_sendOps;
  "node/store": typeof node_store;
  "node/sync": typeof node_sync;
  send: typeof send;
  settings: typeof settings;
  syncStore: typeof syncStore;
  validators: typeof validators;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<
  typeof fullApi,
  FunctionReference<any, "public">
>;

/**
 * A utility for referencing Convex functions in your app's internal API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = internal.myModule.myFunction;
 * ```
 */
export declare const internal: FilterApi<
  typeof fullApi,
  FunctionReference<any, "internal">
>;

export declare const components: {};
