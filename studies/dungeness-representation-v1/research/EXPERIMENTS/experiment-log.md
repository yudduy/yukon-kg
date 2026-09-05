# Experiment Log

## E-1: Version-22 single-session seed gate
- **Date**: 2026-08-27
- **Conjecture**: Predecessor to C-1
- **Gate**: RUN
- **Hypothesis**: A repaired Kimi seed session will record at least four valid candidates.
- **Method**: Run h2-v2 from the untouched Z-order checkpoint under the frozen $6, 400,000-token, eight-evaluation cap and apply the model-free convergence checker.
- **Result**: Two requests, 11,204 tokens, $0.034643, zero evaluations, unchanged outer-scored candidate; `STUDY_STOP` decision `f0cde535…803e0`.
- **Analysis**: The evaluator path worked, but the sampling unit did not reliably generate history.
- **Decision**: PIVOT

## E-2: Seed-campaign state machine
- **Date**: 2026-08-27
- **Conjecture**: C-1
- **Gate**: PASS (model-free implementation)
- **Hypothesis**: Multiple fresh sessions with an authored aggregate cap and mandatory clean handoff can totalize no-evaluation sessions while retaining only valid canonical events.
- **Method**: Implement and test model-free campaign scheduling, lineage, budgets, and deterministic finalization before any paid run.
- **Result**: Implemented a six-session maximum campaign with one shared $6 / 400,000-token / 3,600-second / eight-evaluation cap. Each fresh session is capped at $1 / 100,000 tokens / 600 seconds / two evaluations; the final slice is reduced to the exact remaining allowance. The campaign retains the best clean-verified candidate across sessions, so a later regression cannot become the handoff. Python tests cover zero-event preservation, aggregate eligibility, no-view/no-resume inputs, best-candidate handoff, and cap exhaustion. Yukon tests cover deterministic compilation of multiple hashed exports while retaining zero-event sources. Focused suites pass: 26 Python tests and 14 Bun tests.
- **Analysis**: Orchestration now decides whether a seed is eligible; no single agent session is trusted to satisfy the history requirement. Zero-event sessions consume time/cost and remain in the campaign source manifest but add no invented atom.
- **Decision**: KEEP

## E-3: External convergence review availability
- **Date**: 2026-08-27
- **Conjecture**: C-1
- **Gate**: REFINE
- **Hypothesis**: An independent model will identify hidden bias before the first paid campaign.
- **Method**: Attempt the available AlphaXiv, Gemini, and Claude routes without bypassing the Dungeness study ledger.
- **Result**: AlphaXiv fetch failed; Gemini reported an unsupported/ineligible authenticated client; Claude was not logged in. No unmetered OpenRouter substitute was used.
- **Analysis**: External agreement is unavailable, not favorable. The design therefore requires a stronger internal adversarial gate and an exact-route canary before treatment.
- **Decision**: DIG DEEPER

## E-4: GPT exact-route canary, first reservation
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: PIVOT (zero-cost local rejection)
- **Hypothesis**: A 40,000-token, $0.50 canary is enough to reach the pinned GPT-5.6 Sol OpenRouter endpoint and execute one tool call.
- **Method**: Run the full Codex/Harbor/gateway path on `agent_tool_routing` with one development-evaluation allowance.
- **Result**: Dungeness rejected the first request before contacting OpenRouter because the token cap could not fund the conservative request-byte-plus-16,384-token input reservation. The terminal record is failed with zero model requests, zero model tokens, zero provider billing, and zero normalized spend. Harbor surfaced the local 429 as `ApiRateLimitError`, but the trusted gateway event identifies `model token budget cannot fund the conservative input reservation`.
- **Analysis**: This is not a provider outage or a model result. The canary underfunded the installed Codex envelope, and the same 70,000-token slice could make seed campaigns fail locally. A previously proven 100,000-token/$1 envelope fits this path while the campaign's 400,000-token/$6 aggregate cap remains unchanged.
- **Decision**: PIVOT
- **Next test**: Refreeze the 100,000-token session/canary envelope and require one upstream request plus one schema-valid tool call before any seed campaign.

