# Running VOX's first live economic experiment

This is the operator procedure for conducting one real commercial experiment
against one real Shopify store, end to end, using only the paths that already
exist. It documents the state of the code, not an aspiration.

**No step of this has ever been run against a real store.** Every test in
`tests/p5-*`, `tests/p6-*` drives the provider through a stubbed `fetch`. The
write path is architecturally complete and empirically unexercised, and this
document exists so that the first person with a credential does not also have to
reverse-engineer the sequence from the test files. See
`ECONOMIC_INVARIANTS.md#what-is-still-not-true`.

---

## 0. What you need, and what VOX will not get for you

A **custom-app Admin API access token** for one Shopify store, with
`read_orders` and `write_discounts`, pasted in by a person.

There is no environment-variable path, no OAuth flow, and no autonomous
acquisition path. `connectShopifyStore()` is the only door, it takes the token
as an argument, and it proves the token with a real authenticated read before it
stores anything — a token that does not work is never persisted. VOX cannot
obtain a credential on its own and must not be asked to.

Create the token in the Shopify admin under **Settings → Apps and sales channels
→ Develop apps → Create an app → Configure Admin API scopes**.

---

## 1. Check where you are

```
GET /api/economic/live-readiness
```

Read-only, local, and it makes **no external call** — a preflight that phoned
Shopify to prove the token still works would itself be the live request it is
meant to be checking the preconditions for. It names the **earliest** unmet
precondition rather than all of them, because there is one next step, and it
returns the shop domain (public) and nothing else about the credential: not the
token, not a prefix, not a length, not a hash.

| state | meaning |
|---|---|
| `CREDENTIAL_MISSING` | no store connected, or the connection is not `CONNECTED` |
| `CREDENTIAL_INVALID` | a credential exists and cannot be used — **not** "Shopify rejected it" |
| `PERMISSION_INSUFFICIENT` | `integration.shopify.write` is not granted at ACT, or the write scope was never declared |
| `LIVE_CONNECTED` | the path is open and nothing is queued on it |
| `AUTHORIZATION_REQUIRED` | one frozen intervention is prepared and waiting for a person — **this is success, not failure** |
| `READY_FOR_LIVE_EXECUTION` | the next execution would write to a real store |

`CREDENTIAL_MISSING` is the state this repository is in.

---

## 2. Grant access — **before** connecting, not after

```
POST /api/connections/SHOPIFY/grant-access
{ "read": true, "write": true }
```

This grants `integration.shopify.read` at RECOMMEND and
`integration.shopify.write` at ACT through the real `grantPermission()`.

> **The order matters and it is not guessable.** `grantAccess()` is the
> Connections Hub path, and the Hub's registered SHOPIFY provider is the stub,
> so it *always* finishes by setting the connection row to `ERROR` with "not
> configured yet". Run it **first**, while there is nothing to wreck: step 3
> overwrites the row. Run it *after* connecting and you will have put a store
> that verified against the live API into `ERROR`, and the preflight will
> correctly report `CREDENTIAL_MISSING`.
>
> Tested, so it cannot silently change:
> `tests/p6-g-live-readiness.test.ts` → *GRANT ACCESS FIRST, THEN CONNECT*.

The `ERROR` in this step's response is expected and is not a failed grant. The
`Permission` rows are written and they survive step 3.

---

## 3. Connect the store

```
POST /api/connections/shopify
{ "shopDomain": "your-store.myshopify.com",
  "accessToken": "shpat_…",
  "declaredWriteScopes": ["write_discounts"] }
```

The token arrives in the body and is never echoed back — not in the response,
not in an error message, not in the `Event` this writes. Only the shop domain
leaves.

`declaredWriteScopes` is **declared by you, not proven**. VOX cannot verify a
write scope without performing a write, so the preflight reports it as declared
and the write path refuses before sending anything if it is absent. If the real
app lacks `write_discounts`, you will find out at step 7 when Shopify refuses —
which is a `FAILED` action with nothing created, not a silent success.

Confirm with step 1: expect `LIVE_CONNECTED`.

---

## 4. Create the experiment

```
POST /api/economic/experiments
{ "hypothesis": "…", "maxLossUsd": …, "successMetric": "…", … }
```

The economic terms are written incrementally and `readyExperiment()`
(`POST .../ready`) is the gate that refuses an incomplete one. See
`ECONOMIC_ENGINE_ARCHITECTURE.md`.

---

## 5. Declare the intervention

