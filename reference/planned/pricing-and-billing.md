# Lor pricing and billing proposal

Status: proposal for LOR-16, 2026-10-16. Prices below are USD, before tax. Product prices and workload volumes are proposed assumptions; vendor rates are public prices checked on this date. This does not change the live billing configuration.

**Include search, voice transcription and code storage in the seat price, with no credit debits or per-unit overage for those features. AI inference uses a separate allowance and purchased credits, or the customer's own API key or eligible subscription. Include normal browser and sandbox use; charge infrastructure overage only after a pooled runtime allowance.**

The working price remains **$29/member/month with $10 of AI credits**, a three-member minimum, and proposed monthly runtime allowances of **10 sandbox hours at 4 GB plus 5 browser hours per member**, pooled across the team. The feature inclusions follow the owner's direction; the runtime quantities and price remain planning proposals. A $39 version with identical inclusions is also modeled to show the margin tradeoff.

With the same workload assumptions, a ten-member team now pays approximately **$290 light, $343 typical or $932 heavy**, at modeled contribution margins of **70%, 45% and 34%**. The earlier proposal was $290/$466/$1,342 with more features charged separately. The bundle reduces customer bills; Lor still incurs the included services’ vendor costs.

Editable model: [Lor pricing workbook](../../outputs/lor-pricing-2026-10-16/lor-pricing-model.xlsx). Start with `Summary`; change the blue/yellow cells in `Inputs` and `Workloads`. `Cost Build` traces the costs, `Scenarios` compares nine pricing structures across six team sizes and three workloads, `Model Rates` compares model providers, and `Fleet` shows the effect of early customer scale. Source links are included. Workload volumes are hypotheses, not observed usage.

## 1. The launch offer

| Item | Proposed policy |
|---|---|
| Team subscription | $29 per paid human member/month; three-member minimum, $87/month |
| Included AI usage | $10 retail AI balance per member/month, pooled across the workspace |
| Included sandbox runtime | 40 GB-hours/member/month, equivalent to 10 hours at 4 GB; pooled across the workspace |
| Included browser runtime | 5 browser hours/member/month, pooled across the workspace |
| Additional usage | AI beyond its allowance and runtime beyond its respective allowance; $25 minimum prepaid purchase; optional auto-recharge with an explicit monthly dollar cap |
| Credit denomination | Keep 100 credits = $1 for compatibility; display dollars prominently |
| Monthly allowance | Expires at renewal; spend it before purchased balance |
| Purchased balance | Does not expire; preserve existing balances and promises |
| Included product | Shared workspace, internal and external search/page fetch, voice transcription, code storage and normal transfer/checkpoints, files, connectors, memory and ingestion |
| BYO API credentials | Same seat price and inclusions; selected model inference billed directly by provider; only excess Lor-hosted runtime creates infrastructure overage |
| Personal subscription | Same seat price and inclusions; only eligible personal inference uses the provider-supported subscription; only excess hosted runtime creates infrastructure overage |
| Annual plan | Defer until actual usage and retention justify the discount |
| Design partners | Keep the documented free pilot arrangement, with an internal cost cap; move to paid explicitly |

The seat fee pays for a useful shared product, including search, transcription, code storage and ordinary runtime. Watching a colleague's session does not create a second AI charge. A fork or concurrent agent consumes additional inference and runtime because it creates additional work. Do not add an agent seat, a separate connector fee or a second charge merely for viewing output.

All human workspace members count initially, matching current seat logic; Lor and other service identities do not. If paid seats block collaboration during pilots, add a narrowly defined free viewer role later. The workbook currently assumes every modeled member is paid and uses the specified average workload.

**$10 AI balance means $10 at Lor's retail inference rates, not $10 of wholesale tokens.** At 3×, fully using it costs approximately $3.33 in direct inference expense. Search, transcription, code storage and included runtime never consume this allowance. Keep the AI and runtime allowance counters separate; purchased prepaid balance can settle either AI overage or authorized runtime overage. Unused AI allowance does not automatically become runtime allowance. Do not advertise API-price pass-through while applying a multiplier.

Use stable, versioned retail prices. Temporary provider discounts should initially improve margin, rather than silently lowering the rate card and creating a later price increase. The workbook's model comparisons generally reprice consumption at 3× each selected route to make alternatives comparable; the promotional DeepSeek row is a hypothetical repriced offer, not a recommended automatic discount policy.

## 2. Included features and paid consumption

