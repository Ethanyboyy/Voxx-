# The offer, the price, and how to actually deliver it

## The offer, in one sentence

**One bounded automation, built and working in 48 hours, $450 flat, refunded if
it doesn't work.**

Everything about that sentence is load-bearing:

| element | why |
|---|---|
| **One** | Scope creep is the only way a $450 job becomes a $0/hour job. One thing, named in writing, before any money. |
| **Bounded** | You write down what "done" means before you start. Without it there is no moment at which you get paid. |
| **48 hours** | The reason they say yes now. Every alternative they've considered was a three-month software project. |
| **$450 flat** | One person can approve it without asking anyone. Hourly invites negotiation about your speed, which you will lose, because AI makes you fast. |
| **Refunded** | Removes the entire downside for someone buying from a person with no track record. You will refund roughly nobody. |

**Price bands:** $250–300 for a warm contact or a very small job (take the
lower number; the first customer is worth more than the margin). $450 standard.
$750 where the business is clearly bigger and the problem is clearly expensive.
Below $150 it is not worth the hours; above $1,000 it stops being one person's
decision and the 72-hour window closes.

---

## What to actually build

Pick from things that are genuinely finishable in two days:

- **Invoice chasing** — overdue invoices detected, polite reminders drafted and
  scheduled. Usually the highest-value and the easiest to prove.
- **Booking intake** — form → calendar → confirmation, instead of phone tag.
- **The ten repeated questions** — a page or auto-reply answering what they
  type out daily.
- **Lead follow-up** — enquiries that went cold get a scheduled touch.
- **A spreadsheet that became a job** — automated, or just restructured so it
  stops needing a human.

Do not accept: anything needing access to their payment system, anything
touching payroll or customer PII you'd have to store, anything requiring a
vendor account they don't already have. Those are 48-hour jobs that become
two-week jobs.

---

## Scope note — send before taking money

> **[Business] — invoice reminders**
>
> What I'm building: when an invoice goes 7 days past due, you get a drafted
> reminder email ready to send, and a weekly list of what's outstanding.
>
> What it does not do: it does not send anything without you clicking, and it
> does not touch your accounting system's records.
>
> Done means: you get the first weekly list and at least one working reminder
> draft, by [date, time].
>
> $450, payable on delivery. If it isn't doing the above, you don't pay.
>
> Anything you'd change before I start?

That last question is the one that saves you. Scope disagreements surface for
free before the work and expensively after it.

---

## Getting paid

Set this up **before** you send a single message, because the worst outcome in
a 72-hour sprint is somebody saying yes on day two and you spending day three
figuring out how to accept $450.

- **Stripe Payment Link** — best default. One link, works everywhere, lands in
  ~2 business days. Create it at a fixed $450 so you can reuse it.
- **PayPal invoice** — fastest to set up if you already have an account.
- **Zelle / bank transfer / cash** — for local and warm contacts. Instant and
  free, which for a first customer beats everything else.

Take payment **on delivery**, not up front, for warm contacts — asking a friend
for money before you've done anything adds friction exactly where you can least
afford it. For cold customers, 50% up front is reasonable and filters out
people who were never going to pay.

**You create these accounts yourself.** VOX cannot and must not open payment
accounts, and nothing here will.

---

## When the money lands

Go and look at the processor. Then:

```
POST /api/revenue/outreach/{attemptId}/payment
{ "assetId": "<your EconomicAsset>", "amountCents": 45000,
  "processor": "stripe", "reference": "ch_3Q…" }
```

Both `processor` and `reference` are required — the row is worthless without
something a third party could check. It books an `EconomicRevenue` at
`USER_RECORDED`: **you** verified it against the processor, VOX did not. That
distinction is not pedantry, it is the difference between a ledger that means
something and one that records whatever its owner was feeling.

That is the first dollar. It is real, it is checkable, and nothing in this
repository claimed it before it existed.
