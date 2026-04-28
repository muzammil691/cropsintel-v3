# MAXONS Trading — Operating Workflow & Intelligence Architecture

> Source of truth for trader workflows. Zyra (Phase 1.10) and Atlas (Phase 2) load this as background knowledge per master plan v1.5 sections 1.8 + 11.2 row 1.10.
>
> Auto-extracted from MAXONS_Workflow_v1.docx (uploaded by Muzammil 2026-04-29).
>
> Original file: docs/MAXONS_Workflow_v1.docx (preserved alongside this markdown for reference).

---

MAXONS TRADING

Operating Workflow & Intelligence Architecture


A foundational specification for the MAXONS Trading App,

engineered on Microsoft Business Central and governed through CropsIntel.

Version 1.0

Pilot vertical: Almonds (USA → Dubai → Global re-export)

Framework: Commodity-agnostic, multi-vertical extensible


## Table of Contents


## Part 1 — Business Model & Operating Context

### 1.1 The Three Operating Models of MAXONS

MAXONS does not run a single trading model. It runs three overlapping models simultaneously, each with a distinct cash cycle, risk profile, and operational rhythm. The MAXONS Trading App must serve all three without forcing them into one template — that uniformity is precisely where most off-the-shelf trading systems fail commodity merchants.

#### Model A — Back-to-Back Trading (Customer-Driven Procurement)

A confirmed customer requirement triggers procurement. MAXONS purchases from a US supplier and ships directly to the customer's destination country (Pakistan, India, Turkey, Europe, Middle East). Inventory never lands in Dubai. The risk is execution risk — currency, timing, quality, document compliance — not price risk, because the sale price is already locked when buying.

#### Model B — Speculative Position Trading (Market-Driven Procurement)

MAXONS buys ahead of confirmed demand based on a read of the market. The position is held — sometimes in transit, sometimes in Dubai warehouse, sometimes still at origin — until a customer is matched and the sale is closed. The risk is price risk: the market can move against MAXONS between buy and sell. This model demands a live position book and exposure monitoring.

#### Model C — Local Stock & Distribute (Dubai Inventory Trading)

MAXONS imports stock to its Dubai base, holds it in warehouse, and sells to UAE-based customers (typically traders, retailers, food manufacturers) on shorter cycles and smaller lot sizes than international export. This model demands strong inventory granularity, lot-level traceability, and local credit management.


| Why this matters for the MAXONS App Every screen, every report, every workflow in the MAXONS App must answer the question: which model is this deal in? A back-to-back deal does not need a position book entry; a speculative purchase does. A local Dubai sale does not need international shipping markings; an export shipment does. The model is the single most important attribute of every transaction MAXONS executes. |
|---|

### 1.2 The Pilot Commodity — Almonds

Almonds are the pilot vertical because they are MAXONS's deepest core business and exhibit every operational complexity the platform must handle: multi-origin sourcing, contract complexity (FAS and CIF basis), multi-destination compliance, broker involvement, advance-versus-arrival payment structures, and price volatility. Building for almonds in full forces the framework to be complete.

#### Almond-Specific Trading Context

Origin: United States (predominantly California). Crop year, variety (Nonpareil, Carmel, Independence, Monterey), size grading, and quality classification all materially affect price.

Form: Inshell, shelled, blanched, sliced, slivered, diced — each with its own price ladder and customer segment.

