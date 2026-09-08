# Version 27 Preregistration: Reconstructible History Bank

Version 27 repeats version 26 in full. The sealed Yukon release, 14 commits,
two non-overlapping windows, verifier tree, expected scores, reference, and all
headroom thresholds are unchanged. Version 26 is excluded because its
starting-artifact importer could not reach custom refs in an otherwise valid
Git bundle.

The only apparatus changes are:

1. initialize a fresh repository and fetch
   `refs/dungeness-history/<event>` with an explicit same-name refspec;
2. assert that the fetched ref equals the clean-verified commit before archive
   extraction;
3. regression-test custom-ref restoration; and
4. include the history-bank builder version and source SHA-256 in every event
   and in the content-addressed bank identity.

All 14 candidates must be reverified. Prior v26 scores cannot be copied into
the new bank. After publication, materialize the two starts under namespace
`users/bx/v27`, verify their payload hashes, export both windows, and compile
R0/R1/R2 twice. Any score, bundle, reconstruction, parity, cutoff, or context
failure stops v27. Treatment and model spending remain unauthorized.