## E-5: GPT exact-route canary, upstream path
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: REFINE
- **Hypothesis**: A 100,000-token, $1 reservation permits the pinned GPT endpoint to execute an official evaluation and finish cleanly.
- **Method**: Repeat the full route canary with a fresh run ID and the version-2 frozen apparatus.
- **Result**: The run made two successful upstream GPT requests, used 13,693 reported model tokens, executed two schema-valid shell calls, and submitted one official development evaluation at 3.245930 seconds. It then stopped before a third request because the remaining $0.839485 normalized allowance could not fund the conservative enlarged-context reservation. Harbor reported the local 429 as `ApiRateLimitError`; exact normalized spend was $0.160515 and provider billing was $0.035705.
- **Analysis**: Provider routing and function execution are now empirically proven. The $1 value was still an undersized reservation envelope: the agent spent both requests inspecting and measuring the baseline, then was denied before its first modification. External bundles also lacked the native runtime's `budget-stop` and `candidate-state` utilities, so the trusted local stop could not be normalized. This would bias producer histories toward baseline-only events.
- **Decision**: REFINE
- **Next test**: Mount the two recovery utilities into external main containers, make `evaluate` preserve the best valid snapshot mechanically, use a $3 per-session reservation under the unchanged $6 aggregate campaign cap, and require a clean terminal canary.

## E-6: GPT exact-route canary, clean recovery
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: PASS
- **Hypothesis**: A $3 / 100,000-token session envelope can reach an optimization attempt and convert a trusted local cap stop into a clean verified terminal result.
- **Method**: Run the full pinned GPT/OpenRouter/Harbor path after mounting `budget-stop` and `candidate-state` in the external main container and mechanically retaining the best valid development candidate.
- **Result**: `krv23-route-canary-gpt-v3` completed after four real model requests and 17,476 model tokens. It executed multiple schema-valid shell calls, recorded an official development score of 3.298199 seconds, restored the best snapshot when a fifth request hit the local token reservation, and clean-verified at 3.276720 seconds. Exact normalized cost was $0.225382; provider-reported billing was $0.048420.
- **Analysis**: The route, tool protocol, development evaluator, trusted local-stop handoff, best-candidate recovery, and clean verifier now work together. The canary is apparatus evidence, not a seed history or treatment observation.
- **Decision**: KEEP
- **Next test**: Audit task measurement stability, then freeze the first campaign only if its target effect is resolvable.

## E-7: Noisy-task replacement
- **Date**: 2026-08-27
- **Conjecture**: C-1
- **Gate**: PIVOT before scientific execution
- **Hypothesis**: `agent_tool_routing` can resolve a 0.25 meaningful-gain-unit effect with one outer verification per milestone.
- **Method**: Compare all unchanged-checkpoint clean measurements made by the current and prior full Harbor apparatus, then run two current-runtime no-model smokes on the pre-existing deterministic reserve replacement.
- **Result**: Unchanged Agent Tool Routing scores spanned 3.240754–3.334545 seconds. Against its 3.85-to-0.4 official gap, the 0.093791-second spread equals 0.272 meaningful-gain units and exceeds the 0.25 target effect. `adversarial_splay` smokes `krv23-smoke-splay-1` and `-2` both returned exactly 48,656 rotations, correctness true, zero exceptions, zero model tokens, and $0 spend; the frozen baseline content hash is `fa9d8ede…f1db` and verifier tree hash is `44efd2d6…142`.
- **Analysis**: The timing task cannot support the intended decision at the planned verification rate. The exact-counter replacement removes that avoidable variance without seeing a treatment result; no seed history or R0/R1/R2 call had started.
- **Decision**: Replace both Agent Tool Routing producer blocks with Adversarial Splay and bind the campaign start to the repeated 48,656 score.
- **Next test**: Run the full model-free suite, freeze version 4 hashes, and launch the first Splay/GPT seed campaign.

## E-8: Kimi route qualification
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: PIVOT before seed acceptance
- **Hypothesis**: One exact, no-fallback Kimi K3 OpenRouter route can reliably produce the second history for each task.
- **Method**: Test three successively frozen endpoints with bounded full-stack canaries; retain every attempt and charge all usage to the atomic study ledger.
- **Result**: Together became unavailable. The official Moonshot route made two successful responses and tool calls, then returned a provider 429 while budget remained. Parasail made 11 responses and 85,827 tokens without a provider error, but the session exceeded the authored 600-second task cap and Parasail subsequently became unavailable. The three attempts cost $0.108599, $0.139654, and $0.408949, respectively. None produced an eligible history; no treatment ran.
- **Analysis**: These failures identify provider availability and timeout propagation, not a representation effect. Substituting endpoints after histories begin would confound producer identity with route state.
- **Decision**: Freeze two independent GPT campaigns per task for seed generation. Kimi remains a conditional replication model only after a stable exact route passes a new freeze.
- **Next test**: Repair external timeout propagation and ensure an inactive route cannot block the active GPT route.

