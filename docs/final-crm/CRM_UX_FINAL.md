# CRM experience

Recorded 2026-09-03 at `691f10a`.

## The index is a queue

It listed name, company, status and source for whatever 250 customers came back
first. It now shows current need, lifecycle, status, score, next action with its
priority, owner and last activity — a page at a time, keyset-paged on the
customer's own `(updated_at, id)` rather than an offset that shifts under anyone
editing a record while somebody else pages through.

Seven views, in two kinds, and keeping them apart is the design. Qualified,
Sales-ready, Customers and Recently Active are column equality and run in SQL.
Needs Attention and Follow-up Due are questions about the attention verdict,
whose rules live in TypeScript — so they filter the ranked row and the read
continues when a page comes back short. The alternative fails silently: a
contact in the Needs Attention list whose own record calls them Normal.

Three limits worth stating. Ordering stays by recency inside every view, because
ordering globally by priority would put the ranking back in SQL; the priority is
on every row instead. The Owner column says You, A teammate or Unassigned, since
nothing here can turn a user id into a name — the member directory is Pack 02.
And the export button says Export search, because it exports what the search and
status controls select and the two attention views are decided by a ranking the
export path does not have.

## The record is a record

It listed every column of every table it could reach, twelve key/value pairs at
a time. That dump is now what the Audit section does, where a raw trace is the
point.

The Now card renders every field the same way — a value with what backs it, or
_Unknown / needs confirmation_ — and no branch in it can omit a field it has no
value for. Data confidence is the weakest confidence among the card's remembered
values, not an average: one guess in a card read as a single claim makes the
whole thing a guess. Whether anything is late is read off the attention verdict
rather than recomputed, so the due state and the priority chip beside it cannot
disagree. Evidence becomes a link only where a route exists; a score snapshot
has no page yet, so the card names the reference instead of offering a link that
goes nowhere.

The timeline merges the ten tables that recorded what happened, and every event
says whether it is routine. The default view collapses the routine rather than
dropping it, because the machinery is exactly what somebody debugging a bad
reply needs. A score recomputation that moved nothing is machinery by that test;
a score that changed is history.

## Priority, not a number

`Critical | High | Normal | Low` plus reason chips, and no 0–100. The
combination rule is where that could have been quietly broken — weighting
signals and thresholding the sum would rebuild the forbidden number behind four
labels — so the priority is the highest level any single signal argues for,
lowered to the strictest cap in force. Penalties cap rather than subtract. An
explicit request for a person is never capped: every penalty is a reason not to
_send_, and that is a request to _look_.

## Suggestions

They sit beside the Now card rather than behind a tab, because a suggestion
waiting on a person is how it stays waiting. Accepting settles the row and
performs nothing: the CRM proposes, and the domain that owns the send executes.
A rejection is kept, because a pattern of bad suggestions is only visible if the
bad ones survive.

## Three languages, and the honest limits

The record's own vocabularies — lifecycle, status, action, timeline kind — exist
in `en`, `tr` and `fa`, and `fa` renders RTL throughout with logical properties
rather than left/right. Two things are shown as written rather than translated:
the stored English summaries on activity rows, because machine-translating them
would put a claim in somebody's mouth; and an outbound message's actor is _this
workspace_, not a person, because `messages` records that it went out from here
and not who wrote it.

## Verified at this SHA

54 visual cells across locale, theme and viewport, with no horizontal overflow,
correct direction and theme resolution in every one, exactly one `h1`, and no
unlabelled control. Details in `CRM_VISUAL_EVIDENCE.md`; human review still
outstanding.
