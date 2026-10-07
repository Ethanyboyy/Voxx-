# 72-hour revenue sprint

The goal is one legitimate dollar from one real customer, verified against a
payment processor, inside three days.

**Nothing in this document is evidence.** Every figure is one model's estimate,
recorded at `MODEL_SUGGESTED` and nowhere higher. No customer has been
contacted, no revenue exists, and `EconomicRevenue` holds zero rows. The
ranking is a starting order for where to spend three days, not a forecast.

---

## The conclusion first

**Sell one bounded automation to someone who already knows you, for $450 flat,
delivered in 48 hours, refunded if it doesn't work — with a free written audit
up front so they see real work before deciding.**

Not because it is the most interesting answer. Because at a 72-hour horizon the
binding constraint is not fulfilment capacity, margin, or market size — it is
**getting a reply from someone who believes you'll deliver.** Existing trust is
the only thing that collapses that to hours, and it is the one advantage that
cannot be built inside the window.

The uncomfortable corollary: **the most-built path in this repository is ranked
last.** The Shopify commercial-intervention machinery from P5-G/P6-F/P6-G is the
most carefully engineered economic surface here, and it cannot produce a dollar
this week — there is no store, no product, no traffic, and this session's
Shopify access returns `operation_not_allowed`. Engineering effort already spent
is not a reason to rank something. It was ranked last on its own numbers.

---

## The ranking

Computed by `src/lib/revenue/sprintRank.ts` over the rows in
`prisma/seedRevenueSprint.ts`. The sprint score is
**expected cash ÷ days to first dollar ÷ capital at risk**, adjusted for how
much of the work a human has to do. Verified by running it:

| # | Opportunity | Sprint | General | Days | Price | P(paid) |
|---|---|---:|---:|---:|---:|---:|
| 1 | **Warm-network ops fix** — one bounded automation, 48h, flat fee | **61.5** | 477.7 | 2 | $450 | 50% |
| 2 | Local same-day tech help — fix one thing for cash today | 33.3 | 275.0 | 1 | $175 | 25% |
| 3 | Free audit → paid fix, cold outreach to local service businesses | 31.9 | 261.2 | 3 | $450 | 25% |
| 4 | Resume / LinkedIn rewrites for individuals | 22.6 | 152.0 | 1 | $110 | 25% |
| 5 | Freelance marketplace micro-gigs with AI leverage | 19.9 | 144.4 | 2 | $300 | 25% |
| 6 | Done-for-you content or SEO sprint | 8.3 | 116.7 | 4 | $400 | 10% |
| 7 | Per-lead generation for local trades | 3.8 | 76.3 | 5 | $250 | 10% |
| 8 | Digital product on a marketplace with search traffic | 0.33 | 18.5 | 10 | $29 | 10% |
| 9 | Affiliate / referral content | 0.27 | 22.7 | 21 | $50 | 10% |
| 10 | E-commerce discount experiment (the existing Shopify path) | 0.00 | 0.04 | 30 | — | 10% |

"General" is the pre-existing `scoreOpportunity()`, shown because **the two
rankers genuinely disagree** and hiding that would obscure which question is
being answered. The general scorer computes
`speedMultiplier = 30 / max(7, days)` — **clamped at seven days** — so it cannot
distinguish "pays tomorrow" from "pays next week", which is the only distinction
that matters here. It also flips rows 8 and 9 relative to the sprint ranker.
`scoreOpportunity()` was deliberately left untouched; re-tuning a shared formula
to answer one time-boxed question would silently re-rank every opportunity in
the system.

Row 10's revenue estimate is **null, not zero**. With no product and no traffic
there is no honest number to put there, and a guess would be the fabrication the
whole economic engine exists to prevent.

---

## #1 in full

### Target customer

An owner-operated service business, 1–20 people, that still books appointments
or chases invoices by hand — **and whose owner already knows you.** Trades
(plumbing, HVAC, electrical, landscaping, cleaning), personal care (salons,
clinics, studios), professional services (bookkeepers, agencies, tutors), pet
and auto services.

Qualifier, in priority order: (1) you can message them without it being strange,
(2) one person can spend $450 without asking anyone, (3) the admin is visibly
manual from the outside.

### Problem

They lose several hours a week to admin they already know is broken, and they
have put off fixing it because every solution presented to them has been a
three-month software project with a monthly fee. Nobody has offered to fix one
specific thing by Thursday for a flat fee.

### Offer

One bounded automation — invoice chasing, booking intake, the ten questions they
answer daily, cold lead follow-up — built and working in 48 hours. Flat fee. Not
working, not paid. Free written audit first.

### Price

**$450 flat.** $250–300 for a warm contact or a small job; $750 where the
business is clearly larger. Below $150 the hours aren't worth it; above $1,000
it stops being one person's decision and the window closes.

### Why they'd buy now

- A free audit already named the problem and showed the arithmetic. Nobody else
  has done that.
- 48 hours, not three months.
- Flat fee with a refund — the downside is zero, which is what matters when
  buying from someone without a track record.
- One person decides. No procurement, no committee.
- You gave them a real reason you're asking: you want two finished projects this
  week. True, and far more persuasive than manufactured urgency.

### Payment

Stripe Payment Link (default), PayPal invoice, or Zelle/cash for local and warm
contacts. On delivery for warm contacts — asking a friend to pay before you've
done anything adds friction where you can least afford it. 50% up front is
reasonable for cold.

**Set this up before sending the first message.** The worst outcome in a 72-hour
sprint is a yes on day two and a day three spent working out how to accept $450.

### What the human must do

Only you can do these, and the sprint is bottlenecked entirely on them:

1. **Write the list.** 20–40 people you could message without it being weird.
   This list *is* the opportunity — everything else is downstream of it.