## E-9: External timeout and active-route isolation
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: PASS
- **Hypothesis**: The authored agent timeout can bind external Harbor tasks, and live validation can fail closed for the requested model without validating unrelated routes.
- **Method**: Propagate `agent_timeout_sec` into the generated Harbor task and gateway wall-clock cap, run a 37-second no-model Splay smoke, add model-scoped policy validation, then rerun all model-free suites and the live GPT catalog check.
- **Result**: The smoke rendered both caps as 37 seconds and retained the expected 48,656 score. Dungeness passed 161 tests, gateway 77, and Yukon 113 with two historical diagnostics skipped; public-data verification and the live exact GPT endpoint check passed. The unchanged Mouselab exact-oracle test takes about 6.5 seconds and requires Bun's 30-second runner timeout rather than its 5-second default.
- **Analysis**: Runtime caps now match authored controls. The active GPT route is validated independently, while any future Kimi request must validate its own frozen endpoint.
- **Decision**: KEEP. Freeze the two-GPT-history design and proceed to the first bounded seed campaign.
- **Next test**: Launch only adversarial-splay/GPT-A and apply the frozen convergence gate before starting another campaign.

## E-10: Exact final-candidate binding
- **Date**: 2026-08-27
- **Conjecture**: apparatus qualification
- **Gate**: PIVOT v23; PASS v24 repair
- **Hypothesis**: Every clean external verifier result is retained with the exact candidate bytes it scored.
- **Method**: Launch the first frozen v23 Splay/GPT-A campaign, inspect the failed finalization, repair the verifier bridge, and repeat the full path with Harbor's no-model agent before admitting any scientific run.
- **Result**: The paid session used 56,993 actual tokens and `$1.008114`, recorded one official 48,656 baseline evaluation, and Harbor returned clean 48,656, but `dungeness-final-candidate` was absent. Dungeness marked the run failed. The wrapper audit showed candidate capture ran only for tasks needing nullable-reward normalization. The repaired wrapper always copies the candidate before running the untouched verifier. Smoke `krv24-smoke-final-candidate-splay` retained the exact 16,151-byte baseline at SHA-256 `abdee5a83d47af1ac23b51f3e71b50635da6ab49ad85a484e5b012b95250a2a0` and clean-verified 48,656 with zero model use. Full 161/77/113 tests, public data, and the live GPT route pass.
- **Analysis**: Equality of scores cannot substitute for artifact identity. Because the bug changes provenance guarantees, v23 cannot resume with repaired sessions.
- **Decision**: Terminally classify the v23 campaign as an apparatus failure with no admitted scientific evidence. Supersede it with v24 and new campaign identities; preserve cumulative spend.
- **Next test**: Freeze v24 and retry only Splay/GPT-A.

## E-11: First dense campaign and renderer-context stop
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: PIVOT before scientific acceptance
- **Hypothesis**: The repaired multi-session producer can generate an eligible history that compiles under the frozen 32,000-token view limit.
- **Method**: Run only v24 Splay/GPT-A under the shared `$6`, 400,000-token, 3,600-second, eight-evaluation cap; clean-reverify every handoff and finalize only after the density gate.
- **Result**: Five sessions used 248,794 tokens and `$4.156310`, recording four valid evaluations, two candidates, and two scores. The 67,008 selected candidate clean-reverified, but renderer v2 rejected R2 at 32,022 tokens. No convergence decision or treatment followed. Renderer v3 changes only static index prose; the excluded manifest compiles model-free at 31,287/31,718/31,985 total tokens with byte-identical atoms. The selected score equals the frozen Splay reference, so a diagnostic headroom calculation is zero.
- **Analysis**: Capture and handoff now work, but the campaign is inadmissible because context fit was frozen. Splay would also fail the intended headroom role. Neither fact estimates R0, R1, or R2.
- **Decision**: PIVOT. Exclude v24 completely, freeze renderer v3, validate native task references, and replace Splay with the pre-treatment ECDSA task for fresh v25 histories.
- **Next test**: Pass full v25 model-free gates, freeze hashes, then launch only ECDSA/GPT-A on the qualified Colima profile.

## E-12: Version-25 apparatus qualification
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: PASS (model-free)
- **Hypothesis**: Native ECDSA initialization, clean verification, renderer v3, the exact GPT route, and all isolation/provenance controls pass before another paid producer campaign.
- **Method**: Run a full no-model Harbor smoke on rootful Colima, execute every Dungeness/gateway/Yukon/public-data gate, validate the exact live OpenRouter model policy, then hash every v25 source and qualifying evidence file.
- **Result**: The smoke clean-verified `10,758,874,395` from candidate `63ba1a24…8730`; verifier tree `c058ae1c…09a6` and score artifact `10081048…f4ce` are retained. It used zero model requests and `$0`. An initial wrong-Docker-host attempt was cancelled before model use and remains excluded. The complete suites pass 162 core, 77 gateway, and 113 Yukon tests with two historical skips; public data and live GPT validation pass. Freeze `41fe7ae5…ada6` validates 33 files with zero mismatch.
- **Analysis**: The paid unit can now test history production rather than unresolved native-reference or context machinery. This admits no scientific observation and leaves treatment disabled.
- **Decision**: KEEP. Authorize only `ecdsa-gpt-history-a` under the frozen shared `$6` campaign cap.
- **Next test**: Run the campaign, preserve every session, clean-reverify its best candidate, and obey the frozen convergence outcome before spending on another campaign.

