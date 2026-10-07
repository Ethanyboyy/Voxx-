# Warm outreach — messages to send yourself

**You send these. VOX does not and will not.** Nothing in this repository can
contact anybody; there is no send path and no email credential. Copy, edit so it
sounds like you, send one at a time.

Three rules that matter more than the wording:

1. **Send individually.** No BCC, no mail-merge. One person, one message, and
   one detail in it that could only be about them. A warm message that reads as
   a blast converts worse than a cold one that reads as personal.
2. **Change the words.** These are structurally right and tonally generic. If a
   sentence does not sound like you saying it out loud, rewrite it.
3. **Do not pitch in message one to people who do not already know you.** The
   ask in the first message is an answer, not a sale.

---

## A — Someone you know who runs a business

> Hey [name] — random one. I've been building automation stuff with AI and I'm
> trying to get two real projects done this week to have something to point at.
>
> Is there one thing in [business] that still eats your time every week?
> Chasing invoices, re-typing bookings, answering the same questions over and
> over — that kind of thing.
>
> If there is, I'd like to fix one of them for you in 48 hours. $450 flat, and
> if it isn't working you don't pay. I'll write up what I'd do first so you can
> see it before you decide anything.
>
> No worries at all if not — just thought I'd ask.

**Why it works:** gives a real reason you're asking (you need the portfolio,
which is true), asks a question instead of pitching, names a price so they don't
have to ask, and removes the risk entirely. The "no worries if not" is not
weakness — it is what makes it answerable without awkwardness.

---

## B — Someone you know who works at a business but doesn't own it

> Hey [name] — do you know who'd handle it if something at [company] needed
> automating? Like if the invoicing or the booking admin is still manual.
>
> I'm doing a couple of these in 48 hours each this week and I'd rather work
> with someone connected to a person I actually know.

**Why it works:** asks for a referral, not a decision. People who can't buy are
glad to be useful, and an internal introduction beats any cold channel.

---

## C — Follow-up, 48 hours later, once each

> Hey [name], no pressure at all on this — just closing the loop so it's not
> sitting in your inbox. Still happy to do it this week if useful, otherwise
> I'll leave you be.

**Once.** One follow-up is diligence; two is pressure, and these are people you
have a relationship with that is worth more than $450.

---

## D — Someone said "maybe, what exactly would you do?"

Do not answer in prose. **Send the audit** (`02-audit-template.md`), filled in
for them, within a few hours. A written thing with their business's name on it
is what converts a maybe.

---

## E — Local community post

Not a message — a post. Specific beats broad every time.

> **Fixing one annoying business admin thing, free-to-cheap, this week**
>
> I build automations (invoicing, bookings, follow-ups, spreadsheets that have
> become a second job). I'm doing a few locally this week to build up examples.
>
> $150–250 depending on the thing, same day where I can, and you don't pay if
> it doesn't work. Happy to just tell you how to do it yourself if that's
> faster — genuinely fine either way.
>
> [your name], [neighbourhood]

Check the group's rules before posting. Many ban promotion outright, and getting
removed on day one costs you the channel for the whole sprint.

---

## Recording what happens

After each send:

```
POST /api/revenue/outreach
{ "prospect": "Dana Whitfield", "organization": "Whitfield Plumbing",
  "channel": "WARM_PERSONAL", "offer": "48h invoice automation, $450 flat",
  "askedPriceCents": 45000 }
```

When they answer: `POST /api/revenue/outreach/{id}/response` with `REPLIED`,
`INTERESTED`, `AGREED`, `DECLINED` or `DISQUALIFIED`.

`AGREED` is not money. Only `/payment` — with the processor and the transaction
reference — books revenue, and it books it as `USER_RECORDED`, because you
verified it and VOX didn't.