```
POST /api/commerce/actions
{ "experimentId": "…", "externalScope": "your-store.myshopify.com",
  "code": "VOXTEST10", "title": "…", "percentageFraction": 0.1,
  "startsAt": "…", "endsAt": "…", "usageLimit": 25,
  "appliesOncePerCustomer": true }
```

One bounded, time-limited, usage-capped, reversible discount code. The action is
frozen by `contractDigest` the moment it is declared, its `experimentId` is
UNIQUE (one intervention per experiment), and it lands `PLANNED` — nothing has
been sent.

**Keep the discount small and the usage limit low.** This is a real change to a
real merchant's store, and the first run's purpose is to establish that the
machinery works, not to maximize anything.

---

## 6. Declare the observation window, naming the code

```
POST /api/economic/experiments/{id}/contract
{ "rule": "EXTERNAL_ORDER_VALUE", "externalScope": "your-store.myshopify.com",
  "windowStart": "…", "windowMinutes": 10080,
  "observationSubject": "VOXTEST10" }
```

**This must happen before step 7 and it cannot happen after.**
`declareObservationContract()` refuses `ALREADY_DISPATCHED` once an execution
identity exists, because choosing the question with the answer in view is the
thing the freeze prevents.

`observationSubject` must be *this experiment's own* intervention's code; any
other value is refused `SUBJECT_MISMATCH`. Without a subject the window measures
every order the store takes in it, and the experiment would be credited with a
week of ordinary trading it had nothing to do with. See
`ECONOMIC_INVARIANTS.md#i23`.

Set `windowStart` to the discount's own start and `windowMinutes` to its
duration. The window is frozen into `observationContractDigest`; editing it later
is detected.

---

## 7. Dispatch — and then stop

```
POST /api/commerce/actions/{actionId}/dispatch
```

Takes **no body**: the digest is read off the frozen row, so there is nowhere for
a caller to name an action's arguments.

The expected response is

```json
{ "runStatus": "WAITING_FOR_PERMISSION", "actionStatus": "PLANNED", "externalId": null }
```

and it means **nothing was sent**. The step is a policy HOLD at
`integration.shopify.write` / ACT, so it stopped to ask a person. A dispatch that
parks is a *successful* dispatch — treating it as an error is how an operator
learns to retry past the gate.

---

## 8. Approve it, as a person

```
GET  /api/agents/{runId}/steps/{stepId}/approve     ← read what is pending; creates nothing
POST /api/agents/{runId}/steps/{stepId}/approve
{ "argumentsHash": "<the hash shown by the GET>" }
```

This is the one HTTP surface in VOX at which a decision becomes an
`ApprovalGrant`. The grant binds the hash of the **validated arguments**, which
include the contract digest — so a parameter edited between approval and
execution changes the digest, changes the hash, and the grant stops matching. A
person approving 5% off cannot have 50% off executed on their grant.

**Approving resumes the run and the discount code is created in the real store.**
Everything before this point is reversible by deleting rows. This is not.

Read the GET output before you POST. It is the last point at which nothing has
happened.

---

## 9. Resolve the outcome — three states, and none of them collapse

The write port returns **APPLIED**, **REFUSED**, or **UNKNOWN**, and only
APPLIED carries an `externalId`.

- **`SUCCEEDED`** — the code exists. Continue to step 10.
- **`FAILED`/`REFUSED`** — the store declined, or VOX refused before sending.
  Nothing was created.
- **`UNKNOWN`** — it may or may not have happened. **It will not be retried.**
  Ask the store:
  ```
  POST /api/commerce/actions/{actionId}/observe
  ```
  This is the only way to resolve an ambiguous write. Until it resolves, nothing
  can be bound as a subject and no measurement is possible — which is correct:
  the ambiguity stays ambiguous instead of resolving itself into a zero.

---

## 10. Confirm the subject exists

```
POST /api/economic/experiments/{id}/intervention
```

Takes **no body** — a body would be somewhere for a caller to supply an external
id of its own choosing. It copies the `externalId` the provider returned onto the
experiment whose window already names that code.

Refused for an `UNKNOWN` action, refused if the contract changed since it was
declared, and refused on a second call (`ALREADY_BOUND` — idempotent by refusal,
not by overwrite). Until it succeeds, the store is never asked.

---

## 11. Record the prediction — before any measurement

```
POST /api/economic/experiments/{id}/predict
```

