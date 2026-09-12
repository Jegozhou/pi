# Amazon Seller Agent V1.0 Evaluation Fixtures

These files are synthetic test data created only for deterministic V1.0 acceptance testing. They contain no seller credentials, private business data, Amazon account tokens, or real account identifiers.

## Files

- `search-term-report.csv` — three Sponsored Products search-term scenarios:
  - high-ACOS converting term (`trail running shoes`);
  - zero-sales waste term (`free trail shoes`);
  - efficient discovery term (`waterproof trail shoes`) that qualifies for exact-migration and scale findings.
- `profitability.csv` — one ASIN whose supplied known variable costs exceed gross sales, producing negative known contribution profit.
- `target-snapshot.csv` — deterministic campaign/ad-group/target identities and current bids used to resolve execution scope.

## Expected V1.0 path

With seller target ACOS `0.30` and action-plan limit `3`, the stable top actions are expected to be:

1. profitability review for `B000NEG`;
2. negative-exact candidate for `free trail shoes`;
3. bid-down candidate for `trail running shoes`.

After target enrichment and the default bid policy, the bid-down proposal should move from `$1.20` to `$0.96` because the proportional raw bid is lower than the default 20% single-step decrease guardrail permits.

The final approved dry run should contain exactly two Amazon mutation plans (`add-negative-exact` and `set-bid`), skip the profitability review as analytical work, and keep `writesPerformed: false`.
