# Amazon Seller Agent V0.7 — Change Set Enrichment / Resolver

## Goal

Turn V0.6 blocked PPC proposals into increasingly execution-ready proposals by joining diagnosis context with a second Amazon Ads target snapshot. V0.7 resolves account object identity and current state only. It does **not** call Amazon APIs and does **not** invent proposed bid values.

## Why this slice exists

A Search Term report is enough to decide that a search term or source target needs attention, but it is not sufficient to safely mutate an Amazon Ads account. Execution needs durable object identity such as campaign/ad-group/target IDs and, for bid changes, the current bid.

V0.7 therefore introduces an explicit resolver layer:

`Search Term diagnosis -> Action Plan -> Change Set -> Target Snapshot Resolver -> enriched Change Set`

## Scope

### 1. Preserve PPC source context

Every PPC Finding produced from a normalized Search Term row should retain optional source context:

- campaignName
- adGroupName
- targeting
- matchType

The Action Plan must preserve this context. Existing callers/tests that construct findings manually remain compatible by keeping context optional in public types.

### 2. Target snapshot input

Add a deterministic CSV/TSV parser for an Amazon Ads target snapshot with aliases for common export labels:

- campaign name
- campaign ID
- ad group name
- ad group ID
- targeting / keyword / target expression
- match type
- target ID
- bid
- state

Required minimum fields for a usable row:

- campaign name + campaign ID
- ad group name + ad group ID

Target ID and bid may be absent because negative creation can still become ready with campaign/ad-group identity while bid updates cannot.

Numeric parsing is fail-closed: invalid bids become `null` plus warnings, never `0`.

### 3. Deterministic matching

Match a PPC action to snapshot rows in descending specificity:

1. campaignName + adGroupName + targeting (+ matchType when present)
2. campaignName + adGroupName for operations that create a new negative target

A match must be unique. Zero or multiple matches do not guess.

### 4. Proposal enrichment rules

#### `add-negative-exact`

When campaign/ad-group identity is uniquely resolved:

- readiness -> `ready`
- before -> resolved campaign/ad-group identity plus source search term
- after -> exact negative search term under the resolved ad group
- missingInputs -> []

No Amazon call is made.

#### `set-bid`

When target identity and current bid are uniquely resolved:

- before -> campaignId, adGroupId, targetId, currentBid
- keep readiness `blocked`
- remove resolved missing inputs
- keep `proposed bid` missing

V0.7 deliberately does not choose the new bid.

#### `create-exact-target`

Source context can be resolved for evidence, but destination campaign/ad-group and proposed bid are still seller policy decisions. Keep blocked.

#### `scale`

Resolve source target/current value when possible, but keep blocked until V0.8 defines an explicit scale mechanism and proposed value.

#### `review-profitability`

Leave `review-only` unchanged.

### 5. Immutability and lifecycle

`enrichSellerChangeSet()` returns a new Change Set:

- source object is not mutated
- only `draft` Change Sets may be enriched
- version increments by 1
- status remains `draft`
- decision remains null

Approved/rejected/awaiting-approval Change Sets cannot be silently rewritten after review.

### 6. Diagnostics

Return resolver diagnostics containing:

- resolved proposal IDs
- unresolved proposal IDs
- ambiguous proposal IDs
- snapshot parser warnings

No resolver failure should silently convert a proposal to ready.

### 7. Pi tool

Add a read-only tool:

`amazon_enrich_change_set`

Inputs:

- PPC Search Term report path
- target snapshot path
- optional profitability report path
- optional seller target ACOS / contribution margin
- optional action limit

The tool runs the existing deterministic pipeline and returns:

- Action Plan
- draft Change Set
- enriched Change Set
- resolver diagnostics

It does not accept credentials and does not access Amazon.

## TDD acceptance cases

1. parser accepts CSV and TSV target snapshots
2. IDs remain strings
3. invalid bid produces warning and null
4. PPC findings preserve campaign/ad-group/targeting context
5. negative-exact proposal becomes ready after one unique campaign/ad-group match
6. bid-down proposal receives targetId/currentBid but remains blocked on proposed bid
7. no match stays blocked
8. ambiguous match stays blocked and reports ambiguity
9. enrichment is immutable and increments version
10. non-draft Change Set enrichment is rejected
11. profitability review-only proposal is unchanged
12. Pi Skill references the enrichment tool and still forbids execution claims

## Explicit non-goals

- No Amazon Ads API credentials
- No API writes
- No bid formula in V0.7
- No destination campaign selection for exact migration
- No automatic execution after approval
- No mutation of previously approved Change Sets