## E-13: ECDSA/GPT-A history production
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: FAIL (task informativeness)
- **Hypothesis**: Six fresh no-view GPT sessions can produce an ECDSA history with at least four valid evaluations, two candidates, two scores, positive progress, and one remaining meaningful gain.
- **Method**: Run only frozen block `ecdsa-gpt-history-a` under one shared `$6`, 400,000-token, 3,600-second, eight-evaluation cap, clean-reverifying each selected development candidate before handoff.
- **Result**: Six sessions recorded seven valid events and all clean reverifications passed. Every event retained candidate `63ba1a24…8730` at `10,758,874,395`; distinct candidates = 1, distinct scores = 1, positive progress = false. Usage was 243,739 model tokens, 1,168 agent seconds, and `$2.864841`. Campaign `seed-c537a35cfc4476610` ended `exhausted` on the session cap with no active ledger reservation.
- **Analysis**: The apparatus measured valid outcomes but the sampling process repeatedly re-established the baseline rather than generating interventions. The object required for the representation experiment—a progress-bearing research history—does not exist in this block.
- **Decision**: Reject the history and admit no treatment evidence. Continue to ECDSA/GPT-B unchanged; the frozen four-of-first-five rule allows one failure but not two.
- **Next test**: Run only `ecdsa-gpt-history-b`. Stop v25 immediately if it fails eligibility.

## E-14: ECDSA/GPT-B history production and v25 stop
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: STUDY_STOP before treatment
- **Hypothesis**: The independent frozen GPT-B campaign can produce an ECDSA history with at least four valid evaluations, two candidates, two scores, positive progress, and one remaining meaningful gain.
- **Method**: Run only frozen block `ecdsa-gpt-history-b` under the unchanged shared campaign cap, clean-reverify every selected handoff, then apply the preregistered four-of-first-five qualification rule.
- **Result**: Six fresh sessions recorded six valid events. Every event retained candidate `63ba1a24…8730` at `10,758,874,395`; distinct candidates = 1, distinct scores = 1, positive progress = false. Usage was 245,533 model tokens, 848 agent seconds, and `$2.892127`. Across GPT-A and GPT-B, 12 sessions produced 13 repeated-baseline events for `$5.756968`. The atomic ledger now commits `$25.227542` with no active reservation.
- **Analysis**: The prompt requires a baseline evaluation before intervention, the candidate is about 388 kilobytes, and one verification commonly consumes tens of seconds. Trajectories show agents inspecting or editing after the baseline but ending before a second evaluation. The repeated failure is caused by the producer sampling unit; it does not estimate any R0/R1/R2 effect.
- **Decision**: Apply the frozen stop because two failures leave at most three passes among the first five. Do not launch Toy ISA, VLIW, or treatment under v25. Admit zero scientific observations.
- **Next test**: Design and freeze a precursor around exogenous, clean-verified history banks so history availability is established before treatment randomization.

## E-15: Executable ECDSA history-source probe
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: PASS for source feasibility; treatment remains locked
- **Hypothesis**: Commit IDs in Yukon's sealed 54-event calibration cohort identify source artifacts whose scores are reproducible under Dungeness's qualified clean verifier.
- **Method**: Resolve Yukon's primary repository declaration, fetch every named commit, then run only the final cohort commit through the offline verifier snapshot already qualified by v25. Make no model request and admit no treatment observation.
- **Result**: All 54/54 commit objects were present. Commit `787eaa82f257aaee6c16bc08575ddfcfbbedd666` clean-verified at 925,387 average Toffolis and 1,278 peak qubits, for `1,182,644,586`. The sealed Yukon event reports the same score exactly. Model usage and normalized spend were zero.
- **Analysis**: The public cohort is backed by executable artifacts, not only prose. A frozen source bank can therefore replace unreliable seed generation. The single probe establishes compatibility, not the validity of untested events or any representation effect.
- **Decision**: KEEP the exogenous-history direction. Require a local hashed source bundle, exact candidate tree and diff hashes, per-event clean score artifacts, and preselected treatment-compatible windows before v26 can randomize an arm.
- **Next test**: Implement and test the plan-to-history-bank path, freeze the chosen windows, bulk-verify only after the freeze, then apply renderer parity/context gates.