The prediction must be frozen **before** the measurement is established
(`prediction_created_at < measurement_established_at`), and
`promoteMeasuredFigure()` checks it. See `ECONOMIC_INVARIANTS.md#i21`.

---

## 12. Wait out the window, then observe

```
POST /api/economic/experiments/{id}/execute
```

The declared window has to actually elapse: a read taken early is refused
`WINDOW_NOT_CLOSED`, because a partial period is systematically low and a short
number looks exactly like a real one.

This route claims the experiment's one-and-only execution identity and hands the
work to the existing executor — it dispatches the observation, it is not an
execution path of its own. The read runs through the
`economic.observe_order_value` tool at `integration.shopify.read` / RECOMMEND,
which takes the experiment id **and nothing else**: the store, the window, the
rule and the subject all come from the frozen contract, so no caller can aim it
at a different shop or a better week. It reads the **whole**
declared window, checks the count against the store's own `ordersCount`
(the completeness oracle — a short read is a refusal, not a smaller number), then
sums only the orders carrying the subject code.

Three outcomes that must never be confused:

- **observed zero** — the code existed, the window was read completely, nobody
  used it. `sumDecimals([])` is an exact zero at scale 0. **This is a result, and
  arguably the most useful one a first experiment can produce.** It is not a
  failure and it is not an error.
- **unavailable** — the read did not complete. There is no number.
- **not configured** — there is no credential.

---

## 13. Reconcile, and say only what is true

```
POST /api/economic/experiments/{id}/reconcile
{ "verdict": "WIN" | "LOSS" | "INCONCLUSIVE", "note": "…" }
```

`INCONCLUSIVE` is a real answer and the honest one for a first run that only
established that the machinery works. A single verdict is also not a success
rate: `ProbabilityEvidence` is returned whole — wins, losses, decided, and the
basis each verdict rested on — precisely so nothing renders "1 of 1" as "100%".

What you may claim:

> The store recorded $X of gross order value across N orders carrying code
> VOXTEST10, inside the declared window.

What you may **not** claim, in any form:

- "the discount caused $X in revenue" — orders carrying a code are
  **redemptions**. Whether the code caused the purchase is a counterfactual VOX
  cannot observe. There is no causal methodology in this codebase.
- "$X in revenue" — it is **gross order value at order time**, before refunds,
  chargebacks, cost of goods and fees.
- "$X in profit" — profit is not computed from this and `REALIZED` profit is $0.
- "VOX made money" — nothing here moves money or reads an account balance.
  Available capital is `null`, not zero.

---

## Reverting

A discount code is reversible by design: time-limited (`endsAt`),
usage-capped (`usageLimit`), and deletable from the Shopify admin under
**Discounts**. Deleting it does not un-record anything VOX measured, and should
not — the measurement is a fact about a window that has already passed.

VOX has **no revert tool**. Disabling the code is done in the Shopify admin, by
a person. That gap is deliberate for now: a delete tool would be a second
external write, and P5-G/P6-F/P6-G add exactly one.

---

## What P6-G added, and what it did not

**Added** — three things, all of them plumbing:

- `src/lib/commerce/liveReadiness.ts` + `GET /api/economic/live-readiness` —
  the preflight in step 1. Read-only, local, no external call, never returns the
  token.
- `POST /api/economic/experiments/{id}/contract` — step 6 had **no HTTP
  surface at all**. `declareObservationContract()` has existed since P5-E and
  took a subject since P6-F, and its only callers were test files: a window
  could be frozen in a spec and nowhere else.
- `src/lib/commerce/dispatch.ts` + `POST /api/commerce/actions/{id}/dispatch` —
  step 7's only route into the executor was `POST /api/agents`, which hands an
  objective to a **planner**. Reaching the write tool through the application
  meant hoping a model chose `commerce.create_discount_code` and typed the right
  action id and the right 64-hex digest into it. The P6-F tests build the run by
  hand, which is exactly why they could run and the application could not.

**Not added:** no new capability, no new grant path, no auto-approval, no
threshold below which approval is skipped, no second execution path, no revert
tool, no causal attribution, and no relaxation of any existing gate. The two new
write-path modules import no `executeCommercialAction`, no `createApprovalGrant`,
no `grantPermission`, no `enforceCapability`, and perform no `fetch` of their
own — asserted by source scan in `tests/p6-g-live-readiness.test.ts`.

**And P6-G did not run.** No live Shopify credential exists in this environment
by any route, so the procedure above stops at step 1 with `CREDENTIAL_MISSING`.
Nothing was faked to get past it.