| Work | Customer charge | Rationale |
|---|---|---|
| Requested Lor responses and agent work | Model tokens at the served-model retail rate | Includes reasoning and paid cache operations; charge actual work once |
| Code investigations, code changes, artifact generation | AI inference; sandbox time only above the runtime allowance | Same rule whether launched directly or as a child task |
| Browser actions | AI inference; browser time only above the runtime allowance | Ordinary browser hosting is included; unusual proxy/captcha services require an explicit enabled offer |
| Scheduled Loops | Same rates as interactive work | Background initiation does not make the requested work free |
| External web search and page retrieval | Included; no credit debit | Lor pays the search provider; answer-generation inference is still AI usage |
| Live voice transcription | Included; no per-minute charge | Lor pays stream costs; asking an agent to act on a call still uses inference |
| Code storage, checkpoints, normal transfer and retained sandbox snapshots | Included; no storage credit debit | Retention and efficient storage are Lor's responsibility |
| Source/attachment ingestion, embeddings, reranking, routing, gated writeback | Included in seats | The product should become more useful when customers connect knowledge |
| Ordinary chat, session viewers and workspace search UI | Included in seats | No charge per message, viewer or search click |

Meter all vendor costs internally, including included work. Internal cost visibility does not create a customer charge. Do not charge both a parent's aggregate usage and its separately reported child usage. Runaway automation, abuse and accidental retention should be handled through queues, concurrency controls, clear retention and human review; do not silently convert included search, voice or code storage into a paid meter.

Illustrative rates for the remaining paid consumption, at 3× the modeled vendor rates:

| Unit | Approximate Lor retail rate | Notes |
|---|---:|---|
| Default mixed main run | $0.065 | Illustration only: 100k cumulative input, 80% cached, 5k output; actual token metering |
| 4 GB sandbox hour above allowance | $0.497 | Only the excess; allowance measured in GB-hours so larger instances consume more |
| Browser hour above allowance | $0.594 | Only the excess hosting time; browser inference uses the AI allowance separately |
| Search, page fetch, transcription and code storage | Included | No credit debits, regardless of unused AI allowance |

These are derived prices, not vendor promises. A ten-member team gets 100 hours of 4 GB sandbox use and 50 browser hours monthly before infrastructure overage. At the modeled typical workload it uses 50 sandbox hours and 20 browser hours, so infrastructure overage is zero. Keep the UI focused on AI balance, included runtime remaining and the authorized extra-spend ceiling.

## 3. Workload and cost assumptions

All volumes below are **per paid member per month**, averaged across a team. They are hypotheses. A ten-person team collaborating on one task may consume much less than ten independent agents; ten parallel forks may consume much more. Replace these averages with workspace-level observations before promising fixed usage quantities.

| Driver | Light | Typical | Heavy |
|---|---:|---:|---:|
| Main agent runs | 60 | 150 | 600 |
| Additional code sessions | 3 | 10 | 40 |
| Active sandbox hours | 1 | 5 | 25 |
| Browser hours | 0 | 2 | 10 |
| External searches / fetched pages | 30 / 90 | 100 / 300 | 400 / 1,200 |
| New or changed source units | 250 | 1,000 | 5,000 |
| Retained indexed source units | 2,000 | 10,000 | 25,000 |
| New attachment pages | 50 | 200 | 1,000 |
| R2 file storage, GB | 1 | 2 | 5 |
| Hot / cold code storage, average GB | 0 / 0 | 0.25 / 0.5 | 1 / 2 |
| Code ingress / egress, GB | 0 / 0 | 0.25 / 1 | 1 / 4 |
| Retained sandbox snapshots, GB | 0.5 | 1 | 4 |
| Unmuted microphone minutes | 30 | 60 | 180 |

A main run accumulates 100k input and 5k output tokens across its steps. A code session adds 500k input and 20k output. A browser hour adds 2m input and 100k output, equivalent to an assumed 200 actions with 10k input and 500 output each. These are separate workloads, not three charges for the same tokens. Input is 80% cache reads, 10% cache writes and 10% other input. Longer sessions, image-heavy browser actions, poor caching and retries can exceed these assumptions substantially.

The default token mix is 95% conservative DeepSeek V4.1 Flash pricing and 5% Kimi K3 fallback. The 5% is a share of token volume, not a share of requests. Small housekeeping uses GLM 5.3 Flash. Routine writeback stays on the inexpensive default mix even when a user selects a premium direct model.