## E-16: Version-26 history-bank qualification
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: FAIL (apparatus) after clean-score pass
- **Hypothesis**: The frozen 14-candidate bank can both reproduce every sealed outcome and reconstruct the two exact starting artifacts through its retained source bundle.
- **Method**: Freeze selection `3958f080…3492`, plan `c0547d90…47ad`, and apparatus `3269db91…bb48`; run all candidates in the qualified offline verifier; publish a hashed Git bundle; export both windows; then materialize their starts before renderer compilation.
- **Result**: All 14/14 scores matched exactly and bank `6f75cedd7b3880678a8ba5573cb44534263c67a2e0f4cd51fdf15dbd9c6c1019` published with bundle hash `2005af01…8a3`. Both window exports succeeded. Materialization of commits `e5c53dc9…2bab` and `8910bd14…11f5` failed with `not a tree object`. `git bundle verify` showed both objects under custom `refs/dungeness-history/*`.
- **Analysis**: `git clone <bundle>` imports ordinary heads/tags but not the custom event namespace. The verified bytes exist, yet the frozen handoff cannot reach them. This is a downstream reconstruction bug; all 14 scores remain apparatus evidence only.
- **Decision**: Exclude v26 before treatment. Version 27 must initialize a repository, fetch the exact custom ref with an explicit refspec, assert the resulting commit, and bind the builder source hash into the bank ID. Repeat the entire qualification unchanged.
- **Next test**: Add the custom-ref regression, pass all suites, freeze v27, and rerun all 14 candidates before materialization or compilation.

## E-17: Version-27 reconstruction pass and context stop
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: FAIL (context) after verification and reconstruction pass
- **Hypothesis**: Explicit custom-ref restoration makes both frozen ECDSA histories reconstructible and mountable under the 32k context limit.
- **Method**: Freeze v27 at `cfef87ec…0581`, independently rerun all 14 candidates, publish a builder-bound bank, reconstruct starts in `users/bx/v27`, then compile both unchanged windows.
- **Result**: All 14 scores matched and bank `650c87fca9e71e956712b97b3a9624d4714aa0a1ae4b899b10d609120cf125ac` published. Both candidate artifacts materialized at their verified tree hashes. Window A compiled with R0/R1/R2 totals 29,931/30,404/30,763 tokens. Window B stopped at R0 with 51,987 tokens. No treatment ran. A schema audit found export v1 maps all historical interventions to an empty list. Backward-compatible export v2 now preserves them; four-event v28 diagnostics produce R2 totals 27,924 and 23,408.
- **Analysis**: Exact diffs make the seven-event window too large. Truncating evidence or lifting the frozen limit would change the treatment. Four direct events retain the preregistered minimum density and more than two meaningful gains of headroom. Carrying recorded interventions is required for condition/intervention grouping and bundled-attribution rules.
- **Decision**: Exclude v27. Version 28 uses two four-event non-overlapping lineages and trusted-export v2, without treatment access. Reverify the reduced plan rather than copying v27 outcomes.
- **Next test**: Freeze and run the 11-candidate v28 bank, then require two deterministic compilations and exact atom parity for both windows.

## E-18: Version-28 executable ECDSA histories
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: PASS (apparatus; no treatment)
- **Hypothesis**: Two four-event ECDSA histories can be independently clean-reproduced, reconstructed, and rendered with recorded interventions inside the frozen context limits.
- **Method**: Freeze v28 at `75c54e60…a65a`; replay 11 candidates in the qualified verifier; materialize both starts under a fresh namespace; export schema v2; compile each window twice; compare every output byte and within-window atom hash.
- **Result**: All 11 scores matched and bank `abb4b1bd…bce32` published. Both candidate artifacts reconstructed. Export v2 retained 8 and 10 interventions. Double compilation was byte-identical. A R0/R1/R2 totals were 27,103/27,597/27,944 tokens; B totals were 22,573/23,068/23,420. All index counts were at most 1,110. Treatment chains and model spend were zero.
- **Analysis**: Both blocks now satisfy source, verifier, candidate, lineage, parity, cutoff, and context requirements. They are eligible histories, not representation observations. A one-task experiment cannot support the intended cross-task claim.
- **Decision**: KEEP both ECDSA blocks. Retain the treatment lock until two additional task families each contribute two independently frozen histories.
- **Next test**: Construct and qualify deterministic Toy ISA and VLIW history banks, then freeze the complete randomized treatment schedule.