Pricing convention: Quoted in USD per pound (lb), shipped typically in 50 lb cartons, palletized in containers (~44,000 lb per 40' container).

Trade basis: FAS (Free Alongside Ship — supplier delivers to port, MAXONS arranges ocean freight) or CIF (Cost, Insurance, Freight — supplier handles freight to destination port).

Documentation requirements vary by destination: Phytosanitary certificate (USDA), Certificate of Origin, USDA Aflatoxin certificate, Halal certificate (where applicable), Health Certificate, Salmonella certificate (EU), Bill of Lading, Packing List, Commercial Invoice.

Payment patterns: Supplier — predominantly 100% on arrival; occasionally 10–20% advance with balance on arrival; sometimes through bank document presentation. Customer — typically 10–30% advance with balance on arrival; sometimes 100% on arrival; sometimes through bank.

Brokers: Used on both buy-side and sell-side. Commission is fixed at contract time and must be tracked, accrued, and paid post-execution.

### 1.3 Markets & Customer Geography

Each destination market has its own commercial conventions, documentation requirements, payment culture, and credit risk profile. The MAXONS App must encode this country-specific intelligence so that operations teams cannot accidentally ship without the right paperwork or quote without the right cost basis.


| Market | Trade Pattern | Key Considerations | Typical Payment |
|---|---|---|---|
| UAE / GCC | Local distribution + re-export hub | Halal certification, short cycles, local credit terms | Mixed: cash, advance + balance |
| Pakistan | Direct import, container loads | SBP regulations, EIF, import documentation strictness | Advance + balance on arrival; banking common |
| India | Direct import, large volumes | FSSAI compliance, BIS where applicable, GST handling at customer | Advance + balance; LC occasionally |
| Turkey | Direct import, processing market | Customs valuation, food safety regs, currency volatility (TRY) | Mixed; bank documentation common |
| Europe | Direct import, food-grade specifications | Strict salmonella & aflatoxin limits, full traceability, EU phyto | Bank-routed, advance + balance |
| Middle East (ex-UAE) | Direct import + Dubai re-export | Halal, country-specific labelling, holiday season demand | Mixed; trust-based for repeat customers |

### 1.4 The Stakeholder Ecosystem

| Stakeholder | Role | MAXONS App Touchpoint |
|---|---|---|
| US Suppliers (Growers / Hullers / Processors / Exporters) | Source of almond inventory; issue purchase contracts; arrange shipment under CIF; release documents on payment | Supplier portal: contracts, shipment status, payment status, document upload |
| Brokers (Buy-side and Sell-side) | Bring deals, market intelligence, counterparty introductions; earn commission per deal | Broker portal: deals introduced, commissions accrued, settlement status, market notes |
| Customers (Importers, Distributors, Food Manufacturers, Retailers) | Place orders, receive goods, pay against agreed terms | Customer portal: order tracking, shipment visibility, document access, price alerts, statement of account |
| Shipping Lines & Freight Forwarders | Provide ocean freight, container booking, tracking, bills of lading | API integration for live tracking, ETD/ETA updates, container status |
| Banks | Process advance payments, balance payments, document collection (DA/DP), occasional LCs | Integration for payment instruction, document tracking, FX bookings |
| Customs & Regulatory Bodies | Issue clearances, phyto certs, certificates of origin; enforce import regulations | Document repository with destination-specific compliance checklists |
| Insurance Providers | Marine cargo insurance for FAS shipments and any customer-side coverage | Policy register, claim tracking, premium accruals |
| MAXONS Internal Departments | Procurement, Trade Desk, Logistics, Finance, Compliance, CRM/Sales, Document Control, Exception Management | Role-based access to every module of the MAXONS App |


## Part 2 — Organizational Map & Role Architecture

MAXONS today may be operationally lean, but the system must be designed for the organization it intends to become. CropsIntel and the MAXONS App are built around roles, not headcount. Several roles may collapse into a single person initially; what matters is that the role's responsibilities, decision rights, and system permissions are encoded distinctly so the platform scales without rework as MAXONS hires.

| Design principle A role is a bundle of decisions, data access rights, and accountabilities. When MAXONS hires its tenth trader, the role definition does not change — only who occupies it does. This is the difference between a system that scales and a system that has to be rebuilt at each stage of growth. |
|---|

### 2.1 Functional Departments

#### Trade Desk (Procurement & Sales Front-Office)

The commercial brain of MAXONS. Owns price discovery, supplier and customer relationships, contract negotiation, deal structuring, and the buy-versus-sell match. In Model A, the Trade Desk locks the sale first then sources. In Model B, it takes positions and finds the buyer. In Model C, it manages the local Dubai book.

Decision rights: Approve quotes, accept supplier offers, set sale prices, approve broker engagements, approve back-to-back matches, set credit lines (within limit) for repeat customers.

Key system needs: Live margin engine, market price intelligence, position book, customer/supplier intelligence, quote-to-contract automation, broker tracking.

#### Procurement Operations

Once the Trade Desk locks a buy, Procurement Operations executes it: contract issuance to the supplier, shipping instruction collection, marking specifications, supplier follow-up, document chasing, and supplier payment coordination with Finance.

Decision rights: Approve purchase contract drafts, escalate supplier non-performance, approve marking specifications.

Key system needs: Purchase contract templates, supplier portal, shipping instruction workflows, document checklists by supplier.

#### Logistics & Shipment Operations

Owns the physical movement of goods from US port to destination. Books containers (FAS), follows up on supplier-managed bookings (CIF), monitors vessel movements, manages exceptions (delays, rolls, transhipments), coordinates customs clearance at destination, and arranges last-mile delivery.

Decision rights: Choose carriers, negotiate freight rates within authority, approve routing changes, escalate detention/demurrage risks.

Key system needs: Shipment tracking dashboard, carrier API integrations, exception alerts, demurrage/detention forecasting, document workflow.

#### Document Control & Compliance

Often underestimated. Owns the destination-aware document checklist, ensures every shipment carries the right paperwork, manages bank document presentation where applicable, and prevents shipments from progressing without proper compliance. In commodity trading, the document is the goods — without the right docs, the cargo cannot clear, payment cannot be released, and the deal effectively does not exist.

Decision rights: Block shipment release if compliance gaps exist; approve document discrepancies; coordinate with bank on document presentation.

Key system needs: Destination-aware compliance checklists, document repository with version control, bank presentation workflow, audit trail.

#### Finance & Treasury

Manages cash, currency, payments, and receivables. In commodity trading, finance is not a back-office function — it is a deal-enabling function. Working capital availability often determines whether a deal can be done at all. Finance owns landed cost calculation, deal profitability, cash flow forecasting, FX exposure, and bank relationships.

Decision rights: Approve payments to suppliers, approve credit extensions to customers, set FX hedging policy, approve LC issuance.

Key system needs: Landed cost engine, AP/AR aging, cash flow forecast, FX position, BC integration for GL postings.

#### CRM & Sales Support

The customer intelligence layer. Owns the customer master, communication logs, quote history, win/loss tracking, payment behavior scoring, and relationship continuity. In a trader of MAXONS's intended scale, the CRM becomes the most valuable institutional asset — capturing decades of counterparty knowledge that would otherwise live only in individual heads.

Decision rights: Maintain customer master, flag relationship risks, recommend credit limits based on behavior history.

Key system needs: Customer 360, interaction logging, quote tracking, payment behavior analytics, relationship lifecycle management.

#### Exception & Claims Management

Often run as a part-time function in young trading houses, but deserves its own seat as MAXONS scales. Owns disputes (price, quality, short-shipment, delay), insurance claims, demurrage recovery, and the lessons-learned feedback loop into Trade Desk and Operations.

Decision rights: Initiate claims, approve settlements within authority, allocate fault between parties, recommend supplier blacklisting.

Key system needs: Exception register, claim workflow, evidence repository, contract-vs-execution variance engine.

#### Executive / Trade Management

Sets risk appetite, approves large exposures, owns counterparty credit decisions above threshold, reviews position book weekly, signs off on speculative purchases, and chairs the deal review forum.

Decision rights: All approvals above departmental thresholds; counterparty onboarding; risk policy; commission rates.

Key system needs: Position dashboard, exposure heatmap, deal P&L overview, counterparty risk register, audit-grade approval trail.

### 2.2 Decision-Rights Matrix

Every workflow in the MAXONS App routes to the right role at the right time. The matrix below defines the canonical authority structure for the most consequential transactions. Thresholds are illustrative — MAXONS will set actual values during implementation.


| Action | Initiated By | Approved By | System Behavior |
|---|---|---|---|
| Issue purchase quote / contract draft | Trade Desk | Trade Desk Lead (within limit) / Executive (above) | Routes for approval; locks margin assumptions |
| Issue sale contract | Trade Desk | Trade Desk Lead (within limit) / Executive (above) | Auto-checks credit availability for customer |
| Approve supplier payment | Procurement Ops / Finance | Finance Lead (within limit) / Executive (above) | Verifies docs received; routes to BC for posting |
| Extend customer credit beyond standard | Trade Desk / CRM | Finance + Executive | Holds shipment release until approved |
| Accept quality claim from customer | Exception Mgmt | Trade Desk Lead + Executive | Logs against deal P&L; recovers from supplier if applicable |
| Open speculative position (Model B buy) | Trade Desk | Executive | Records into position book with mark-to-market |
| Issue broker commission settlement | Trade Desk / Finance | Finance Lead | Auto-calculates from contract; routes to BC |
| Onboard new counterparty (supplier/customer/broker) | CRM / Trade Desk | Compliance + Finance | KYC checklist completion required before activation |

### 2.3 Departmental Handoff Map

The most expensive failures in commodity trading happen not inside departments but between them. The MAXONS App's job is to make handoffs frictionless and traceable — every transition logged, every responsibility transferred explicitly, no work falling between desks.

Trade Desk → Procurement Ops: When buy is locked. Handoff payload = signed counterparty terms, payment basis, delivery window, marking expectations. System enforces completeness.

Trade Desk → CRM: When sale is locked. Handoff payload = customer requirements, special instructions, credit terms. System triggers customer-side workflow.

Procurement Ops → Logistics: When shipping instructions are confirmed. Handoff payload = booking parameters, container requirements, routing, ETD targets.

Logistics → Document Control: When shipment is in transit. Handoff payload = expected document set per destination checklist.

Document Control → Finance: When documents arrive. Handoff payload = trigger to release supplier payment / receive customer payment.

Finance → Logistics: When customer payment received. Handoff payload = release authorization for cargo.

Any department → Exception Management: When variance detected. Handoff payload = nature of exception, evidence, contract reference, suspected liable party.


## Part 3 — End-to-End Workflows

Each workflow below is documented in a consistent format: business trigger, sequence of steps, role responsible at each step, the corresponding action in Microsoft Business Central (BC), the corresponding action in the MAXONS Trading App (the user-facing layer), the external portal touchpoint where applicable, common exception paths, and the KPIs the workflow is measured by. This is the document that translates business operation into system behavior.

| How to read the workflow specifications BC Action = what the system of record does (data of legal/financial truth). App Action = what the user-facing app does (orchestration, intelligence, UX). Portal = what the external counterparty sees and can do. The split is deliberate: BC is heavy and authoritative; the App is fast, intelligent, and mobile-friendly. Together they form the operating fabric. |
|---|

### Workflow 1 — Price Discovery & Market Intelligence

The starting point of every deal. Without disciplined price discovery, MAXONS cannot quote competitively or buy intelligently. This workflow runs continuously, not per-deal.

#### Trigger

Daily/weekly market cycle, supplier offer arrival, customer enquiry, or proactive market scan.

#### Sequence

Trade Desk reviews incoming supplier quotations and broker market notes; logs each quote into the App with origin, variety, size, basis (FAS/CIF), validity period, and quoted price.

Trade Desk reviews destination market signals (customer enquiry rates, competitor indications, freight indices, currency).

App displays a unified Price Intelligence Board: latest US offer matrix vs. latest destination indication matrix vs. historical curve vs. live freight.

Trade Desk identifies arbitrage windows or buy/sell opportunities and tags them for action.

AI module suggests likely fair-value bands per origin/grade/destination based on rolling history and current signals.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Quote logging | None (App is system of record for offers) | Capture quote; tag supplier, broker, validity | Supplier/broker can submit directly via portal |
| Market signal capture | None | Pull freight rates via API; record customer enquiry levels | — |
| Intelligence display | None | Price Intelligence Board with historical overlay | — |
| Opportunity flagging | None | Tag deals as 'pursue'; trigger downstream quote-to-customer | — |

#### Common Exceptions

Quote validity expired before action — App flags amber 24h before expiry, red on day of expiry.

Conflicting quotes from same supplier via direct vs broker channels — App de-duplicates and surfaces conflict for resolution.

Stale market data (freight or destination indication) — App marks data with timestamp and freshness status.

#### KPIs

Number of active quotes in pipeline.

Average quote-to-action latency.

Win rate of quotes pursued (quote → contract conversion).

Quote quality score (how often actual buy price beat or matched the quote).

### Workflow 2 — Customer Enquiry to Sale Quote

Triggers Model A (back-to-back). Speed and accuracy of quotation directly determine win rate.

#### Trigger

Customer enquiry received (email, WhatsApp, phone, portal, broker introduction).

#### Sequence

CRM/Trade Desk logs enquiry with customer, requested product specification, target quantity, requested delivery window, target destination, payment terms preference.

App's AI assistant proposes draft quote: pulls best available US supplier offer matching spec, computes freight to destination, applies duty/clearing where applicable, applies broker commission if relevant, applies target margin band, produces CIF/CFR price.

Trade Desk reviews, adjusts margin, finalizes quote.

App generates quote document (branded PDF), sends to customer via email/portal/WhatsApp; logs the send event.

App tracks quote status: open, accepted, rejected, expired, counter-offered.

On acceptance, App auto-initiates Workflow 3 (Sale Contract Issuance) and Workflow 4 (Purchase Contract — back-to-back).

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Enquiry capture | None | Log enquiry; link to customer master | Customer can submit enquiry via portal |
| Draft quote | None | AI quote builder with live margin engine | — |
| Quote issuance | None (still pre-contract) | Generate PDF; multi-channel send; log audit event | Customer sees quote in portal |
| Quote tracking | None | Status dashboard, response chasing alerts | Customer accepts/counters in portal |
| Acceptance trigger | Pre-create sales document on accept | Initiate contract workflow | — |

#### Common Exceptions

Customer requests price hold beyond quote validity — Trade Desk decision; App tracks reason and impact on margin.

Quote modified mid-flight — App version-controls quotes; final accepted version becomes contract basis.

Customer requests payment terms outside policy — escalates to Trade Desk Lead with credit history snapshot.

#### KPIs

Time from enquiry to quote sent (target: < 4 working hours for standard specs).

Quote-to-contract conversion rate (overall and per customer).

Average margin on quoted vs realized.

### Workflow 3 — Sale Contract Issuance

When a customer accepts a quote, the sale contract is the legally binding artifact. Every clause matters and every clause must be machine-readable so the contract-vs-execution engine can compare reality against intent later.

#### Trigger

Quote accepted by customer (Model A) OR speculative position pitched and accepted (Model B) OR local Dubai sale agreed (Model C).

#### Sequence

App generates unique Sale Contract Number (e.g., MX-S-2026-00123) with metadata: model type, customer, broker if any, destination.

App pre-populates contract from quote: product spec, quantity, price, basis (FCA/FOB/CIF/CFR/DAP), shipment window, packaging, marking placeholder, payment terms, governing law, dispute resolution, quality arbitration clause.

Trade Desk reviews and edits as needed; routes for approval per Decision-Rights Matrix.

App generates final PDF; sends to customer (email + portal); awaits signature.

On signature receipt, App posts contract to BC as Sales Order with all line items; sets contract status to 'Active — awaiting customer SI'.

App triggers handoff to CRM for shipping instruction follow-up.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Contract numbering | None at this stage | Generate unique number with model tag | Customer sees contract draft in portal |
| Contract drafting | None | Pre-populate from quote; clause library | — |
| Approval routing | None | Multi-level approval per matrix | — |
| Issuance & signature | Create Sales Order on signature | PDF + e-signature + audit log | Customer e-signs in portal |
| Status activation | Sales Order activated in BC | Contract dashboard updates; trigger downstream | Customer sees active contract |

#### Common Exceptions

Customer requests amendment after signature — App routes through formal addendum workflow; both versions retained.

Customer fails to sign within window — App escalates to Trade Desk; contract remains in 'pending signature' for time-bounded period.

Marking instructions delayed — App alerts at T+3 days, T+7 days; Trade Desk decides whether to use default markings or hold.

#### KPIs

Time from quote acceptance to contract signed.

Contract amendment rate (signal of upstream process quality).

Number of contracts active vs in-execution at any time.

### Workflow 4 — Purchase Contract Issuance & Back-to-Back Linking

MAXONS issues its Purchase Contract to the supplier in response to (or in parallel with) the supplier's offer/contract. In Model A, this contract is back-to-back linked to the Sale Contract — the linkage is the audit trail of the trade match and the basis for deal P&L.

#### Trigger

Sale contract signed (Model A) OR Trade Desk decision to take a position (Model B) OR Dubai stock replenishment plan (Model C).

#### Sequence

App generates unique Purchase Contract Number (e.g., MX-P-2026-00456).

If Model A, App auto-links Purchase Contract to Sale Contract; back-to-back ID becomes the deal identifier; deal P&L view becomes immediately live.

App pre-populates Purchase Contract from supplier offer + spec from sale: product, qty, price, basis (FAS/CIF), shipment window, packaging, payment terms, broker if any, broker commission rate.

Trade Desk reviews; routes for approval.

App generates PDF; sends to supplier (email + portal); awaits counter-signature.

On signature, App posts to BC as Purchase Order; sets contract status to 'Active — awaiting supplier shipping instructions request'.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Contract numbering & B2B link | None at this stage | Generate number; create deal linkage (Model A) | — |
| Contract drafting | None | Pre-populate from supplier offer + sale terms | Supplier reviews in portal |
| Approval routing | None | Multi-level approval per matrix | — |
| Issuance & signature | Create Purchase Order on signature | PDF + signature + audit log | Supplier e-signs in portal |
| Status activation | PO activated in BC; commitment posted | Position book updated; deal P&L active | Supplier sees active contract |

#### Common Exceptions

Supplier withdraws after offer accepted but before counter-signature — App escalates; Trade Desk decides on legal recourse and re-sources.

Counter-offer from supplier — App routes amendment back to Trade Desk; if accepted, sale contract may need amendment too (back-to-back integrity check).

Back-to-back margin compression after lock — App flags if landed cost trends erode margin below threshold.

#### KPIs

Time from sale signed to purchase signed (Model A backlash window).

Back-to-back margin slippage (locked margin vs realized margin).

Supplier counter-offer rate.

### Workflow 5 — Shipping Instructions & Markings

The bridge between contracting and physical execution. Errors here propagate through every downstream step; the App must enforce completeness before shipment booking can commence.

#### Trigger

Both Sale Contract and Purchase Contract are active.

#### Sequence

CRM follows up with customer for shipping instructions: consignee details, notify party, port of discharge, final destination, marking artwork, special handling notes, document distribution preferences, any country-specific certificates.

Customer submits SI via portal or email; App validates against destination compliance checklist.

Procurement Ops forwards consolidated SI to supplier, including any MAXONS-specific requirements (logo, lot reference, traceability marks).

Supplier confirms feasibility; if conflicts arise, escalation back to Trade Desk for resolution.

App locks SI version; any subsequent change is a tracked amendment.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| SI request to customer | None | Auto-trigger reminder; template by destination | Customer fills SI form in portal |
| Validation | None | Compliance checklist by destination; mandatory fields enforced | Portal blocks incomplete submission |
| SI to supplier | None | Forward via portal + email; track receipt | Supplier confirms in portal |
| Lock & version | None | SI locked; deal status advances | Both parties see locked SI |

#### Common Exceptions

Customer SI delayed — App escalates at T+3, T+5, T+7; Trade Desk decides whether to invoke contract default clauses.

SI conflicts with destination regulation (e.g., wrong consignee structure for Pakistan import) — App auto-flags from compliance rule library.

Marking artwork late or wrong format — App holds shipment booking; Document Control engaged.

#### KPIs

Average SI turnaround time (contract sign → SI locked).

SI amendment rate after lock.

Compliance rule auto-flag rate.

### Workflow 6 — Pre-Shipment Logistics (FAS Path)

When buy basis is FAS, MAXONS owns the freight booking. This is operationally heavier but commercially advantageous — MAXONS controls timing, carrier choice, and freight cost margin.

#### Trigger

SI locked AND Purchase Contract is FAS basis.

#### Sequence

Logistics requests freight quotes from approved shipping lines / forwarders for the lane (US port → destination port).

App displays quotes side-by-side with route, transit time, sailing schedule, freight cost, surcharges, free time at destination.

Logistics selects carrier; books container; receives booking confirmation with cut-off dates.

App forwards booking to supplier via portal; supplier acknowledges and plans loading.

Supplier loads container; sends loading photos and container/seal numbers to App.

Vessel sails; App captures vessel name, voyage, ETD, ETA via carrier API.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Freight RFQ | None | Multi-carrier quote board | Forwarders quote via portal where integrated |
| Booking | None | Booking captured; cut-offs enforced | — |
| Booking to supplier | None | Auto-forward; SLA on acknowledgment | Supplier acknowledges in portal |
| Loading evidence | None | Loading photos + container/seal logged | Supplier uploads in portal |
| Vessel sailing | Update PO with shipment details | ETA tracking activated; live alerts | Customer sees shipment in motion |

#### Common Exceptions

Booking cancellation by carrier (vessel rolled, blanked) — App alerts; Logistics rebooks; impact on contract delivery window assessed.

Supplier misses cut-off — App flags; carrier may reschedule or charge re-booking fee; cost allocated.

Container availability shortage at origin — App tracks; alternative ports considered.

#### KPIs

Freight cost vs market index per lane.

Booking-to-loading lead time.

On-time loading rate.

### Workflow 7 — Pre-Shipment Logistics (CIF Path)

When buy basis is CIF, the supplier owns the freight booking. MAXONS does not control booking but must monitor closely — the supplier's interests and MAXONS's interests are not perfectly aligned, and silent slippages happen.

#### Trigger

SI locked AND Purchase Contract is CIF basis.

#### Sequence

Supplier confirms intended sailing schedule via portal; App captures planned ETD/ETA.

Logistics monitors against contract shipment window.

On loading, supplier provides container/seal/vessel details and uploads loading evidence.

App ingests carrier data via API; reconciles against supplier-reported figures.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Sailing plan capture | None | Capture supplier-declared schedule | Supplier submits in portal |
| Window monitoring | None | Auto-alert if planned ETD slips beyond window | Supplier flagged of slippage |
| Loading evidence | None | Photos + container/seal logged | Supplier uploads in portal |
| Independent tracking | Update PO with shipment details | Carrier API tracking parallel to supplier reports | Customer sees shipment status |

#### Common Exceptions

Supplier silent on schedule — App escalates at T+3 days post-SI lock if no plan submitted.

Supplier-reported ETD does not match carrier data — App flags variance for Logistics review.

CIF supplier chooses inferior carrier or longer route — App flags transit time anomalies vs. lane benchmarks.

#### KPIs

Supplier ETD compliance vs contract window.

Independent tracking variance rate.

Average actual transit time per supplier per lane.

### Workflow 8 — Shipment Execution & In-Transit Tracking

The phase where MAXONS's only currency is time. The App's role is to make every minute of in-transit visibility available across the team and to predict problems before they manifest.

#### Trigger

Vessel has sailed (loaded on board confirmed).

#### Sequence

App pulls daily updates from carrier API: vessel position, transhipment events, current ETA, port congestion.

App's predictive engine flags risk: ETA slippage, transhipment delays, port congestion at destination, demurrage probability.

Logistics receives proactive alerts; engages supplier (if CIF) or carrier (if FAS) on resolution.

Document Control runs in parallel: BL issued, supplier dispatches docs (courier or bank); App tracks document journey.

Customer sees live shipment status via portal; receives milestone alerts (sailed, halfway, arrived port, customs cleared, delivered).

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Carrier API ingest | None | Auto-poll; cache vessel events | — |
| Predictive risk engine | None | ETA confidence, demurrage forecast | Customer sees confidence band |
| Document tracking | Pre-load doc receipt expectation | Doc journey board (origin → bank → MAXONS → customer) | Both parties see doc status |
| Customer milestone alerts | None | Multi-channel notify (email, portal, WhatsApp) | Customer subscribes to alerts |

#### Common Exceptions

Vessel diversion / port skip — App alerts; Logistics evaluates options including transhipment costs.

Document delay (BL not received before vessel arrival) — App escalates; risks demurrage at destination.

Customs hold at destination — Document Control engages clearing agent; App logs cause and time-to-resolve.

#### KPIs

ETA forecast accuracy (predicted vs actual arrival).

Demurrage incidents and total cost per quarter.

Document arrival lead time vs vessel arrival.

### Workflow 9 — Document Flow & Bank Routing

In commodity trading, control of documents equals control of cargo. This workflow encodes the discipline that keeps MAXONS commercially safe.

#### Trigger

Cargo on board; documents being prepared by supplier.

#### Sequence

Supplier prepares document set per destination checklist: BL, Commercial Invoice, Packing List, Phytosanitary, COO, USDA Aflatoxin Cert, Halal Cert (if applicable), Health/Salmonella Cert (EU), Insurance Cert (CIF only), any country-specific extras.

App's destination compliance engine validates the checklist; flags any missing or non-compliant document.

Routing decision: direct courier to MAXONS (predominant case), or bank presentation (DA / DP / LC route).

If direct courier: docs arrive MAXONS; Document Control verifies; routes to Finance for payment release.

If bank: docs arrive at MAXONS's bank; bank notifies; MAXONS reviews; pays/accepts; bank releases docs.

On document possession, MAXONS releases originals to customer (after customer payment) OR sends BL/telex release for cargo collection.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Document preparation | None | Supplier-side checklist enforcement | Supplier uploads draft docs in portal |
| Compliance check | None | Destination rule engine validates | Supplier sees pass/fail per item |
| Routing | None | Capture routing path; set expected timeline | Both parties see routing |
| Receipt & verification | None until verified | Original received logged; verification checklist | — |
| Payment release trigger | Post AP payment in BC | Auto-handoff to Finance with verified docs | Supplier sees payment status |
| Customer release | Post AR receipt in BC | Doc release tracked; courier waybill logged | Customer sees doc release status |

#### Common Exceptions

Document discrepancy at bank — App flags; supplier asked to correct; potential for delay payment.

Customer pays late — App holds doc release; demurrage clock at destination ticking; escalation policy.

Original lost in courier — App initiates LOI process with bank; supplier provides indemnity.

#### KPIs

Document compliance rate (first-time-right at supplier).

Document cycle time (preparation → MAXONS receipt).

Discrepancy resolution time.

### Workflow 10 — Arrival, Customs Clearance, Delivery

The final mile. Most operationally complex for Model C (Dubai inventory) since stock has to be received, quality-checked, and put away. For Models A and B, this phase is mostly delivery confirmation.

#### Trigger

Vessel arrived at destination port.

#### Sequence

App captures arrival timestamp from carrier; alerts Logistics.

Customs clearance commences — clearing agent (MAXONS-appointed for Model C and most Model A export markets; customer-side for some Models A) submits docs.

Clearance confirmed; cargo released from port.

Model C: cargo delivered to MAXONS Dubai warehouse; Inventory Ops receives, quality-checks, puts away; lot records created/updated.

Models A/B export: cargo released to customer per contract; delivery confirmation received.

App marks shipment as 'Delivered'; deal moves to financial closure phase.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Arrival capture | None | Auto-update from carrier; alert Logistics | Customer alerted of arrival |
| Clearance tracking | None until duty paid | Clearing agent updates; days-at-port counter | — |
| Warehouse receipt (Model C) | Inventory receipt posted in BC | Lot creation; quality check log; put-away | — |
| Customer delivery (Models A/B) | Sales fulfillment in BC | Delivery confirmation; receipt evidence | Customer signs off in portal |
| Shipment closure | Status update in BC | Deal moves to financial close phase | Both parties see deal status |

#### Common Exceptions

Customs hold — App tracks reason; Document Control engaged; demurrage risk monitored.

Quality issue at receipt (Model C) — App initiates claim workflow with supplier.

Customer rejection at delivery (Models A/B) — App initiates dispute workflow; cargo disposition decision.

Short-shipment vs contract qty — App auto-detects and triggers claim workflow.

#### KPIs

Average days at port (arrival → release).

Quality incident rate at receipt.

Customer delivery sign-off time.

### Workflow 11 — Payment Cycles (Supplier and Customer)

Payments are not just finance events — they are control points. Holding payment is leverage; releasing payment is commitment. The App must give Finance and Trade Desk full visibility on the trade-off at every moment.

#### Supplier Payment Patterns

Pattern A — 100% on arrival: App holds payment; cargo arrival triggers payment review; Finance pays; supplier releases originals/telex.

Pattern B — 10-20% advance + balance on arrival: App releases advance on contract sign; balance follows arrival pattern.

Pattern C — Bank document presentation (DA/DP): Bank receives docs; notifies MAXONS; Finance reviews; pays per terms; bank releases docs.

#### Customer Payment Patterns

Pattern A — 10-30% advance + balance on arrival: App invoices advance on contract sign; balance invoice on shipment; release on payment.

Pattern B — 100% on arrival: App invoices on shipment; full payment before release.

Pattern C — Bank route: Docs presented to customer's bank; bank handles per terms.

#### Sequence (per pattern, generalized)

App tracks payment events against contract milestones.

Finance receives auto-routed approval requests with full context (contract, shipment status, doc status, counterparty payment history).

Approved payment instruction sent to bank; payment confirmation captured.

BC posts AP/AR entries with full audit trail.

App updates deal P&L, cash forecast, counterparty payment behavior score.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Payment trigger detection | None | Auto-detect milestone hit; route to Finance | Counterparty sees payment expected status |
| Approval routing | None | Approval workflow with full context | — |
| Bank instruction | Pre-stage payment in BC | Send instruction; track confirmation | — |
| Confirmation & posting | AP/AR entry posted in BC | Update deal P&L; behavior scoring | Counterparty sees paid status |

#### Common Exceptions

Customer payment late — App escalates per dunning policy; Trade Desk and Executive engaged at thresholds.

FX volatility between invoice and payment — App tracks exposure; Treasury hedges per policy.

Bank delay in fund transfer — App tracks; Finance escalates with bank.

#### KPIs

Days Sales Outstanding (DSO) per customer and overall.

Days Payable Outstanding (DPO) per supplier.

Payment-on-time rate per counterparty.

FX gain/loss per deal.

### Workflow 12 — Broker Commission Lifecycle

Brokers are commercial partners, not vendors. They bring deals, market intelligence, and relationships. The App treats brokers as first-class counterparties with their own portal, performance dashboard, and commission ledger.

#### Sequence

Broker engagement logged at deal origination; commission rate captured (per pound, percentage of value, flat fee, etc.).

Commission auto-accrued in App as deal progresses through milestones.

Commission becomes payable per contracted trigger (typically deal closure / payment received from customer).

App routes settlement to Finance for approval and payment.

Broker sees commission status in portal; receives statement at agreed cadence.

Broker performance metrics maintained: deals introduced, win rate, average margin, settlement timeliness.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Engagement log | None | Broker linked to deal; rate captured | Broker confirms in portal |
| Accrual | Provision in BC if material | Live accrual in deal P&L | Broker sees accrued commission |
| Settlement trigger | AP entry | Auto-route to Finance | — |
| Payment | AP payment in BC | Statement issued | Broker sees payment status |
| Performance metrics | None | Broker scorecard maintained | Broker sees own scorecard |

### Workflow 13 — Inventory Movement (Model C Focus)

Dubai inventory is a profit-center in its own right — buying volume to spread costs, holding for opportunistic sales, blending across lots and origins. The App treats inventory at lot level, not aggregate level, because lot-level traceability is what allows quality claims and FIFO discipline.

#### Inventory Granularity

Item (e.g., Almond Nonpareil 23/25 inshell).

Origin (e.g., USA / California / Specific supplier).

Crop year.

Lot number (links back to specific shipment, BL, supplier invoice).

Quality grade and any quality test results.

Status: Available / Committed / Quarantined / Reserved-for-deal.

Aging (days in warehouse).

Landed cost (full landed including freight, duty, clearing, insurance).

#### Sequence

Inbound: shipment arrives; quality check; lot created in App; pushed to BC inventory.

Reservation: when sale contract is issued from inventory, lot reserved; available qty reduced.

Outbound: lot picked, packed, dispatched; inventory reduced in BC; sale fulfilled.

Aging monitoring: weekly aging report; flags slow-moving lots; Trade Desk decides on action (price-down, blend, re-export).

#### System Mapping

| Step | BC Action | App Action |
|---|---|---|
| Inbound receipt | Inventory receipt posted; landed cost calculated | Lot record created with full context |
| Reservation | Reservation in BC sales | Available vs Committed view live |
| Outbound | Inventory reduction posted | Sale fulfilled; FIFO/LIFO logic applied |
| Aging | None (App-side) | Weekly aging dashboard; alerts on thresholds |

### Workflow 14 — Position Book & Exposure Management (Model B Focus)

When MAXONS buys without a confirmed sale, it has a position. Position management is the discipline that prevents speculation from becoming gambling. The App's Position Book is a continuously updated view of every open exposure, marked to current market, with attribution by trader, by origin, by destination potential.

#### Position Book Dimensions

Long positions: bought, not yet sold (in-transit + in-warehouse + at-origin).

Short positions: sold but not yet purchased (rare for almonds; relevant if MAXONS sells against expected forward purchase).

Net position by item / grade / origin.

Average cost basis.

Current market value (mark-to-market).

Unrealized P&L.

Days held.

Trader attribution.

#### Sequence

Position Book updates in real time as buys and sells are contracted.

Daily mark-to-market: App pulls latest market prices; recomputes unrealized P&L.

Risk alerts: position exceeds limit, holding period exceeds policy, unrealized loss exceeds threshold.

Weekly Position Review meeting: Executive + Trade Desk Lead; decisions on hedging, accelerated selling, holding.

#### System Mapping

| Step | BC Action | App Action |
|---|---|---|
| Position update | None | Real-time Position Book recalculation |
| Mark-to-market | None | Daily MtM with audit trail of price source |
| Risk alerts | None | Limit breach notifications; Executive escalation |
| Position Review reporting | None | Weekly board pack auto-generated |

### Workflow 15 — Exception & Claims Management

Every operational variance is an exception event. The App ensures every exception is logged, owned, and resolved — and that the lessons feed back to upstream processes.

#### Exception Categories

Shipment delay / rerouting: Vessel rolled, transhipment delay, port congestion. Cost: demurrage, customer dissatisfaction.

Quality claim: Customer reports off-spec product. Cost: discount, replacement, full reject.

Short shipment: Container loaded short of contract qty. Cost: pro-rata refund, customer recourse.

Document discrepancy: Bank rejects docs; customs holds cargo. Cost: delay, demurrage, possibly L/C non-payment.

Price dispute: Counterparty challenges contract price interpretation. Cost: legal, relationship.

Demurrage / detention: Container held beyond free time. Cost: per-day charges from carrier.

Currency / payment failure: Bank reject, FX shortage, payment held. Cost: cash flow, supplier relationship.

#### Sequence

Exception logged by any role with full context (deal ID, contract ID, evidence, suspected fault).

Exception Manager assigns owner; sets SLA for resolution.

Investigation: gather evidence, contract clauses, third-party reports.

Resolution: settlement amount agreed; recovery from responsible party (supplier/carrier/insurance).

Posted to deal P&L; counterparty performance score updated; lesson logged for upstream feedback.

#### System Mapping

| Step | BC Action | App Action | Portal Touchpoint |
|---|---|---|---|
| Exception capture | None | Exception register; evidence repo | Counterparty notified in portal |
| Owner assignment | None | Workflow routing with SLA | — |
| Investigation | None | Evidence aggregation; clause linkage | Counterparty submits evidence in portal |
| Resolution | Adjustment posted in BC | Deal P&L impact; recovery tracking | Counterparty acknowledges in portal |
| Lesson logging | None | Knowledge base entry; process feedback | — |

#### KPIs

Open exception count and aging.

Resolution time per category.

Recovery rate (claimed vs recovered).

Repeat-cause analysis (which exceptions recur most).


## Part 4 — The Intelligence Layer (Built First)

Per the strategic decision to build intelligence-first, this part specifies the AI and analytics modules that distinguish MAXONS from a generic ERP-driven trader. Each module is designed as a service that consumes data from BC and from the App's own transactional store, performs computation, and exposes results to users through dashboards, alerts, and decision-support prompts.

| The intelligence-first sequencing rationale An ERP captures what happened. An intelligence layer changes what happens next. By building the intelligence modules in v1 — even with thin transactional foundations — we force the data architecture to support analytics from the start, rather than retrofitting after the fact. The risk is that early intelligence is only as good as the data feeding it; the mitigation is rigorous data quality discipline in BC and the App from day one. |
|---|

### 4.1 The Live Margin Engine

The single most-used screen in the MAXONS App. Every deal — from the moment a quote is drafted to the moment the deal is closed — has a live margin number on it. Three views, all visible simultaneously.

#### The Three Margins

Contracted Margin: What was locked in at the moment of signing. Sale price minus all costs at contract execution. This is the commitment.

Mark-to-Market Margin: What the deal would be worth if executed at today's market. Sale price minus today's replacement cost (current US offer + current freight + current duty + current FX). This is the live signal.

Realized Margin: What the deal actually delivered. Final sale price minus full landed cost minus all variances (demurrage, claims, FX impact). This is the truth.

#### Cost Components Tracked

FOB / FAS / CIF supplier price (per unit).

Ocean freight (per unit, prorated).

Marine insurance (CIF supplier-paid OR MAXONS-arranged FAS).

Destination port charges, THC, clearance.

Duty (per destination tariff schedule).

Local logistics to customer warehouse (or to MAXONS Dubai for Model C).

Broker commission (buy-side and sell-side).

Cost of capital on advance payments (financing rate × advance × days held).

Provision for demurrage risk (probability-weighted).

Quality reserve (probability-weighted).

FX impact on non-USD legs.

#### Decision Support Use Cases

Quote stage: Trade Desk sees margin floor before sending; cannot send below threshold without override.

In-transit: alert if MtM margin compresses below trigger (signal to negotiate, hedge, or accept reality).

Post-deal: variance analysis between contracted and realized — root-cause attribution.

### 4.2 The Position Book & Exposure Engine

Specified in Workflow 14 from an operations perspective; here we specify the intelligence layer.

#### Live Computations

Net long/short position by item, grade, origin, crop year.

Weighted average cost basis.

Mark-to-market against latest market reference (configurable per commodity).

Unrealized P&L per position and aggregate.

Days held distribution; aged exposure.

Concentration risk (% of book in any single origin, grade, customer pipeline).

#### Risk Triggers

Position size exceeds policy limit (per item, per origin, total).

Days held exceeds policy.

Unrealized loss exceeds threshold (1%, 3%, 5% of cost basis tiered).

Mark-to-market trend negative for N consecutive days.

#### Decision Support

Suggested actions when triggers fire: accelerate sell, hold, hedge, blend.

Hedge candidate identification when market moves correlate to known instruments.

Customer pipeline matching: given an open position, who in CRM has historically bought this spec at viable price?

### 4.3 Customer & Supplier Intelligence Graph

Over time, this becomes MAXONS's most valuable institutional asset. Every interaction with every counterparty is captured, scored, and made queryable.

#### Customer Profile Dimensions

Lifetime volume and value.

Product mix (which grades, which origins).

Quote-to-order conversion rate.

Average order size and frequency.

Payment behavior score: on-time rate, average days late, dispute frequency.

Quality complaint frequency.

Margin contribution (high-margin customers vs price-sensitive).

Seasonality (when does this customer typically buy?).

Sensitivity to price changes (how does demand from this customer respond to market moves?).

Decision-maker map and relationship strength.

#### Supplier Profile Dimensions

Total volume sourced; share of MAXONS purchases.

On-time shipment rate.

Quality compliance rate (claim incidence).

Document quality (first-time-right rate).

Pricing competitiveness vs market average.

Responsiveness (quote turnaround time).

Reliability under stress (performance during shortages, port disruptions).

#### Broker Profile Dimensions

Deals introduced and conversion rate.

Average margin on broker-sourced deals.

Quality of market intelligence provided.

Settlement timeliness.

Conflict-of-interest red flags (e.g., representing both sides).

#### Use Cases

Quote prioritization: which customer gets quoted first when supply is tight?

Credit decisions: behavior-based, not just balance sheet.

Supplier selection: who do we buy from this season given expected market conditions?

Account planning: where to invest sales effort for highest return.

### 4.4 Market Price Intelligence

MAXONS's external market view, structured. Continuously aggregated from supplier offers, broker notes, customer indications, and external data sources.

#### Data Capture

Every supplier offer logged with timestamp, validity, basis, full spec.

Every broker market note logged with attribution.

Every customer indication logged with destination.

Freight rate API ingestion per major lane.

USDA reports and other public price references where available.

#### Outputs

Live price curve per origin / grade / size / form.

Destination price curves where data permits.

Implied basis (US price vs destination price minus freight) — the arbitrage signal.

Volatility metrics (standard deviation, range over rolling windows).

AI commentary: weekly summary of market direction, outliers, and emerging signals.

### 4.5 Contract-vs-Execution Variance Engine

The unsung hero. For every executed deal, the engine compares every clause of the contract to what actually happened — and surfaces every deviation, with attribution.

#### Variance Dimensions Tracked

Quantity: contracted vs shipped vs delivered (short-shipment detection).

Quality: contracted spec vs actual test results (claims trigger).

Shipment window: contracted vs actual ETD (delay attribution).

Marking compliance: contracted artwork vs actual.

Document timeliness: contracted document handover vs actual.

Payment timeliness: contracted vs actual on both sides.

Price: contracted vs invoiced (any unauthorized adjustment).

#### Outputs

Per-deal compliance scorecard.

Counterparty-level compliance trend.

Auto-generated claim drafts when material variance detected.

Aggregate analytics: which contract clauses get violated most? Where is contractual rigor failing?

### 4.6 AI-Assisted Workflows

Specific points in the operational flow where generative AI and machine learning add value. Not AI for AI's sake — each application is targeted at a real time-sink or error-source.

#### Quote Drafting Assistant

Given an enquiry, the AI proposes a draft quote: pulls best-fit supplier offer, computes freight, applies historical margin band for that customer, drafts the response email or PDF. Trader reviews and adjusts. Time saved per quote: 20-40 minutes.

#### Contract Drafting Assistant

Pre-fills purchase and sale contracts from the quote and supplier offer. Highlights any non-standard clauses for review. Flags inconsistencies between buy-side and sell-side terms in back-to-back deals (e.g., shipment window on buy doesn't allow delivery window on sale).

#### Document Classification & Extraction

Incoming documents (BL, phyto, COO, invoices) classified automatically; key fields extracted (vessel, ETA, qty, lot, certificate numbers). Reduces manual data entry and indexing.

#### Anomaly Detection

Patterns that humans miss: a supplier whose quality scores are silently declining; a customer whose payment dates are slipping by 1-2 days each cycle; a freight rate that's drifting out of band; a deal whose margin is eroding faster than its peers. The AI surfaces these proactively.

#### Conversational Interface for Operational Queries

Natural language Q&A across all data: "What's my exposure on Nonpareil 23/25?", "Which customers haven't ordered in 90 days?", "What was the margin on deal MX-2026-00045?", "How is the Pakistan market moving this week?". Powered by the underlying data layer with strict role-based access enforcement.

#### Predictive ETA

Beyond carrier-stated ETA, a model that incorporates carrier reliability history, port congestion, transhipment patterns, and seasonal effects to provide a confidence band around arrival predictions. Drives demurrage prevention and customer expectation management.


## Part 5 — External Portal Specifications

Per the strategic decision to launch external portals with v1 (rather than defer), the foundation must be designed for trust and safety from day one. Three portals: Customer, Supplier, Broker — each with strict permission boundaries and full audit trail.

| Security & data isolation principle External users see only their own data. A customer never sees another customer's prices. A supplier never sees what MAXONS resold their product for. A broker sees only the deals they are attached to. Role-based access is enforced at the data query layer, not just the UI layer — so an attempt to bypass UI controls cannot leak data. |
|---|

### 5.1 Customer Portal

#### Capabilities

Live order tracking: every contract from sign to delivery, with milestone progression and ETA.

Document hub: access to BL, invoice, packing list, certificates per shipment.

Quote requests: submit new enquiries; view active quotes with accept/counter actions.

Statement of account: live AR position, aging, advance balances, payment history.

Price alerts: subscribe to receive notifications when MAXONS quotes a price within target range.

Shipping instruction submission: upload SI directly with destination-aware validation.

Communication log: centralized history of communications and decisions.

Claims & disputes: submit claims with evidence; track resolution status.

#### Data Visibility Boundaries

Sees: their own contracts, shipments, documents, statements, quotes.

Does not see: cost basis, MAXONS margins, other customers' data, supplier identity (unless explicitly shared).

### 5.2 Supplier Portal

#### Capabilities

Active contract dashboard: all open POs with shipment requirements, deadlines, special instructions.

Shipping instructions delivery: receive consolidated SI from MAXONS; acknowledge feasibility.

Loading evidence upload: container photos, seal numbers, vessel details.

Document upload: draft documents for compliance pre-check; final originals tracking.

Quote submission: respond to RFQs; submit unsolicited offers.

Payment status: expected payment dates, paid status, statement of account.

Performance scorecard: MAXONS-shared view of supplier's reliability metrics (transparency drives improvement).

#### Data Visibility Boundaries

Sees: their own contracts, payments, performance metrics.

Does not see: customer identity (unless shipping direct under back-to-back transparency), MAXONS sale prices, other suppliers.

### 5.3 Broker Portal

#### Capabilities

Deal pipeline: all deals broker is attached to with stage and status.

Commission accruals: live view of commission earned per deal.

Settlement statements: history of paid commissions; expected upcoming.

Market notes submission: structured submission of market intelligence.

Performance scorecard: deals introduced, win rate, settlement metrics.

#### Data Visibility Boundaries

Sees: deals where they are the broker of record.

Does not see: deals where another broker (or no broker) is attached, full margins, internal cost data.

### 5.4 Portal Architecture Common Elements

Single sign-on; multi-factor authentication mandatory.

Granular role-based access within each portal (a customer may have multiple users with different rights — buyer, finance, logistics).

Mobile-responsive; native apps for high-engagement segments (likely customer first).

Multi-language support (English + key local languages over time: Arabic, Urdu, Turkish).

Notification preferences: email, SMS, WhatsApp, in-app, configurable per event type.

Full audit log: every view, every action, by every external user.


## Part 6 — Integration Architecture

### 6.1 The BC ↔ App Boundary

Microsoft Business Central is the system of legal and financial record. The MAXONS Trading App is the operating layer. The boundary between them is one of the most important design decisions — getting it wrong creates either duplicate data, integration brittleness, or both.

#### Lives in BC (system of record)

Master records: General Ledger, Chart of Accounts, Customer Master (legal entity), Vendor Master (legal entity), Item Master.

Financial transactions: Sales Orders, Purchase Orders (once contractually executed), AP/AR entries, GL postings, inventory valuations.

Inventory ledger: stock movements, lot data, valuation.

Statutory and audit reporting: trial balance, P&L, balance sheet, tax positions.

#### Lives in the MAXONS App (operating system)

Quotes (pre-contract).

Enquiries and the quote-to-order pipeline.

Communication logs and CRM interactions.

Counterparty intelligence profiles (operational, not legal).

Shipment tracking events.

Document repository and compliance state.

Position book and mark-to-market computations.

Deal P&L (computed, sourced from BC + App).

Exception register and claims workflow.

Broker attribution and commission accruals.

Market intelligence repository.

AI-generated drafts, alerts, and insights.

All external portal interactions.

#### Synchronization Patterns

App → BC: when a quote is accepted, App posts a Sales Order to BC. When a supplier offer is contracted, App posts a Purchase Order to BC. App writes inventory receipts and dispatches to BC.

BC → App: financial postings (AP payments, AR receipts) flow back to App for deal P&L computation. Inventory valuation flows back for landed cost. Master data changes flow back to App.

Conflict resolution: BC is authoritative on financials and master data; App is authoritative on operational and pre-contract data. Where overlap exists (e.g., a contract amended in BC after sync), the App pulls and reconciles.

Sync mechanism: real-time API for high-priority events (contract activation, payment posting); batch sync for non-time-critical (master data updates). Idempotent design to prevent duplicate posts on retry.

### 6.2 External API Integrations

#### Shipping Lines & Forwarders

INTTRA / Project44 / Cargosmart for multi-carrier visibility.

Direct EDI with major carriers (Maersk, MSC, CMA CGM, Hapag-Lloyd) for booking and tracking.

Vessel position data for predictive ETA.

#### Banking

Payment instruction APIs (where bank supports) for outgoing payments.

Bank statement ingestion for reconciliation (MT940 / Open Banking).

L/C status tracking where applicable.

FX rate feeds and booking confirmations.

#### Communication Channels

Email: SMTP send + IMAP/Graph API receive for inbound enquiry parsing.

WhatsApp Business API for customer notifications and quote distribution.

SMS gateway for high-priority alerts.

#### Document Management

Cloud storage (Azure Blob / SharePoint / Box) for document repository.

OCR / document AI for incoming document parsing.

E-signature platform (DocuSign / Adobe Sign) for contract execution.

#### Market Data

USDA reports ingestion.

Freight rate indices (Freightos, Xeneta where licensed).

FX rate feeds.

Commodity-specific indices as MAXONS expands beyond almonds.

### 6.3 The CropsIntel ↔ MAXONS App Relationship

CropsIntel is not a feature of the MAXONS App. It is a separate platform that observes and governs the MAXONS App (and, in time, other client trading houses). The relationship is engineered as follows.

#### CropsIntel Reads From the MAXONS App

Workflow telemetry: which workflows are running, where bottlenecks occur, average cycle times, exception rates.

Departmental interaction patterns: who hands off to whom, where re-work happens.

Adoption and usage metrics: which features are used, by whom, how often.

Aggregate KPIs (anonymized at counterparty level for benchmarking).

#### CropsIntel Provides Back to the MAXONS App

Best-practice workflow templates derived from observed patterns across clients.

UX recommendations based on interaction analytics.

Benchmarking: how MAXONS's KPIs compare to the broader trading-house cohort (anonymized).

Configuration and rollout management for new modules.

#### Data Sovereignty

MAXONS's transactional data does not leave MAXONS's tenant. CropsIntel works on metadata, anonymized aggregates, and explicitly shared insights.

Customer/supplier-identifiable data is never transmitted to CropsIntel.

MAXONS retains contractual right to disable any CropsIntel data flow at any time.


## Part 7 — Phased Build Roadmap

The roadmap balances ambition with engineering reality. v1 establishes the operational backbone with intelligence-first hooks; v2 deepens the intelligence and external portals; v3 expands across commodities and adds the most advanced capabilities.

### 7.1 v1 — Foundation (Months 1–6)

#### Scope

BC integration layer (master data sync, sales/purchase order posting, AP/AR sync).

Quote-to-contract workflow (Workflows 2, 3, 4).

Shipping instructions and basic logistics (Workflows 5, 6, 7).

Document repository with destination-aware compliance checklist.

Live margin engine (basic — contracted and realized; MtM in v1.5).

Counterparty registry with basic profiles.

Internal user roles and permissions.

Customer portal v1 (order tracking, document hub).

Email notifications and basic WhatsApp.

#### Success Criteria

100% of new almond deals contracted through the App.

Document compliance failure rate reduced by 50% vs baseline.

Trade Desk reports time savings on quoting > 30%.

### 7.2 v2 — Intelligence & External Reach (Months 7–12)

#### Scope

Mark-to-market in margin engine; full live margin operational.

Position book with risk alerts.

Customer/supplier intelligence graph with behavior scoring.

Contract-vs-execution variance engine.

Shipment tracking with carrier API integration.

Predictive ETA model.

Supplier portal v1.

Broker portal v1.

Customer portal v2 (quote requests, statements, claims).

AI quote drafting assistant.

Document classification & extraction.

Exception management module.

#### Success Criteria

> 50% of customer interactions through portal.

MtM signal causing measurable improvement in deal-level margin discipline.

Position book preventing at least one significant exposure incident.

### 7.3 v3 — Scale & Expansion (Months 13–24)

#### Scope

Multi-commodity rollout (cashews, pistachios, walnuts, dates, then expand).

Advanced AI: anomaly detection, conversational interface, market commentary.

Banking integration for payment instructions.

L/C and bank document workflow automation.

Mobile native apps.

Advanced analytics and executive dashboards.

CropsIntel benchmarking and best-practice library mature.

#### Success Criteria

Second commodity vertical fully operational with no codebase fork.

Conversational interface used by > 50% of internal users weekly.

MAXONS positioned as a tech-forward trading house in market reputation.

### 7.4 What Is NOT in v1

Equally important to declare. The following are deliberately deferred to keep v1 focused and achievable.

Full position book with mark-to-market (basic position visibility only in v1).

Predictive ETA (uses carrier-stated ETA in v1).

AI conversational interface (deferred to v3).

Multi-commodity (almonds only in v1).

Banking payment instruction APIs (manual instruction in v1).

Native mobile apps (responsive web in v1 and v2).


## Part 8 — CRM Deep Dive: The Strongest Pillar

CropsIntel's stated strategic ambition is to give MAXONS the strongest CRM for a future huge-sized trader. This section is a standalone deep dive on what that means — what 'strongest' looks like in the context of a commodity trading house, and how every other module of the MAXONS App feeds into the CRM rather than the other way around.

| The CRM thesis for MAXONS In commodity trading, the CRM is not a sales tool. It is an institutional memory system. A trader's true asset is the depth of their counterparty knowledge — and in most trading houses, that knowledge lives in individuals' heads and walks out the door when they leave. The strongest CRM captures this knowledge structurally so that MAXONS, the institution, owns it — and so a new hire on day one inherits decades of accumulated intelligence about every counterparty MAXONS has ever touched. |
|---|

### 8.1 The Three CRM Layers

#### Layer 1 — The Transactional Layer (Standard CRM)

The conventional capabilities expected of any CRM: contact management, account hierarchy, opportunity tracking, activity logging, pipeline view. This is necessary but commoditized — every CRM has it. MAXONS's CRM has it correctly executed, but this is not where differentiation lives.

#### Layer 2 — The Intelligence Layer (The Counterparty Graph)

This is where the MAXONS CRM begins to be strong. Every counterparty has a behavioral profile derived from actual trading history, not from sales-rep notes. Payment behavior, quality complaints, quote-to-order patterns, seasonality, sensitivity to price moves, decision-maker mapping. These profiles are computed continuously and made queryable.

#### Layer 3 — The Decision Support Layer (CRM as Co-Pilot)

This is where MAXONS pulls ahead. The CRM does not just record interactions — it proactively recommends them. "Customer X hasn't placed an order in 60 days, which is 30 days longer than their average gap; they typically buy Nonpareil 23/25 at this time of year; current US offer is in their historical buy band; suggest reaching out today." "Supplier Y has had two quality complaints in the last 90 days, double their historical rate; flag for sourcing diversification." The CRM becomes a daily co-pilot for the Trade Desk.

### 8.2 The Customer 360 View

A single screen that, when a trader pulls up a customer, shows everything that matters.


| Section | Contents |
|---|---|
| Header | Customer name, country, account manager, relationship age, total lifetime value, current AR balance, status |
| Trading Pattern | Volume by year, product mix, average order size, seasonality heatmap, preferred origins |
| Behavioral Scoring | Payment on-time %, average days late, dispute frequency, quality complaint rate, communication responsiveness |
| Active Pipeline | Open enquiries, active quotes, signed contracts in progress, in-transit shipments |
| Financial | Lifetime margin contribution, current credit limit and utilization, advance balance, statement |
| Intelligence | Sensitivity to price moves, AI-suggested next-best action, alerts on behavior changes |
| Decision-Maker Map | Contacts at customer with role, relationship strength, last interaction |
| Communication Log | Chronological feed of all interactions across all channels |
| Documents | All documents ever shared (quotes, contracts, shipments, statements) |
| History | Full deal history with margin per deal and any exceptions |

### 8.3 The Customer Lifecycle Management Model

Every customer is in one of these states. The CRM tracks transitions and prompts the right action at the right state.

Prospect: identified but not yet transacted. Goal: first deal.

Trial: first 1-3 deals. Goal: prove reliability and build trust.

Active: regular trading rhythm established. Goal: grow share-of-wallet.

Strategic: high-value, multi-deal-per-year, deep relationship. Goal: lock in long-term partnership and protect from competition.

At-Risk: frequency declining or behavior deteriorating. Goal: diagnose and recover.

Dormant: no transaction in defined window. Goal: re-activate or de-prioritize.

Lost: explicit churn or extended dormancy. Goal: post-mortem and learnings.

### 8.4 Quote-to-Cash Visibility

The CRM ties everything together so the customer's full journey is visible in one place: enquiry → quote → contract → shipment → delivery → invoice → payment → next enquiry. No more siloed views. No more 'who's handling this customer right now?' confusion.

### 8.5 What Makes This CRM Strongest for a Future Huge-Sized Trader

#### Structural Capture of Tacit Knowledge

When a trader leaves MAXONS, their knowledge stays. The behavioral profiles, the decision-maker maps, the communication patterns — all institutional. New traders are productive in weeks, not years.

#### Scale-Invariant Architecture

The CRM works the same with 50 customers as with 5,000. No 're-platform at scale' moment. Every workflow, every intelligence module, every dashboard scales linearly.

#### Cross-Commodity Reusability

When MAXONS adds cashews next to almonds, the CRM doesn't care. Customer profiles span commodities. Supplier relationships span commodities. The same intelligence engine works on the new vertical from day one.

#### Embedded in Operations, Not Adjacent

Most CRMs are sales-team tools, separate from operations. The MAXONS CRM is the connective tissue across Trade Desk, Operations, Finance, and Compliance. Every department contributes to and benefits from the same counterparty intelligence.

#### External Portal Extension

The CRM extends out to the customer themselves through the Customer Portal. Customers manage their own quote requests, see their own statements, submit their own SI. The CRM is not just inward-looking — it's the spine of MAXONS's external presence.


## Closing — How This Document Should Be Used

This is a foundational document, not a final specification. Three audiences will use it differently:

Cowork (Workflow Understanding): Read Parts 1, 2, and 3 to understand how MAXONS operates and how employees interact across departments. Use this as the basis for designing the CropsIntel UI for governing the MAXONS implementation.

MAXONS App Designers & Developers: Read Parts 3, 4, 5, 6, 7. Translate workflows into screens, intelligence specs into engineering tasks, integration architecture into technical contracts.

MAXONS Leadership: Read Parts 1, 7, 8 to confirm strategic direction, sequencing, and the CRM ambition. Approve the v1 scope and timeline.

### Next Steps

Confirm v1 scope and timeline with MAXONS leadership.

BC data quality audit: assess what exists, what's clean, what needs work before integration.

Walk-throughs of the next commodity verticals (cashews, pistachios, etc.) — using the framework here as the template.

Detailed UX wireframing for the v1 modules — informed by Cowork's understanding of how employees actually work today.

Identification of v1 pilot users (which traders, which customers) for early portal testing.



End of Document — Version 1.0

MAXONS Trading × CropsIntel | Almonds Pilot | Commodity-Agnostic Framework

