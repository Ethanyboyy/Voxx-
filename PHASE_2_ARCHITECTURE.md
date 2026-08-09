# Phase 2 Architecture — From AI Application to Cognitive Operating System

## Context

Phase 1 built a working foundation: chat, encrypted memory, projects, a cognitive
profile engine, a (mock) research abstraction, a minimal knowledge graph, and an
explicit permission system — all real, none faked, but largely independent subsystems
wired together only loosely (chat reads the N most recent memories; research is a
transparent placeholder; the knowledge graph has no callers; cognition only runs when
a button is pressed).

Phase 2's job is to connect these into one loop that actually reasons: retrieve
relevant memory by meaning, ground reasoning in real external information, connect
what's learned in a real graph, notice something worth acting on, and propose — never
silently perform — a next step. This document is the architecture for that loop,
written before any Phase 2 code, per the operating rule that structural changes get
designed first.

**Principle carried over unchanged from Phase 1**: nothing here weakens
`enforceCapability()`, the encryption boundary, or the "never silently upgrade
confidence" rule. Phase 2 adds capability; it does not add autonomy. No new code path
performs a consequential action without an explicit `Permission` grant, and Phase 2
introduces zero integrations that reach outside VOX except the two named below.

## What's reused vs. what changes

| Phase 1 system | Phase 2 treatment |
| --- | --- |
| `Memory` + `MemorySource` + encryption (`src/lib/security/crypto.ts`) | **Extended**, not touched structurally. New satellite tables (embeddings, relations); `Memory.content` stays encrypted exactly as today. |
| `AIProvider` abstraction (`src/lib/ai/`) | **Reused as-is.** The research provider and the contradiction/insight detectors call `getAIProvider()` — no new provider-abstraction pattern needed, the existing one already fits. |
| `ResearchProvider` abstraction (`src/lib/research/`) | **Interface reused, implementation added.** `MockResearchProvider` stays (still the test default); new `AnthropicWebSearchProvider` becomes the real one. |
| `KnowledgeNode` / `KnowledgeConnection` | **Extended.** `KnowledgeConnection` (from/to/relation) is already generic enough — untouched. `KnowledgeNode` gains explicit optional links to first-class records. |
| `Permission` / `enforceCapability()` | **Reused unchanged**, and now load-bearing: the Proposal engine's approval step *is* a call to this existing function. |
| `Event` (audit log) | **Extended** with two nullable descriptive columns to double as the durable domain timeline, per item 7 of the brief. |
| Cognition (`Observation`, `Hypothesis`, `Pattern`) | **Reused, and made a producer for** the new `Proposal` model. Pattern detection stays on-demand (see below on why we don't add a scheduler yet). |
| Chat pipeline (`src/lib/chat/service.ts`) | **`buildSystemPrompt()` changes signature** (takes the current query, returns a context trace alongside the prompt) — the one intentional breaking change, contained to its two callers. |
| UI pages | **Additive.** No Phase 1 page is rewritten; new surfaces (Graph Explorer, Proposals inbox, Context Inspector drawer) are added alongside them. |

## 1. Semantic memory (dev order A)

### Embedding provider abstraction

New `src/lib/embeddings/` module, same shape as `ai/` and `research/`:

```ts
interface EmbeddingProvider {
  readonly id: string;
  readonly dimensions: number;
  embed(text: string): Promise<number[]>;
}
```

**Default provider — `LocalEmbeddingProvider`**: a dependency-free, deterministic,
fixed-dimension (256) feature-hashed, term-frequency-weighted, L2-normalized
bag-of-words vector. This is **lexical/statistical similarity (TF + hashing, cosine
ranked)**, not a neural embedding — it will not catch pure synonym rewrites the way a
trained model would, and the code/docs say so plainly rather than oversell it. It was
chosen deliberately, not as a fallback:

- **Zero network calls.** Verified in this environment that the realistic neural
  alternatives are unreachable here: Hugging Face Hub and Voyage AI's API are both
  blocked by egress policy (`huggingface.co:443` / `api.voyageai.com:443` → 403 policy
  denial), and OpenAI's API is blocked the same way. `api.anthropic.com` is the only
  externally-reachable AI endpoint from this sandbox. A default that depends on any of
  the blocked services would be untestable here and is a bad default regardless —
  see next point.
- **No third-party data exposure by default.** Rule 14 from the original build spec
  ("do not send personal data to third-party services unless explicitly authorized")
  applies directly to memory content. A neural embedding API is a real data-sharing
  surface; it must be opt-in, never the default.
- It's genuinely useful: cosine similarity over these vectors is a large, real
  improvement over recency-only retrieval for a personal memory store at the scale
  VOX operates at (hundreds to low thousands of memories).

**Optional provider — `VoyageEmbeddingProvider`**: real neural embeddings via Voyage
AI (Anthropic's own recommended embedding partner), used only when `VOYAGE_API_KEY`
is set. Implemented and tested (with a mocked HTTP layer, since the endpoint isn't
reachable from this sandbox) so it's real, working code for users who opt in — not a
stub. `src/lib/embeddings/index.ts` is the only place that chooses between them,
mirroring `src/lib/ai/index.ts`.

### Storage

```prisma
model MemoryEmbedding {
  id         String   @id @default(uuid())
  memory     Memory   @relation(fields: [memoryId], references: [id], onDelete: Cascade)
  memoryId   String   @unique
  provider   String   // "local-hashed-256" | "voyage-3" | ...
  dimensions Int
  vector     String   // JSON-encoded float array
  createdAt  DateTime @default(now())
}
```

A satellite table (same pattern as `MemorySource`), not a column on `Memory`, so
re-embedding with a different provider later doesn't touch the `Memory` row, and the
encrypted-content boundary on `Memory` itself is untouched. Vectors are **not
encrypted** — cosine similarity has to run in JS over stored numbers, so encrypting
them would defeat the purpose. This is a disclosed, documented trade-off (see
Security section) rather than an oversight.

Embeddings are computed **lazily**: `getSemanticMatches()` embeds any memory it
encounters without a stored vector, caches it, and moves on — no blocking backfill
migration, no separate batch job to keep in sync.

### Relationships, supersession, contradiction — extending `Memory` cleanly

```prisma
enum MemoryRelationType { RELATES_TO SUPERSEDES CONTRADICTS DERIVED_FROM SUPPORTS }

model MemoryRelation {
  id            String              @id @default(uuid())
  userId        String
  fromMemory    Memory              @relation("FromMemory", fields: [fromMemoryId], references: [id], onDelete: Cascade)
  fromMemoryId  String
  toMemory      Memory              @relation("ToMemory", fields: [toMemoryId], references: [id], onDelete: Cascade)
  toMemoryId    String
  type          MemoryRelationType
  note          String?
  confidence    Confidence          @default(LOW)
  createdAt     DateTime            @default(now())
}
```

Plus one new nullable column on `Memory`: `supersededAt DateTime?` — denormalized for
fast "give me active memories" queries; the `MemoryRelation` row of type `SUPERSEDES`
is the durable record of *why*. Superseding never deletes: a superseded memory stays
inspectable/exportable (Phase 1's "never silently hidden" rule), it's just excluded
from default retrieval and chat context.

**Contradiction detection is a detector, not a write path.** `checkForContradictions
(userId, memoryId)` (on-demand, same pattern as `detectPatterns()`): finds
semantically-similar existing memories via embeddings, then — only above a similarity
threshold — asks the configured `AIProvider` a small, cheap, JSON-structured question
("does B contradict A?"). If yes, it does **not** write a `MemoryRelation`
automatically; it creates a `Proposal` (§4) with `actionType:
"memory.create_relation"`. A human approves before VOX records a contradiction as
fact. This is the same "propose, don't act" posture requested for the whole system,
applied to VOX's own memory bookkeeping.

`User-confirmed vs. inferred` already exists (`MemoryCategory.INFERENCE` +
`MemorySourceType.USER_STATED` vs `INFERENCE`) — no schema change needed there, it's
one of the few "supports" requirements Phase 1 already satisfies.

### Chat integration

`buildSystemPrompt(userId, query)` (signature change, both call sites are in
`src/lib/chat/service.ts` / `src/app/api/chat/route.ts`) embeds the incoming message,
ranks memories by cosine similarity, and takes the top ~8 plus any `CONFIRMED`-
confidence facts not already included (so durable facts aren't crowded out by
whatever's topically similar right now). Returns `{ prompt, trace }` — `trace` is
exactly what §6 (Context Inspector) needs, see below.

## 2. Real research (dev order B)

New `src/lib/research/anthropic.ts` implementing the existing `ResearchProvider`
interface using the Anthropic Messages API's native `web_search` server tool
(`web_search_20250305` type, confirmed present in the installed SDK's types —
`WebSearchTool20250305`, `WebSearchToolResultBlock`, `TextBlock.citations`). Reuses
the same `ANTHROPIC_API_KEY` chat already requires — no new vendor, no new key.

Mechanically: call `client.messages.create()` with the `web_search` tool enabled and
`max_uses` capped (default 3, configurable), for a prompt asking Claude to research
the query. The response gives two things VOX keeps separate:

- **`WebSearchResultBlock`** entries (`title`, `url`, `page_age`) → one `ResearchItem`
  row per source, `confidence: LOW` (a search result, not a verified claim).
- **`TextBlock.citations`** → the model's synthesized answer, chunked into
  *grounded* spans (`cited_text` traceable to a specific source URL, `confidence:
  MEDIUM`) and *ungrounded* spans (the model's own reasoning connecting the sources,
  clearly labeled `confidence: LOW`, stored as a `ResearchItem` with `sourceUrl: null`
  and a `provenance` note). This is the literal implementation of "distinguish
  retrieved facts from its own reasoning" — it isn't a heuristic, the API gives us the
  boundary directly via which text is inside a citation and which isn't.

`VOX_RESEARCH_PROVIDER=anthropic` (new value) switches the factory in
`src/lib/research/index.ts`; `mock` stays the default in tests and stays available
for offline/no-key use, unchanged.

## 3. Richer knowledge graph (dev order C)

`KnowledgeConnection` (from/to/relation) is already a fully generic edge — reused
without changes. `KnowledgeNode` gets explicit, nullable, FK-backed links to every
first-class record type named in the brief:

```prisma
model KnowledgeNode {
  // ...existing fields (label, type, description)...
  memoryId       String?  @unique
  projectId      String?  @unique
  goalId         String?  @unique
  taskId         String?  @unique
  decisionId     String?  @unique
  ideaId         String?  @unique
  experimentId   String?  @unique
  researchItemId String?  @unique
  // + matching @relation fields, each onDelete: Cascade
}
```

This is more columns than a generic `entityType/entityId` pair would need, and that's
a deliberate choice, not an oversight: Prisma has no native polymorphic-association
support, so a string-typed `entityId` gives up real foreign-key integrity and
cascading delete — a deleted `Task` would leave an orphaned graph node pointing at
nothing. The explicit-column version costs schema verbosity and buys correctness for
free from the database. `Person`, `Organization`, `Concept`, `Topic` (not first-class
tables) stay as free-floating nodes — all link columns `null`, just `label` +
`type` + `description`, exactly like Phase 1's `KnowledgeNode` today.

New service functions in `src/lib/knowledge/service.ts`:

- `ensureNodeForEntity(userId, type, id)` — get-or-create, so creating a Project (say)
  can idempotently get a graph node to attach connections to, without every domain
  service having to know graph internals.
- `findRelated(userId, nodeId, depth = 1)` — bounded BFS traversal for the reasoning
  layer and the eventual graph explorer UI. Depth capped (default 1, max 3) since this
  is an in-process JS traversal over what's expected to be a few thousand rows at
  most, not a graph database.

## 4. Event / observation model (dev order D)

The existing `Event` model is already append-only and durable — it's the right table,
just under-used (Phase 1 only wrote to it for memory ops and permission checks). Two
additions:

```prisma
model Event {
  // ...existing fields...
  subjectType String?  // "Task" | "Goal" | "Memory" | "Decision" | "Experiment" | ...
  subjectId   String?  // intentionally NOT a foreign key
}
```

`subjectId` is deliberately unconstrained (unlike the knowledge graph's links): an
event log needs to survive the deletion of the thing it describes ("task deleted" has
to remain readable after the task is gone), so this is the one place in Phase 2 where
loose, descriptive-only referencing is the *correct* choice, not a shortcut.

Every domain service (`projects/service.ts`, `research/service.ts`,
`cognition/service.ts`) gets `recordEvent()` calls at the state transitions the brief
names explicitly: task completed, goal status changed, research discovered, memory
updated/superseded, decision made, experiment result recorded, project milestone
(a project's `status` becoming `COMPLETED`). `consequential` keeps its Phase 1 meaning
(security-audit-relevant); these are ordinary (non-consequential) domain events unless
they also happen to be a permission check.

`Observation` (cognition) keeps its distinct, narrower role: not "what happened" but
"what VOX noticed about behavior" — a specific, dimension-tagged interpretation that
may be *informed by* the Event timeline (pattern detection reads `Event` rows now, in
addition to the direct table queries it already does) without the two models merging.

## 5. Cognition proposal engine (dev order E)

```prisma
enum ProposalStatus { PROPOSED APPROVED DENIED EXPIRED EXECUTED FAILED }

model Proposal {
  id              String          @id @default(uuid())
  userId          String
  observation     String   // "Observed X"
  connection      String?  // "Connected it with Y"
  implication     String?  // "Possible implication: Z"
  suggestedAction String   // "Suggested action: A", human-readable
  actionType      String   // machine key, e.g. "memory.create_relation", "task.create"
  actionPayload   String   // JSON — concrete params for execution
  capability      String   // Permission capability key, checked before executing
  requiredLevel   CapabilityLevel @default(RECOMMEND)
  confidence      Confidence      @default(LOW)
  evidence        String?  // JSON: memoryIds/researchItemIds/observationIds/eventIds
  status          ProposalStatus  @default(PROPOSED)
  result          String?  // outcome text, or denial reason
  createdAt       DateTime @default(now())
  resolvedAt      DateTime?
}
```

`src/lib/cognition/proposals.ts`:

- `createProposal()` — called by detectors (contradiction detector, an extended
  `detectPatterns()`, a new research-driven insight step). Always starts `PROPOSED`.
  Nothing calls the executor directly.
- `approveProposal(userId, id)` → **calls the existing
  `enforceCapability(userId, proposal.capability, proposal.requiredLevel)`
  unmodified** — the Phase 1 permission system is not re-implemented, it's the actual
  gate. On success, dispatches through a small, fixed action registry
  (`Record<actionType, (userId, payload) => Promise<string>>`) to the already-existing
  internal service function the action maps to, writes `result`, sets `EXECUTED`,
  records an `Event`.
- `denyProposal(userId, id, reason?)` → `DENIED`, `Event` recorded either way.

**The action registry is a closed allowlist of safe, internal operations only** —
create a memory relation, create a task, link two graph nodes, flag a pattern as
reviewed. No entry in it reaches outside VOX. This is what makes "no autonomous
consequential external action" structural rather than a promise: there is currently
nothing in the registry *capable* of an external side effect, because no external
integration exists yet to register. Adding one later (email, calendar, whatever) means
adding one handler function that itself calls `enforceCapability` at `ACT` — the
proposal system doesn't need to change.

## 6. Context inspector (dev order F)

`Message.meta` already exists (`String?`, JSON, currently unused) — Phase 2 populates
it instead of adding a column. `buildSystemPrompt()`'s new return shape:

```ts
interface ContextTrace {
  memoriesUsed: { id: string; confidence: Confidence; similarity: number }[];
  researchItemsUsed: { id: string; url: string | null; confidence: Confidence }[];
  graphEntitiesConsidered: string[]; // KnowledgeNode ids
  relevantProjectId: string | null;
  assumptions: string[];
}
```

`POST /api/chat` stores this on the assistant `Message` via the `meta` param
`addMessage()` already accepts. `ChatClient` gets a "Context" toggle per assistant
message (additive — the existing message bubble is unchanged, this is a collapsible
panel under it) that renders the trace: which memories/sources fed this answer, at
what confidence, and which parts of the answer are grounded vs. the model's own
synthesis. No hidden chain-of-thought is ever exposed — only this structured,
auditable record.

## 7. Visual cognitive workspace (dev order G)

Explicitly **not** a redesign of Phase 1's pages — those stay. Three additive
surfaces:

- **Graph Explorer** (`/graph`) — node/edge visualization over `KnowledgeNode` +
  `KnowledgeConnection`, click a node to see its linked record inline (memory,
  project, etc.) via `findRelated()`.
- **Proposals inbox** (`/proposals`) — list of `Proposal` rows by status, the
  approve/deny UI, with each proposal showing its evidence trail.
- **Context panel** — a persistent "what am I looking at" strip (active project,
  active entity) surfaced in the existing `AppShell`, so moving between Memory →
  Graph → Proposals → Chat doesn't lose the thread, per the brief's explicit ask.

## 8. Security implications (new in Phase 2)

- **Unencrypted embedding vectors**: disclosed above and in `SECURITY.md` — cosine
  similarity requires computing over plaintext-derived numbers in JS; encrypting them
  would require decrypting every memory on every search, which defeats the
  `Memory.content` encryption's purpose. The vector is a hashed, lossy bag-of-words
  representation, not the plaintext, but it is a side channel and is documented as
  one.
- **Voyage embedding (opt-in only)**: if `VOYAGE_API_KEY` is set, memory content is
  sent to Voyage AI for embedding. Off by default; `SECURITY.md` gets an explicit
  callout, matching how `ANTHROPIC_API_KEY` is already documented.
- **Anthropic web search**: research queries (not memory content) go to Anthropic —
  already the trust boundary chat operates inside; no new third party.
- **Proposal execution**: still goes through `enforceCapability()` — no new bypass
  path. The action registry is closed/static, not dynamically dispatched from
  arbitrary strings beyond the fixed key set.

## 9. Migration strategy

One additive Prisma migration: new tables (`MemoryEmbedding`, `MemoryRelation`,
`Proposal`), new nullable columns (`Memory.supersededAt`, `Event.subjectType`,
`Event.subjectId`, eight nullable link columns on `KnowledgeNode`). Nothing existing
is dropped, renamed, or made non-nullable — Phase 1 data and every Phase 1 code path
keeps working unchanged. Embeddings backfill lazily (§1) rather than in the migration
itself, keeping the migration purely structural.

## 10. Testing

Same bar as Phase 1 — `npm run typecheck && npm run lint && npm test && npm run
build` green before any subsystem is considered done. New coverage per subsystem:
embedding provider (deterministic vector math, similarity ranking), semantic
retrieval ranking, relation/supersession/contradiction-proposal flow, the Anthropic
research provider (with the SDK call mocked — no live network needed to test the
parsing/grounding-split logic), knowledge graph FK-linking + traversal, event
recording at each new call site, the proposal engine's full
propose→approve(permission-gated)→execute→result path (including a denied-permission
case), and context-trace population. Finally, one integration test exercising the
complete loop end-to-end (§11).

## 11. The end-to-end scenario this architecture has to support

1. A `detectPatterns()`-style detector **observes** something from the `Event`
   timeline (e.g. a project's goal hasn't moved in N days).
2. It queries **semantic memory** for context relevant to that goal.
3. It runs **real research** (Anthropic web search) on a question the memory doesn't
   answer.
4. It **connects** the goal, the memory, and the new research source in the
   **knowledge graph**.
5. It forms a **possible implication** and writes a **Proposal** (not an action).
6. The user reviews it in the Proposals inbox and **approves** — `enforceCapability()`
   runs for real.
7. The registered handler executes (an internal, safe action) and the **result** is
   recorded on the `Proposal` and the `Event` timeline.

Every step above is backed by a real table and a real service function in this
document — nothing in the demo is scripted output; it's the actual data flowing
through the actual system.