## E-19: Version-29 controlled-history timestamp stop
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: FAIL (apparatus; no treatment)
- **Hypothesis**: Frozen Toy ISA and VLIW candidate sequences can reproduce exact scores and compile into canonical histories.
- **Method**: Replay 20 candidates, materialize four starts, export four-event histories, and compile all R0/R1/R2 views.
- **Result**: All 20 scores matched and four starts materialized. All exports stopped because timestamps used `...:00Z` rather than canonical `...:00.000Z`. Model spend and treatment chains were zero.
- **Analysis**: Candidate/score qualification passed, but a noncanonical source record is inadmissible even when its time is unambiguous.
- **Decision**: Exclude v29 and enforce exact timestamp form in the producer.
- **Next test**: Freeze v30 and rerun the entire 20-candidate qualification.

## E-20: Version-30 Toy ISA and VLIW histories
- **Date**: 2026-08-28
- **Conjecture**: C-1
- **Gate**: PASS (apparatus; no treatment)
- **Hypothesis**: Producer-side canonical timestamps make the controlled histories executable and renderer-compatible without changing candidates or outcomes.
- **Method**: Freeze the repaired encoder, replay all 20 candidates, reconstruct four starts, export four histories, and compile each twice.
- **Result**: Scores matched 20/20. Four starts resolved through the production loader. Every export contained four events/interventions; all 12 view compilations were byte-identical across repeats and below 8,010 tokens.
- **Analysis**: The study now has six eligible histories spanning three task families.
- **Decision**: Keep v28 ECDSA plus v30 Toy/VLIW blocks and prepare randomized treatment.
- **Next test**: Materialize opaque first-model chains and run candidate/view smokes before freezing.

## E-21: Version-31 candidate permission boundary
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: FAIL then repaired; v31 excluded
- **Hypothesis**: An immutable candidate artifact can initialize an editable agent workspace while its view remains read-only.
- **Method**: Run native and external no-model Harbor smokes from generated opaque run specs.
- **Result**: The first native smoke returned the invalid sentinel because 0444/0555 artifact modes propagated into the workspace and blocked Harbor artifact collection. The source store stayed immutable. After making only the copied tree owner-writable, native and external smokes returned exact scores `1,249,230,840` and `8,007`; the Docker view mount rejected writes. No model call or treatment occurred.
- **Analysis**: Immutability belongs at the store boundary, not in the agent's disposable working copy.
- **Decision**: Preserve all v31 records as apparatus evidence and rotate to v32 identities/seed.
- **Next test**: Repeat complete gates and fresh smokes under v32 before any model call.

## E-22: Version-32 first-model pilot freeze
- **Date**: 2026-08-28
- **Conjecture**: C-2 representation organization affects verified progress
- **Gate**: PASS (pre-treatment)
- **Hypothesis**: Six equal-evidence blocks can be blinded, balanced, executed, and analyzed under the frozen budget without residual apparatus failures.
- **Method**: Rotate identities and seed; resolve every candidate/view; compare within-block controls; run full core/gateway/Yukon/public-data gates, live route validation, preflight, and fresh native/external smokes.
- **Result**: All six treatment permutations occur once; R0/R1/R2 each occur six times; 18 run specs contain no arm/block names; 18 views and six candidates resolve exactly; atom bytes match within every block. Tests pass 176/77/115 with two intentional Yukon skips. Fresh smokes reproduce both starting scores, and the ledger remains `$25.227542` with zero active reservations.
- **Analysis**: The precursor is complete. The next observations can estimate representation effects rather than history availability or permission plumbing.
- **Decision**: Freeze v32 and release only its 18-chain GPT-5.6 Sol pilot under the `$162` incremental cap.
- **Next test**: Execute opaque chains, export blinded outcomes, classify failures, then unblind and apply the preregistered decision rule.

## E-23: Version-32 paid metric-contract stop
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: FAIL after first paid round; v32 excluded
- **Hypothesis**: The frozen history metric and clean verifier metric agree through the first representation handoff.
- **Method**: Start the first opaque v32 chain and append its retained real Dungeness event export before round two.
- **Result**: The first cell completed two development evaluations and clean-scored `1,249,230,840`; a second cell was cancelled without evaluation. Append failed because the history declared `qubit-Toffoli product` while the clean artifacts declared `ecdsafail_score`. The two records cost `$0.559763` total.
- **Analysis**: Numeric equality cannot substitute for metric identity. No v32 outcome is admissible as representation evidence.
- **Decision**: Exclude v32 completely and require exact metric identity in bank creation, export, and append.
- **Next test**: Clean-replay a corrected history under fresh v33 identities before any treatment.