2. **Set up the payment method.** Before any outreach.
3. **Send every message individually.** No BCC, no merge. One personal detail
   each.
4. **Check every audit line** against what you actually saw. One invented detail
   about someone's own business ends the conversation.
5. **Take the call** if they want one.
6. **Confirm the scope in writing** before taking money.
7. **Verify the payment** at the processor and record it with its reference.

### What VOX can do

1. Draft the audits — findings, arithmetic, the one-page write-up — from public
   details you supply.
2. Draft and personalise the outreach messages and the one follow-up.
3. Build the automation itself: the code, the scripts, the integration.
4. Write the scope note and the delivery documentation.
5. Track the pipeline: who was asked, what they said, what came back
   (`/revenue`, `POST /api/revenue/outreach`).
6. Rank and re-rank the opportunities as you learn real numbers.
7. Book verified revenue to the ledger at `USER_RECORDED`, with its reference.

### What VOX must not and cannot do

- **Send anything.** `src/lib/revenue/outreach.ts` has no send path and imports
  nothing that reaches the network. A test fails the build if that changes. A
  model's judgement about who deserves a cold pitch is not a thing to automate
  at volume.
- **Open a payment account, or any account.**
- **Spend money.**
- **Claim a payment arrived.** Only you can verify that, and what gets recorded
  is that *you* verified it.

---

## Hour by hour

**Hours 0–2 (human).** Write the list of 20–40 names. Set up the Stripe link or
PayPal. Pick the three automations you're confident you can finish in two days
and will not go outside.

**Hours 2–6 (VOX + human).** Audits drafted for the 8–10 most promising names.
You check every line. Messages drafted and personalised.

**Hours 6–10 (human).** Send 20–40 individual messages. Record each one.

**Hours 10–24.** Replies arrive. Send the filled-in audit to every "maybe"
within a few hours — that is the conversion step. Confirm scope in writing with
anyone who says yes.

**Hours 24–48 (VOX builds, human reviews).** Build the thing. Deliver early if
you can; 48 hours promised means 36 hours delivered is a story they'll tell
someone else.

**Hours 48–56 (human).** One follow-up to non-responders. Once.

**Hours 56–72.** Deliver, invoice, verify the payment, record it. If a second
prospect is warm, start theirs.

Run #2 and #3 in parallel from hour 10 — they cost nothing extra and the local
post plus the cold audit list only need the free audit you already have.

### What realistically happens in 24 hours

Messages sent and audits delivered. **Probably not money.** Realistically: a
handful of replies, one or two interested, possibly one agreement. A payment
inside 24 hours needs a warm contact with an urgent problem and a payment link
already live — possible, perhaps 10–15%, and not the thing to plan around.

The honest 24-hour success criterion is **30+ sends and 3+ real conversations**,
because those are the inputs you control. If 24 hours produces zero replies, the
list or the message is wrong — not the offer.

### What realistically happens in 72 hours

**Best case:** one customer, $250–750 collected and recorded, one delivered
automation, a reference and a testimonial — which is worth more than the money,
because rows 3 and 5 become materially easier the moment one exists.

**Likely case:** 1–3 agreements, one in delivery, payment landing day 4–6.
Stripe takes ~2 business days to settle, so *earned* and *verified* may fall on
different sides of the deadline.

**Plausible case:** 30–60 sends, several conversations, nobody buys this week.
That is not failure — it is the first real response-rate data this system has
ever had, and it replaces a `MODEL_SUGGESTED` guess with something measured.

**My honest estimate: 35–45% chance of a verified dollar inside 72 hours**,
conditional on 30+ personal messages actually being sent. That estimate is
judgement, not measurement. It rests entirely on one unverified assumption —
that the warm list exists. **If you cannot write 20 names, re-rank: #2 and #5
become #1, and the probability drops to roughly 20–25%.**

---

## What gets recorded, and how honestly

| state | meaning |
|---|---|
| `NO_RESPONSE` | Sent, nothing back. **Not a failure state** — the most common outcome of real outreach, and the default. |
| `REPLIED` / `INTERESTED` | They answered. Not money. |
| `AGREED` | They said yes. **Still not money.** |
| `PAID` | A human verified a payment at a processor and recorded its reference. |

`PAID` cannot be set as a status. It requires `POST .../payment` with both the
processor and the transaction reference, and the service refuses it as a plain
status update — so revenue cannot be marked without something checkable behind
it.

The ledger row is `USER_RECORDED`, never `REALIZED`. `REALIZED` means VOX
confirmed it against an external system of record; a person reading Stripe and
typing the result is a human assertion, and promoting it would be exactly the
provenance laundering the figure layer exists to prevent. `REALIZED` stays
unreachable until a payment integration reads the charge itself. See
`ECONOMIC_INVARIANTS.md#i1` and `#i25`.

And `verifiedRevenueCents` is **null** until something is paid — not `$0.00`.
A sprint dashboard showing a zero on day one reads as a result rather than an
absence.

---

## Assets

| file | what it is |
|---|---|
| `assets/revenue-sprint/01-warm-outreach-messages.md` | Five message templates, the rules that matter more than the wording, and how to record each send |
| `assets/revenue-sprint/02-audit-template.md` | The free audit — the asset that converts a maybe — and why every line must be checked |
| `assets/revenue-sprint/03-offer-and-fulfillment.md` | The offer sentence, price bands, what to build, the scope note, payment setup |

Load the ranked candidates into your own account:

```
npm run seed:sprint -- you@example.com
```

Opt-in and separate from `prisma/seed.ts`, which ships no fixture data about the
user — an operating system that invented opportunities you never considered
would be telling you about a business you do not have.