No separate AI Gateway token markup is added: Vercel currently publishes zero markup, including BYOK traffic. Credit-purchase payment fees and optional reporting/trace/team-wide policy surcharges are not explicitly modeled; reconcile them within the contingency or add dedicated meters if enabled. Per-request provider filtering is free. Free credits and temporary vendor grants are excluded from the steady-state economics. [AI Gateway pricing](https://vercel.com/docs/ai-gateway/pricing)

| Monthly cost per member | Light | Typical | Heavy |
|---|---:|---:|---:|
| User-requested model inference | $1.59 | $5.10 | $21.25 |
| Execution, search, code storage and voice | $0.84 | $4.11 | $17.14 |
| Included background work, index and core services | $1.71 | $4.12 | $12.08 |
| **Variable vendor cost** | **$4.14** | **$13.33** | **$50.47** |
| Vendor contingency, 10% | $0.41 | $1.33 | $5.05 |
| Direct support allocation | $1.50 | $1.50 | $1.50 |
| **Variable service cost before shared allocation and payments** | **$6.05** | **$16.17** | **$57.02** |

The core-services estimate is $0.75/member for incremental worker/API CPU, realtime, queues, ordinary transfer and R2 operations. Base hosting/monitoring is another assumed $300/month fleet-wide. Support is a placeholder, not measured staffing cost. The contingency is a planning buffer, not proof that every omitted workload is covered.

At the reference fleet of 50 paying workspaces averaging ten typical members, add $50/month LiveKit and $375/month Autumn to base hosting: **$725/month, or $14.50/workspace**. Browser and Code Storage minimums apply only when total usage falls short of their minimum spend, avoiding double counting. Payment costs are conservatively modeled at 3.6% plus $0.30 per monthly invoice.

The resulting margins include vendor costs, contingency, direct support, payment processing and allocated shared services. They exclude R&D, sales, founder salaries, tax, acquisition costs and other corporate overhead. Call them **modeled contribution margins**, not net profit or audited gross margins. One-off prepaid collections are not all earned revenue immediately; the model assumes overage consumption is earned in the month and does not count unused top-ups as profit.

## 4. Bills and margins by team size

Each cell shows **customer monthly bill / Lor monthly service cost / contribution margin**. The same reference fleet allocation applies in every row; team size is not the size of Lor's entire customer base. Included features have no usage revenue but remain in costs.

| Paid members | Light | Typical | Heavy |
|---:|---:|---:|---:|
| 3 | $87 / $36 / 58.5% | $103 / $67 / 34.9% | $280 / $196 / 29.9% |
| 5 | $145 / $50 / 65.3% | $171 / $102 / 40.6% | $466 / $317 / 32.0% |
| 10 | $290 / $86 / 70.4% | $343 / $189 / 44.9% | $932 / $619 / 33.6% |
| 20 | $580 / $157 / 73.0% | $686 / $363 / 47.1% | $1,864 / $1,222 / 34.4% |
| 50 | $1,450 / $370 / 74.5% | $1,715 / $885 / 48.4% | $4,659 / $3,033 / 34.9% |
| 100 | $2,900 / $724 / 75.0% | $3,429 / $1,755 / 48.8% | $9,318 / $6,052 / 35.1% |

The typical ten-member bill is **$290 seats + $152.90 AI consumption − $100 included AI allowance = $342.90**. All modeled browser/sandbox time fits within the included runtime. Search, transcription and code storage add no customer charge. Lor's modeled total cost is **$188.80**, or **$18.88/member**.

The heavy ten-member bill is **$290 seats + $537.56 AI overage + $104.22 runtime overage = $931.78**. Runtime overage is 150 additional 4 GB sandbox hours and 50 additional browser hours across the team. Lor's cost is **$618.51**. Search, voice and code storage are still included at this usage level.

The $29 base now supports a meaningful included product. Under the typical case, effective spend is about $34/member, and overage is entirely AI. The same bundle at **$39/member** produces a typical $443 team bill and **56.6% contribution**, versus 44.9% at $29. Keep $29 as the current scenario while deciding the final launch price; the $39 comparison is not an approved price change.

Early scale matters. With ten-member typical teams at $29, modeled fleet contribution is 24.1% at five customers, 37.2% at ten, 44.9% at fifty and 47.1% at one hundred. The Autumn step above $8k monthly billing reduces margin temporarily. Above $50k, the workbook flags the need for an Autumn quote and uses an explicitly unquoted fee placeholder.

## 5. Alternative business models

These are identical ten-member workloads. Bills are Lor revenue, excluding separately paid provider costs. Revised plans all include search, voice, code storage and the same runtime allowances. Inference multipliers differ; excess runtime remains at the modeled 3× rate. Only the historical existing-plan row retains the old broad-metering approximation; the unlimited row charges no overage at all.

| Structure | Typical bill | Typical margin | Heavy bill | Heavy margin |
|---|---:|---:|---:|---:|
| **$29 bundled plan + $10 AI allowance** | $343 | 44.9% | $932 | 33.6% |
| Existing $20/$20 approximation, historical broad metering | $200 | 8.2% | $384 | -56.0% |
| $29 seats, unlimited including AI | $290 | 35.6% | $290 | -105.3% |
| $29 bundle + inference at vendor cost, no AI allowance | $341 | 44.6% | $607 | approximately 0% |
| $29 bundle + inference at 1.25×, no AI allowance | $354 | 46.5% | $660 | 7.8% |
| $29 bundle + BYO API inference | $290 | 54.9% | $394 | 7.3% |
| $29 bundle + conditional subscription coverage | $290 | 47.2% | $549 | 15.4% |
| $99 includes five seats, then $15; $20 total AI allowance | $307 | 38.9% | $896 | 31.1% |
| **Same bundle at $39/member, $10 AI allowance** | $443 | 56.6% | $1,032 | 39.7% |

The historical existing-plan row approximates wholesale-cost billing and assumes all direct consumption was metered. Actual seeded retail rates, fallback routes, event rounding and missing meters mean it is **not a reconstruction of today's invoices**.

Inference pass-through is simple to explain, but it supplies little contribution toward the increasing included workload. At 1.25×, inference has a 20% gross spread before payments and overhead. In the revised heavy case the whole product only contributes 7.8%; vendor-cost inference is approximately break-even. This does not justify charging separately for the newly included features. It means the seat price, the inference offer and operating efficiency must fund them.

The workspace-price alternative gives up $36/month at ten members versus the $29 seat plan and leaves typical contribution around 39%. The $39 version is the stronger margin option for the new bundle, while $29 can serve as an initial paid-pilot price. Neither guarantees a high margin on unlimited high-intensity usage.

Cursor's current public page lists Teams from $30/user and separately purchased third-party models at API list price. Older $40-seat/$20-allowance discussions are not a safe current benchmark. Copy the clear separation of product subscription, included usage, additional usage and budgets; do not assume Lor has Cursor's model costs, subsidies or private commercial agreements. [Cursor pricing](https://cursor.com/pricing)

## 6. BYO API keys and subscriptions

Architecture update, 2026-10-19: [shared harness sessions](harness-sessions.md)
now targets Pi for managed chat/cowork/code sessions and eligible official
harnesses for personal subscriptions. Direct subscription-funded inference
outside those harnesses is deferred. The workbook has not been recalculated for
this broader runtime coverage; its code-only offload figures below describe the
earlier integration scope.

### BYO API credentials

Keep the same seat price and included product for BYOK. Do not consume AI credits for inference paid through the customer's provider account. Search, transcription, code storage and normal sandbox/browser time remain included. Only runtime above the pooled allowances creates a Lor infrastructure charge. Background ingestion and retrieval remain Lor costs; do not silently bill that housekeeping to the customer's key.

The typical ten-member case is **$290 to Lor + $50.97 to providers = $340.97 total**. Lor's contribution is about **54.9%**, compared with 44.9% when Lor supplies the inference under the $10 allowance. Lor contribution dollars are about $159 versus $154: the modest billable AI overage in this case does not fully offset Lor's inference expense and included allowance.

The heavy case is **$394.22 to Lor + $212.52 to providers = $606.74 total**. Lor's contribution falls to **7.3%**, because included services and retained context still cost money while model revenue moves to the customer's provider. This is a real limitation of $29 for heavy BYOK teams; do not hide it with an assumed 50% floor. A higher seat price and lower underlying storage/index/runtime costs are the main options that preserve the included product.

Credential scope must identify who owns the provider bill. A workspace API project may support authorized teammates; a personal subscription is not a shared team credential. Handoff changes the paying identity. A provider quota failure pauses or requests a switch; it must not silently start charging Lor Cloud without the workspace's standing authorization.

Vercel documents fallback from failed BYOK requests to system credentials, charging Gateway balance. The workbook's BYOK case assumes this paid fallback is prevented or separately authorized and attributed. Otherwise Lor's model cost is not zero when the customer's key fails. [Gateway BYOK billing](https://vercel.com/docs/ai-gateway/pricing)

### Personal subscription access

There are two different product paths:

1. **Hosting an official personal coding CLI.** Current Anthropic documentation expressly allows hosting unmodified Claude Code under its commercial conditions, preserving its authentication methods and having each end user authenticate and pay Anthropic directly. The same page prohibits implementing Claude.ai login in Lor or collecting/intermediating subscription credentials. Do not fund hosted Claude Code with Lor's API key or resell its usage under that hosting permission. Shared steering, unattended Loops and handoff still need careful identity boundaries; keep the initial experience personal. [Claude Code terms and credential rules](https://code.claude.com/docs/en/legal-and-compliance)
2. **Using a personal plan as Lor's general inference backend.** OpenAI's public plan-sharing documentation directs paid or remotely hosted apps to its commercial interest process. Lor must complete the applicable participation route before promising this. The open-source/local flow is not blanket permission for the current paid hosted product. [OpenAI plan-sharing eligibility](https://developers.openai.com/siwc/token-sharing-open-source)

The workbook's 60% BYOS case is an **economic hypothesis about avoided Lor inference expense**, conditional on an eligible integration and sufficient user quota. It does not mean a ChatGPT plan pays for DeepSeek requests or that Claude Code covers the rest of Lor. User work may move to a different model. The assumed $20/member external subscription is a budget input, not an assurance that a particular plan supports that workload.

That case costs the typical ten-member team $290 to Lor plus an illustrative $200 of subscriptions: **$490 total**. If those subscriptions are already owned, incremental spend is $290. Its modeled Lor contribution is 47.2%; the remaining Lor-funded inference fits inside the AI allowance. Buying subscriptions solely to replace cheap default inference is usually poor economics. Premium coding is a stronger use case.

The earlier coding-child-only integration offloads only code inference. In the typical default-model case, that is just $0.99/member/month of Lor vendor cost, or about $2.96/member of retail cloud consumption. Those figures do not describe the new shared-harness target, which can also move a session's main loop into the selected official harness. Indexing, storage, sandbox and other Lor-hosted services still cost money. A local runner can additionally remove hosted sandbox hours for the work actually moved local; checkpoints, sync, context and Lor's background services remain. The workbook conservatively keeps all execution in Lor's cloud for its BYO comparisons.

**Runtime rollout:** follow [the shared-session plan](harness-sessions.md#6-implementation-sequence): Pi primary runtime first, then eligible official-harness adapters on the same session model. Personal subscription support is no longer architecturally restricted to code channels. Keep Loops on an explicitly budgeted workspace API account or Lor Cloud, defer direct subscription inference, and do not make provider eligibility a managed-launch dependency. Pricing assumptions still need a separate update using measured costs.

## 7. Model selection changes price more than embeddings do

Prices below use identical token counts, not equivalent completed-task quality. A stronger model may finish in fewer steps; a weak model may retry. Model-specific tokenizers, tool behavior and context limits also differ.

| Direct model choice | Cost of reference main run | Typical ten-member Lor bill | Heavy ten-member bill |
|---|---:|---:|---:|
| Default mix | $0.0216 | $343 | $932 |
| DeepSeek stable | $0.0144 | $292 | $719 |
| DeepSeek promo | $0.0052 | $290 | $449 |
| Kimi K3 | $0.1590 | $1,312 | $4,974 |
| GLM 5.3 Flash | $0.0079 | $290 | $528 |
| GPT 6 Sol | $0.1110 | $974 | $3,564 |
| Claude Sonnet 5.5 | $0.1030 | $917 | $3,324 |
| Claude Opus 5.5 | $0.2060 | $1,643 | $6,354 |

The stable DeepSeek rate is $0.30/million fresh input, $0.03 cached and $1.20 output; promotional DeepInfra pricing is materially lower. Kimi is $3/$0.30/$15. GLM's selected route is $0.15/$0.03/$0.50, while the Modal route costs more. Pin allowed providers or use route-aware cost records. [DeepSeek routes](https://vercel.com/ai-gateway/models/deepseek-v4.1-flash), [Kimi](https://vercel.com/ai-gateway/models/kimi-k3), [GLM routes](https://vercel.com/ai-gateway/models/glm-5.3-flash)

GPT 6 Sol uses $2 fresh input, $0.20 cache reads, $2.50 cache writes and $10 output per million. Sonnet 5.5 uses $2/$0.10/$2.50/$10; Opus 5.5 uses $4/$0.20/$5/$20. The model includes cache-write costs, but excludes long-context, priority and regional surcharges. For example, GPT 6 Sol's >272k-token per-request band raises input/cache and output rates; cumulative session tokens are not the same as per-request context length. [OpenAI model pricing](https://developers.openai.com/api/docs/models/gpt-6-sol), [Anthropic pricing](https://platform.claude.com/docs/en/about-claude/pricing)

Three-times retail inference pricing provides more contribution as premium consumption grows, but creates large bills. With cheap default inference, bundled non-model services can be a larger combined cost than the model itself; the new inclusion policy does not make those costs disappear. Do not switch every user to a premium model and call it an upgrade at the same unlimited price. Keep cheap default routing, explicit premium selection, visible budgets and BYOK for sustained premium use. An all-Kimi reference run costs over seven times the modeled 95/5 mix. If Lor holds a default retail price fixed while failover rises, Lor absorbs that difference until it changes the rate card.

## 8. Future infrastructure costs and design choices

### Sandbox compute and retained state

Blaxel active compute is $0.0000115 per allocated GB-second: a 4 GB sandbox costs **$0.1656/hour**. A 25-hour heavy member costs $4.14 in compute; a mistakenly pinned 4 GB sandbox running 730 hours costs **$120.89/month** before inference. Current `keepAlive` behavior can bill while waiting on models. Closing the H2 connection and stopping unnecessary processes matters more than optimizing pennies of embeddings. [Blaxel pricing](https://blaxel.ai/pricing)

Suspension stops compute charges, not all data charges. Snapshot storage is $0.20/GB-month, durable provisioned volumes $0.12/GB-month and images $0.045/GB-month. The model includes snapshots, assumes the current ephemeral disk is not also charged as a separate durable volume, and budgets modest shared image costs in base hosting. Add provisioned-volume capacity if that architecture changes. Align retention with current workbench/code-session TTLs; preserve user deliverables in R2/Git.

### Browser use

Browserbase Developer is $20 for 100 hours then $0.12/hour; Startup is $99 for 500 hours then $0.10/hour. At 500 hours, Developer would be $68 and Startup $99, so choose Startup for required concurrency/features, not merely because its included-hour headline looks cheaper. The model conservatively uses $0.198/hour and accounts for any minimum-spend shortfall across the fleet. [Browserbase pricing](https://www.browserbase.com/pricing)

Steel Launch is usage-based at $0.10/hour; Scale is $250 with $100 usage included and $0.08/hour. Session duration, concurrency, reconnection and credential handling remain part of the planned vendor decision. Residential proxy traffic can be dollars per GB and overwhelm browser-hour costs. Keep proxies/captcha paid extras disabled by default. [Steel pricing](https://steel.dev/pricing)

Browser inference is separate from browser hosting. The default action-loop assumption costs about $0.43/hour in model tokens, versus $0.198 in browser hosting. Vision-heavy actions or expensive models can reverse the impression that browser use is cheap. Viewing the same live browser should share one browser session.

### Code Storage and Cloudflare Artifacts

Code Storage hot data is $0.005/GB-hour, or **$3.65/GB-month** at 730 hours; cold is $0.0002/GB-hour, or **$0.146/GB-month**, after seven days untouched. Ingress is $0.06/GB and egress $0.15/GB. Replication is included. Starter has a $20 fleet-wide minimum, not $20 per Lor workspace on top of consumption. [Code Storage pricing](https://code.storage/pricing)

One hot GB per member in a ten-person team costs $36.50/month wholesale; ten hot GB per member costs $365/month. This is a more meaningful pricing risk than the initial embeddings. Repeated polling or reads may keep bytes hot. Measure unique retained objects, forks, cloned mirrors and transfer amplification. Do not assume every checkpoint is a full repository copy, or that every branch is free.

Cloudflare Artifacts lists $0.50/GB-month plus $0.15/1,000 operations beyond its free allowances and requires Workers Paid. Its storage can be substantially cheaper, but per-step checkpoint operations and product fit matter. For illustration, 100k chargeable operations cost $15. Preserve the planned vendor spike; do not select a provider on storage price alone. [Artifacts pricing](https://developers.cloudflare.com/artifacts/platform/pricing/)

Keep snapshots, Git objects and R2 deliverables as separate internal cost categories because they can coexist. All are included in the proposed product; there is no customer charge per hot GB, checkpoint or code transfer. Offer predictable retention and checkpoint cleanup prospectively, and preserve promised history. Storage efficiency is now a margin requirement rather than a cost passed through to the customer.

### Ingestion, retrieval and embeddings

Qwen3 Embedding 4B is $0.02/million tokens. Embedding 1,000 source units at 1,500 tokens each costs about **$0.03**. Adding a GLM summary with 1,500 input and 250 output tokens brings that batch to about **$0.38**. This supports including normal ingestion instead of charging customers every time they connect knowledge. [Embedding pricing](https://vercel.com/ai-gateway/models/qwen3-embedding-4b)

Retaining and searching the corpus is more material. The context-engine plan's sizing estimate is approximately 16 GB RAM and 32 GB disk per million source items. At Railway's public resource rates, that implies about **$167/month per million retained units**, before broader database CPU, replicas, backups and ops. This is a planning estimate, not a measured pgvector benchmark. [Railway pricing](https://railway.com/pricing), [context-engine sizing](context-engine.md)

Voyage rerank 2.5 is $0.05/million tokens; each candidate repeats the query-token contribution. The workbook assumes 40k rerank tokens/query and two retrievals/main run: $0.60/member in the typical case. [Voyage pricing](https://docs.voyageai.com/docs/pricing)

Use incremental source hashes, small-model enrichment and gated writeback. Preserve the planned deferral of per-turn embeddings and session summaries until their value justifies cost. Do not run Kimi-sized link extraction over every incoming source by default. External transcripts that arrive already transcribed should not incur a second speech-to-text pass.

For the initial self-serve plan, use published capacity guidance of **10,000 retained normalized source units and 5 GB files per paid member, pooled**, with larger corpora reviewed before bulk import. Allow normal incremental ingestion without per-item debits; rate-limit import bursts and handle very large backfills explicitly. A normalized unit is a chunk, not necessarily a whole document. Make the mapping understandable before enforcing it. This knowledge-index capacity guidance is separate from the included code-storage promise; it must not become a hidden code-storage charge.

If a capacity add-on is needed, **$49/month per additional 100k retained source units** is a starting quote, not a launch SKU. Estimated RAM/disk cost is $16.74, or $18.41 with contingency, leaving about 59% after the modeled percentage fees before extra support and ingestion. The heavy scenario exceeds the proposed index guidance but includes no add-on revenue. This remains an optional future capacity offer, not a charge for search queries, voice or code storage, and the revised base margins must stand on their own.

### Voice, files and paid search

Deepgram regular Nova 3 mono streaming is $0.0077/minute and keyterm prompting adds $0.0013, giving the modeled **$0.009/microphone-minute**. Do not anchor a durable offer to its lower promotional rate. Lor currently uses a self-hosted transcriber, so the model does not add LiveKit's hosted-agent runtime fee. LiveKit participant minutes still count humans and the bot; its Ship plan is $50 with 150k participant minutes, then $0.0005/minute. Audio transfer overages need actual bandwidth measurements. [Deepgram pricing](https://deepgram.com/pricing), [LiveKit pricing](https://livekit.com/pricing)

R2 standard storage is $0.015/GB-month, with separate operations and free egress. Ordinary file bytes are inexpensive compared with hot Git storage. Exa's auto search is $7/1,000 requests up to ten results and content retrieval $1/1,000 pages; these vendor-paid tools are metered internally and included for the customer. [R2 pricing](https://developers.cloudflare.com/r2/pricing/), [Exa pricing](https://exa.ai/pricing)

Future generated speech, image/video generation, residential proxies, large artifact downloads, heavy realtime editing, database replicas and unusually long context are not explicitly built into the workload cases. Add internal cost meters before launching those paths. Generated media and exceptional new infrastructure need an explicit pricing decision; included search, voice transcription and code storage do not become paid meters. The 10% contingency is not an unlimited allowance for them.

## 9. Stripe, Autumn and the current implementation

**Keep Stripe plus Autumn for the first paid release.** The repository already integrates them; replacing Autumn now creates work without resolving the missing cost meters. Stripe is the payment/subscription system, Autumn manages balances/entitlements, and Lor's own ledger should remain the auditable source of usage and vendor cost.

US domestic card pricing is 2.9% + $0.30; Stripe Billing adds 0.7%. Autumn confirms both still apply beneath its fee. Autumn is free through $8k monthly billing volume and $375/month through $50k; larger scale needs a quote. The $375 step is about 4.7% of revenue just above $8k, falling to about 2.2% at the revised reference $17.1k fleet. Revisit direct Stripe metering after real operations show whether Autumn earns that fee. [Stripe payments](https://stripe.com/pricing), [Stripe Billing](https://stripe.com/billing/pricing), [Autumn pricing](https://useautumn.com/pricing)

Additional international-card, currency-conversion, dispute, tax-product and unusual payment-method costs are outside the US domestic baseline. Several top-up payments also create more fixed transaction fees than the one-invoice model. A $25 minimum pack avoids excessive fixed fees on tiny purchases.

The reviewed code has useful foundations: append-only model rates, usage events, stable invocation debit keys, a monthly allowance and non-expiring top-ups. It also needs changes before the proposed economics are enforceable:

| Area | Current behavior and required change |
|---|---|
| Seat/grant coupling | `autumn.config.ts` uses 2,000-credit blocks at $20. Decouple the seat subscription, 1,000 AI credits/member and pooled runtime allowances; update seat synchronization and proration consistently. |
| Billable operations | `policy.ts` directly debits only `lor.respond` and `investigate_code`. Other model-producing paths emit usage without direct debits. Audit parent/child accounting before adding them to avoid double charging. |
| Infrastructure and included-service metering | Record sandbox/browser runtime, Git/snapshot bytes, search and transcription for internal cost reconciliation. Debit customers only for runtime above the included allowance; keep search, voice and code storage nonbillable. |
| Actual versus retail rates | `ledger.ts` can record provider cost while credits use configured model rates. Persist both independently; attach served provider, route, quantity, rate version and billable reason. `rateVersion` exists in the schema but is not populated by this writer. |
| Cache normalization | `credits.ts` assumes a particular relationship between input and cached tokens. Normalize each SDK/provider's raw counts to disjoint fresh/cache-read/cache-write quantities; include reasoning once. |
| Rounding | `Math.max(1, ceil(...))` charges at least one cent per billable event, even for tiny/zero reported cost. Accumulate fractional credits or microdollars and round at a documented aggregate boundary. |
| Failure policy | Credit checks fail open on service errors; failed tracking can end in a terminal `fail_open` state. Add a replayable debit queue and reconciliation; expensive new execution should require an affordable reservation. |
| Concurrency | Reserve bounded work against a shared workspace balance before launching it. Independent parallel prechecks must not spend the same remaining balance repeatedly. |
| Auto top-up | The existing limit is a count of purchases, not a monthly dollar ceiling. Cap dollars explicitly; twenty $500 packs would allow $10k in recharges. |
| Unknown models | The wildcard rate is a fallback estimate, not a safe ceiling for every premium route. Do not start an unpriced model/tool path automatically. |

Code sources: [Autumn plans](../../autumn.config.ts), [billing constants](../../packages/billing/src/constants.ts), [policy](../../packages/billing/src/policy.ts), [credit math](../../packages/billing/src/credits.ts), [ledger](../../packages/billing/src/ledger.ts), [Autumn integration](../../packages/billing/src/autumn.ts), [model-rate seeds](../../packages/db/src/seeds/model-rates.ts).

Implementation order: first make actual costs and retail debits complete and reconcilable; then enforce reservations and dollar budgets; then version the new plan, grant and customer-facing rates; finally enable paid pilots. BYOK and official-CLI subscription adapters can follow without blocking the managed launch.

Recommended spending controls:

- Additional spend defaults to $0 until an admin chooses a budget or buys balance. Warn at 50%, 80% and 100% of the allowance/budget.
- Display a total ceiling as seats plus authorized additional spend. A ten-person team choosing $100 additional spend has a $390 monthly subscription-plus-usage ceiling; the revised typical $343 bill fits within it.
- Set separate per-run and per-Loop ceilings; start with a $5 regular run budget and an explicit larger budget for long code/browser work. Preserve a checkpoint when pausing.
- Reserve the next bounded step, reconcile actual usage and release unused reservations. Allow enough prepaid headroom for in-flight provider calls, rather than pretending cancellation can undo them.
- Distinguish exhausted monthly allowance, purchased balance and auto-recharge authorization. A “monthly cap” must state whether it caps new purchases, consumption, or both; do not let stored prepaid balance make the promise ambiguous.
- Spend caps pause new paid agent execution; they do not block chat, reading files or exporting existing work. Exhausting AI credits does not stop included search, transcription or access to stored code. Keep retention policy separate from the AI wallet.

## 10. What to learn before locking the price

The $29 recommendation is a defensible first offer, not a demonstrated willingness-to-pay result. At an illustrative $60/hour value of saved work, the $29 base requires roughly half an hour saved per member/month; typical future usage at $34 requires about 34 minutes. Actual purchasing decisions depend on whether the team repeatedly uses shared context and collaborative work, not the token count.

For the next paid pilots, use the same published plan and review complete workspace bills with the buyer. Capture:

1. Model and provider cost per completed task, including retries, failed requests, cache writes, fallback share and nonbillable background work.
2. Active sandbox seconds versus useful work, browser action tokens, proxy bytes, checkpoint bytes, unique retained Git objects and cold-storage eligibility.
3. New/changed versus retained source units, index resident memory, rerank tokens and database CPU as corpora grow.
4. Active users, paid members, number of independent agent runs and amount of shared viewing; avoid assuming headcount equals agent concurrency.
5. Support time, top-up payment frequency, disputes, credits, and vendor invoice reconciliation by workspace.
6. The buyer's response to the actual expected bill: approximately $29/member light, $34 typical or $93 heavy under these assumptions.

The inclusion policy is the product decision. **Do not restore separate charges for search, transcription or code storage to make the old margin target work.** At $29, this revision models 44.9% typical managed contribution, 33.6% heavy managed contribution and only 7.3% heavy BYOK contribution. It therefore does not support the earlier 60% blended / 50% heavy target without changes elsewhere.

The same bundle at $39 improves typical managed contribution to 56.6% and heavy managed contribution to 39.7%. Keep both prices visible while measuring usage. Fix idle runtimes, excessive hot Git retention and index memory growth first; if the included product needs a higher seat price, price that product honestly rather than adding small per-feature bills.

The voice workload assumptions are modest: one hour per member/month in Typical and three in Heavy. Call-heavy customers can cost more even when their AI usage is low. Preserve the free-transcription promise while measuring actual stream minutes, rather than treating this starting estimate as unlimited margin.

Premium model inference can be the dominant expense. BYOK and eligible subscriptions help customers manage that expense, but Lor must still fund the included product when inference is billed elsewhere.

## Repository evidence and reconciliation

The pricing/cost material across the root documents, `reference/`, `planned/` and `archive/` was reconciled with current billing and runtime code. The main inputs were:

| Documents | Pricing implication |
|---|---|
| [Positioning](../positioning.md), [product direction](../product-direction.md), [workspace model](../workspace-model.md) and its runbook | Target startup teams of 3–20; shared sessions beside human chat; documented free design-partner pilots; launch pricing undecided |
| [MVP spec](../lor-mvp-spec.md), [agent harness](../agent-harness.md), [context continuation](../context-continuation.md) | Main/small model roles, retrieval, gated writeback, cumulative token costs and execution budgets |
| [Code channels](code-channels.md), [GitHub connector](../github-connector.md), [tasks](../tasks-v2.md) | Future CLI credentials, forks/handoffs, sandbox time, Git checkpoints and code indexing; target design is not all shipped |
| [Agent browser](agent-browser.md) | Browser vendor undecided, shared session/live view, browser time included in run credits |
| [Context engine](context-engine.md), [session memory](session-memory.md), [attachment search](../attachment-search.md) | Default source ingestion direction, retained index sizing, cheap embeddings, small-model summaries and deferred per-turn/session enrichment |
| [Artifacts](../artifacts.md), [session files](../session-files-runbook.md), [live collaboration](live-collaboration.md) | R2 and Postgres storage, versions, shared viewing and future realtime editing |
| [Voice spec](../voice-channels.md), [voice runbook](../voice-channels-runbook.md), archived voice research | Self-hosted transcriber, microphone-stream costs, included memory; avoid obsolete hosted-agent cost assumptions |
| [Loops](../loops.md), [automation primitives](../automation-primitives.md), connector docs | Autonomous work needs metered budgets; ingestion is distinct from requested agent execution |
| [PIVOT](../../PIVOT.md), [README](../../README.md), [ROADMAP](../../ROADMAP.md), archived architecture | Historical $18/$20 and self-host/AGPL language are not sufficient evidence of the current offer; current positioning and implementation take precedence |

Revisit the code-channel subscription section against the current provider terms before implementation. The official hosted-Claude-Code exception and OpenAI's current plan-sharing participation path deserve explicit treatment; neither means one employee's subscription becomes a team inference pool.