## E-24: Version-33 real-event context stop
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: FAIL before model contact; v33 excluded
- **Hypothesis**: Corrected ECDSA histories remain within 32k after appending real round events.
- **Method**: Clean-replay all 11 candidates, publish a corrected metric-bound history, compile all initial views, then append v32's retained two-event export as model-free handoff evidence.
- **Result**: Scores matched 11/11 and initial R0 fit at 27,090 tokens, but the appended view reached 37,486 tokens. v33 spent `$0` on models.
- **Analysis**: Full payload manifests and repeated seed/environment/harness objects are trusted transport redundancy, not additional scientific atoms.
- **Decision**: Exclude v33. Keep semantic facts and exact diffs; validate full transport but project it by content hash in renderer v4.
- **Next test**: Recompile all histories, append task-matched events, and stress all complete chains before treatment.

## E-25: Version-34 complete release qualification
- **Date**: 2026-08-28
- **Conjecture**: C-2 representation organization affects verified progress
- **Gate**: PASS (pre-treatment)
- **Hypothesis**: Renderer v4 preserves equal evidence and supports every planned handoff without context, provenance, isolation, or runtime failure.
- **Method**: Recompile six histories twice under R0/R1/R2; append real or clean-verified task-matched events to all 18 views; project 12-event chains; run complete suites, live route validation, and three fresh Docker smokes.
- **Result**: All bytes are deterministic and atom hashes match within blocks. First-handoff views are at most 13,906 tokens; 12-event projections are at most 16,880. Tests pass 177/77/117 with two intentional skips. Native/Toy/VLIW clean scores are `1,243,629,702`, `7,337`, and `3,360`; research-view writes fail. The 18 fresh chains contain every treatment order once and no arm/block label leaks.
- **Analysis**: The apparatus now exercises the complete planned context and all three task runtime paths before treatment.
- **Decision**: Freeze v34 independently and release its first opaque chain. Continue only while per-round provenance and spend gates hold.
- **Next test**: Run three rounds of the first opaque chain, then complete the frozen blinded batch.

## E-26: Version-34 first-chain paid release gate
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: PASS
- **Hypothesis**: One complete paid chain can cross both handoffs and the outer milestone sweep without violating frozen provenance, context, isolation, or spend contracts.
- **Method**: Execute only the first scheduled opaque cell through three fresh sessions; require clean reverification after every round, append each trusted export, and seal five outer milestones.
- **Result**: Three rounds completed with 1/2/1 development evaluations, 126,842 model tokens, 437 agent-seconds, and `$1.524668`. All handoffs and milestones clean-verified. The chain record is `74c0ffdc…ed7c`; the outer score artifact is `dce6c3d3…149d`. The ledger is `$27.311973` with zero active reservations.
- **Analysis**: The complete lifecycle is operational. The trajectory remains an outcome, not an apparatus-tuning input or interim arm decision.
- **Decision**: KEEP the chain and release the remaining 17 canonical cells without changing any frozen input.
- **Next test**: Resume the canonical experiment, which must skip the completed chain and start the second cell.

## E-27: Version-35 host-network administrative recovery
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: v34 interrupted; v35 recovery PASS
- **Hypothesis**: A host-network outage can be isolated without selective arm retry, overwritten evidence, changed assignments, or loss of the hard study ceiling.
- **Method**: Stop the scheduler after PyPI and Docker Hub became unreachable; preserve every run and reservation; remove only the interrupted task containers; re-probe both services; keep the first complete block solely in v34; mark all 15 later scheduled v34 cells administratively invalid; create one opaque frozen-field-matched replacement for each; independently validate hashes, links, combined balance, opacity, and caps.
- **Result**: The first v34 block completed three chains, 15 evaluations, 351,795 tokens, and `$4.400083`. The outage touched the following Toy and VLIW blocks before interruption. Nine reservations remain fail-closed and ledger commitment is `$60.258412`. Connectivity recovered. v35 contains 15 invalidated cells and 15 replacements. All 16 independent recovery checks pass; the combined v34/v35 sample remains balanced 6/6/6 and complete within all six blocks.
- **Analysis**: Package-index and registry loss is administrative infrastructure failure. Repeating only failed arms would bias the block; preserving old records and rotating every later identity maintains auditability and scheduling neutrality.
- **Decision**: Do not resume v34. Freeze v35 at `38a18892…01ef` and execute its 15 fresh replacements; join them to the original completed v34 block only after blinded export.
- **Next test**: Run v35, then freeze blinded results and failure classifications before unblinding.

## E-28: Terminal-candidate milestone repair and v36 restart
- **Date**: 2026-08-28
- **Conjecture**: apparatus qualification
- **Gate**: v34/v35 excluded; v36 pre-treatment freeze PASS
- **Hypothesis**: The outer milestone curve must include the final candidate left by each session even when the agent makes no development-evaluator call.
- **Method**: Audit one completed excluded zero-evaluation chain; seal its Harbor-retained terminal files; clean-reverify them; repair selection to place development captures and terminal candidates on the same cumulative-budget timeline; add native/external regression tests; rotate all 18 identities; rerun complete suites, live-route validation, preflight, and three task-family Docker smokes; independently validate the new freeze.
- **Result**: The diagnostic recovers a 1,543-cycle round-two terminal candidate where the old record carried the 7,337 baseline. Tests pass 182/77/117 with two intentional skips. Native/Toy/VLIW smokes return `1,243,629,702`, `8,007`, and `3,360` with zero model use. The v36 design contains 18 invalidated source cells plus 18 linked replacements, balances each arm 6/6/6 across six blocks, and passes every freeze check at `b30a511e…9c28`. The ledger commits `$65.777718`, including `$30` fail-closed active reservations, under `$500`.
- **Analysis**: Evaluator invocation is endogenous agent behavior. A selector limited to explicit development submissions can erase genuine progress and bias AUC. The outer evaluator should observe terminal work without feeding its score or artifact back into research.
- **Decision**: Exclude every v34/v35 cell. Run only the fresh frozen v36 batch; do not salvage the earlier completed block.
- **Next test**: Execute v36 fail-fast, then classify the blinded export before any treatment-level analysis.

## E-29: Version-36 first-model pilot result
- **Date**: 2026-08-28
- **Conjecture**: C-2 representation organization affects verified progress
- **Gate**: COMPLETE; `PILOT_INCONCLUSIVE`
- **Hypothesis**: At least one structured arm will improve paired task-equal progress-AUC by 0.25 meaningful-gain units, win four of six blocks, and preserve final-score noninferiority.
- **Method**: Complete all 18 frozen three-round GPT-5.6 Sol chains; export 36 rows while treatment-blind; freeze 18 source administrative failures and the one active treatment failure; join the frozen assignment only afterward; run 100,000-draw task-then-history hierarchical bootstrap analysis.
- **Result**: All six blocks and 18 active cells complete with zero protocol violations. R1−R0 AUC is 1.078671 with 95% interval [−0.001396, 4.315616] and 1/6 wins; final noninferiority passes. R2−R0 AUC is 1.858128 with interval [−0.536227, 5.611511] and 2/6 wins; final noninferiority fails. ECDSA ties; Toy ISA is neutral-to-negative; R1 and R2 win different VLIW histories. Forty-three of 43 development evaluations and 89 of 90 outer milestones are valid. Completed chains cost `$37.412034`.
- **Analysis**: Positive task-equal means are driven by VLIW and are not broad enough for a universal claim. Every AUC interval includes zero. The pilot cannot establish equivalence, but all three arms remain statistically indistinguishable at this resolution.
- **Decision**: Do not run Kimi. Report no universal winner and use R0 as the simplest member of the indistinguishable set, not as a proven superior arm.
- **Next test**: Evaluate the frozen option for one additional balanced history per task entirely model-free before authorizing any reserve spend.

## E-30: Balanced reserve qualification stop and formal freeze
- **Date**: 2026-08-28
- **Conjecture**: one additional history per task can resolve the inconclusive pilot without post-hoc task selection
- **Gate**: FAIL before model contact
- **Hypothesis**: Toy ISA, VLIW, and ECDSA can each supply one unused verified history that preserves the frozen validity, parity, and 32k context requirements.
- **Method**: Create treatment-blind reserve plans, clean-verify candidates, materialize starting artifacts, export canonical events, and compile each R0/R1/R2 view twice before creating any paid experiment assignment.
- **Result**: Toy ISA and VLIW each produce deterministic verified reserves below 7,546 tokens. The natural ECDSA reserve bank clean-verifies, but R0 alone requires 46,825 tokens against the 32,000 limit. A smaller synthetic ECDSA branch fails the sealed verifier with five classical mismatches and four phase-garbage batches. No reserve model request is made. The v36 result freeze is `e9f4b0e7…73633`.
- **Analysis**: Running only Toy ISA and VLIW would be an unbalanced, outcome-aware task extension. Relaxing context or validity after seeing pilot results would change the treatment and contaminate inference.
- **Decision**: Stop the reserve extension and all paid work. Preserve R0/R1/R2 as the pilot-resolution indistinguishable set; R0 remains the default by simplicity. Confirmation remains unstarted.
- **Next test**: Only a separately preregistered, explicitly authorized conditional-policy study on a larger, license-clear, treatment-blind task pool.
