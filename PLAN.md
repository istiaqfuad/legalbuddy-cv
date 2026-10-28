# LEGAL AI ASSISTANT (LegalBuddy)
**Final End-to-End Hackathon Build Plan**

> **Goal:** Build a fast, affordable legal and compliance copilot for small businesses that also works as a daily research tool for lawyers.

| Dimension | Final Direction |
| :--- | :--- |
| **Primary users** | Small-business owners/operators + lawyers/researchers |
| **Core product** | Grounded legal research, document understanding, compliance workflows, and actionable answers |
| **Hackathon advantage** | Use Meta/Llama-centered intelligence, strong retrieval/evidence UX, and partner infrastructure where it provides leverage |
| **Architecture** | UV Python monorepo + web frontend + API/orchestration + ingestion + vector retrieval + evaluation/observability |
| **Deployment principle** | Do not depend on owning servers; use managed/serverless services and partner credits where possible |

---

## 1. Executive Summary
The winning version of the product should not be positioned as a generic chatbot that gives legal-sounding answers. It is a **legal work system**: a user asks a question, uploads or selects relevant material, and the system retrieves authoritative sources, reasons over them, and returns an answer with traceable evidence, caveats, and next actions.

The product operates in two complementary modes:
* **Business Mode:** Everyday legal and compliance work—contracts, policies, notices, obligations, deadlines, checklists, document review, and first-pass issue spotting.
* **Research Mode:** Lawyers can search, compare, summarize, and monitor legal materials with source-aware citations and reusable research trails.

**Technical Strategy:** Deliberately hybrid and serverless. Use hosted inference and embedding APIs rather than local models so the build never assumes a personal server. Combine a managed vector database, managed PostgreSQL, object storage for raw files, and a Python API/orchestration layer. Allocate partner credits by workload so no single provider becomes a bottleneck.

**Non-Negotiable Product Principle:** Every consequential legal claim must be traceable to retrieved material, and the UI must clearly separate source-backed facts from model interpretation and uncertainty.

---

## 2. Product Definition

### 2.1 Problem
Small businesses often need answers that are too specialized for ordinary search but too routine to justify expensive outside legal work every time. Lawyers, meanwhile, spend significant time finding authorities, reading long documents, comparing provisions, and converting raw research into structured work products.

### 2.2 Product Promise
* **Fast:** Reduce the time from initial question to an evidence-backed first draft.
* **Affordable:** Use hybrid retrieval and task-based model routing so expensive inference is reserved strictly for difficult synthesis and reasoning.
* **Useful:** Turn answers directly into checklists, drafts, issue lists, and saved research trails rather than stopping at a paragraph of prose.

### 2.3 Core User Journeys
1. **Ask a legal question:** User states jurisdiction and context $\rightarrow$ system identifies intent $\rightarrow$ retrieves relevant sources $\rightarrow$ generates a cited answer $\rightarrow$ exposes sources and uncertainty.
2. **Review a document:** User uploads a contract/policy $\rightarrow$ document is parsed and chunked $\rightarrow$ relevant clauses are retrieved $\rightarrow$ system identifies issues, missing provisions, unusual language, and questions for counsel.
3. **Research a topic:** Lawyer enters a research question $\rightarrow$ search/retrieval gathers primary and secondary material $\rightarrow$ answer is organized by rule, authority, application, and open questions.
4. **Compliance workflow:** User selects a business type and jurisdiction $\rightarrow$ system produces a requirements checklist $\rightarrow$ each item links to supporting authority $\rightarrow$ user tracks status and deadlines.
5. **Prepare a work product:** User converts research or document review into a memo, checklist, email, notice, or internal action plan, with all citations retained.

---

## 3. End-to-End Architecture

### Online Request & Reasoning Flow
```text
User 
  -> Web UI 
  -> API 
  -> Auth/Session 
  -> Intent & Jurisdiction Extraction 
  -> Retrieval Planner 
  -> Hybrid Search (Keyword + Vector) 
  -> Reranking 
  -> Evidence Pack 
  -> LLM Reasoning/Generation (Streaming) 
  -> Citation/Claim Validation 
  -> Structured Response 
  -> UI + Saved Research Trail
```

### Supporting Data & Ingestion Path
```text
Source 
  -> Ingestion Job 
  -> File Extraction / OCR 
  -> Normalization 
  -> Metadata Enrichment 
  -> Structure-Aware Chunking 
  -> Embeddings 
  -> Vector Database + Keyword Index 
  -> Retrieval API
```

### 3.1 System Components
| Component | Recommended Role | Key Responsibility |
| :--- | :--- | :--- |
| **Frontend** | React/Next.js-style web app | Chat, 3-pane research workspace, document viewer, citations, workflows |
| **API** | Python service (FastAPI) | Auth, request validation, orchestration, persistence, streaming |
| **Worker / Jobs** | Python async/background jobs | Ingestion, OCR, embedding, indexing, evaluation, scheduled updates |
| **Object Storage** | Managed blob storage | Original documents, extracted artifacts, exports |
| **Relational DB** | Managed PostgreSQL | Users, organizations, documents, jobs, conversations, citations, audit metadata |
| **Vector Store** | Managed vector DB | Semantic retrieval over chunks and claims |
| **Keyword / Search** | Postgres FTS or managed search | Exact terms, citations, case names, statute numbers |
| **LLM Layer** | Hosted model APIs | Classification, extraction, reasoning, generation |
| **Embedding Layer** | Hosted embedding API | Document and query embeddings |
| **Observability** | Managed logs/traces | Latency, failures, token cost, retrieval quality |

### 3.2 Why Hybrid Retrieval
Legal text contains both semantic concepts and exact identifiers. A vector-only system can miss an exact statute section number or case name; keyword-only search can miss conceptually equivalent language. The system combines both, merges candidates via reciprocal-rank/score fusion, reranks them aggressively, and gives the model a compact, high-signal evidence pack.

---

## 4. UV Monorepo Structure
Use `uv` as the workspace and package manager for a clean Python monorepo. Keep deployable applications separate from reusable internal packages.

```text
legal-ai/
├── pyproject.toml
├── uv.lock
├── README.md
├── apps/
│   ├── api/                # FastAPI web service, auth, orchestration, SSE streaming
│   ├── worker/             # Async background jobs (ingestion, OCR, embeddings)
│   └── evals/              # Benchmark runner and A/B evaluation suite
├── packages/
│   ├── domain/             # Typed domain models, schemas, and business rules
│   ├── ingestion/          # Parsing, OCR fallback, normalization, legal chunking
│   ├── retrieval/          # Vector + keyword search, RRF fusion, reranking
│   ├── llm/                # Provider adapters and task-based routing
│   ├── citations/          # Evidence/claim extraction and deterministic validation
│   └── observability/      # Tracing, latency metrics, and token cost accounting
├── data/
│   └── manifests/          # Dataset/source manifests (no large raw files in git)
├── tests/
│   ├── unit/
│   ├── integration/
│   └── eval/
├── infra/
└── deployment/
```

### Workspace Rules
* Pin all dependencies in `uv.lock` and keep provider SDKs isolated behind internal interfaces.
* Never let application code depend directly on one model vendor; always call a shared LLM/embedding abstraction in `packages/llm`.
* Keep secrets in environment/secret management, never in the repository.
* Use typed schemas for ingestion records, retrieval results, citations, and structured model outputs.
* Add unit tests at the package level and end-to-end integration tests at the API level.

---

## 5. Data & Knowledge Pipeline

### 5.1 Source Strategy
Start narrow. A smaller, high-quality corpus is far more valuable for a hackathon than a huge, noisy corpus. Prioritize authoritative public legal sources for the jurisdictions and use cases you explicitly support, then add secondary explanatory sources only when they directly improve usability.

Every source must carry structured metadata:
* `jurisdiction`
* `court_or_authority`
* `publication_date`
* `effective_date`
* `source_type`
* `title`
* `canonical_url_or_reference`
* `document_version`
* `access_date`

### 5.2 Ingestion Pipeline
1. **Acquire:** Fetch source file/page and preserve the original artifact in object storage.
2. **Extract:** Extract text and structural layout; trigger OCR only when needed.
3. **Normalize:** Clean whitespace, headers, footers, character encoding, and repeated boilerplate.
4. **Detect Structure:** Identify document title, sections, subsections, paragraphs, footnotes, and tables where possible.
5. **Chunk by Legal Structure:** Chunk along natural legal boundaries rather than arbitrary character counts, retaining enough surrounding context (such as parent section headers) for a provision to make standalone sense.
6. **Assign Stable IDs:** Create deterministic IDs for source, document version, section, and chunk.
7. **Embed:** Generate embeddings in batches through the hosted embedding provider adapter.
8. **Store & Index:** Store canonical chunks, metadata, and keyword-search (FTS) fields in PostgreSQL, and index embeddings with metadata filters in the vector store.
9. **Validate Quality:** Run automated checks for empty text, duplicated chunks, broken extraction, missing metadata, and suspicious OCR output.

### 5.3 Retrieval-Time Pipeline
```text
Query 
  -> Classify Intent & Jurisdiction 
  -> Expand Query (where helpful) 
  -> Parallel Vector Retrieval + Keyword Retrieval 
  -> Reciprocal-Rank / Score Fusion 
  -> Cross-Encoder Reranking 
  -> Diversity & Deduplication 
  -> Compact Evidence Pack 
  -> Generation
```

> **Retrieval Rule:** Do not dump dozens of retrieved chunks into the model. Retrieve broadly, rerank aggressively, and send a small, high-signal evidence set with explicit source identifiers.

---

## 6. Embeddings & Model Provider Strategy
The project architecture enforces three constraints:
1. Do not rely on local inference.
2. Do not assume a personal server to host models.
3. Use partner infrastructure and credits intelligently behind provider-agnostic adapters.

### 6.1 Embedding Selection Criteria
* Strong semantic retrieval performance on long-form statutory, regulatory, and contractual language.
* Reasonable cost at ingestion scale.
* Stable API and predictable latency.
* Vector dimensionality compatible with the chosen managed vector store.
* Zero lock-in: embeddings are generated behind an adapter so the underlying provider can be swapped via configuration.

### 6.2 Practical Provider Allocation
| Workload | Preferred Strategy | Fallback |
| :--- | :--- | :--- |
| **Embeddings** | Reliable hosted embedding API using hackathon/free-tier or partner credits | Secondary hosted embedding provider |
| **Fast / Simple Generation** (intent, jurisdiction, query expansion) | Lower-cost, low-latency hosted Llama-compatible endpoint | Alternate partner endpoint |
| **Hard Reasoning / Synthesis** (legal analysis, contract review, drafting) | Higher-quality Llama-capable hosted inference | Secondary model provider |
| **OCR / Document Extraction** | Managed document/OCR service where needed | Local parsing libraries inside serverless workers |
| **Evaluation** | Run a fixed benchmark against 2–3 model configurations | Single baseline model configuration |

Do not choose a provider solely because it advertises "free." Measure the actual end-to-end unit economics: embeddings per $1\text{M}$ tokens, input/output inference pricing, latency, rate limits, concurrency, and credit expiry. The application routes workloads dynamically by task complexity and provider health.

---

## 7. Partner & Credit Strategy
Use partner credits as an architectural advantage rather than scattering vendor-specific dependencies throughout the codebase.

| Partner / Resource Type | Best Use | Strategic Reason |
| :--- | :--- | :--- |
| **Meta / Llama Ecosystem** | Primary reasoning, extraction, and generation story | Strong hackathon alignment and a coherent product narrative |
| **Inference Partner (e.g., Baseten)** | Production-style hosted Llama inference, experiments, or burst capacity | Avoids self-hosting and accelerates deployment |
| **Inference Partner (e.g., Fireworks)** | Fast model serving, alternate route, benchmark comparison | Provider redundancy and strong latency/cost performance |
| **Compute Partner (e.g., Modal)** | Background jobs, evaluation, preprocessing, scheduled ingestion | Ideal fit for bursty workloads without maintaining a permanent server |
| **Managed Vector DB** | Production semantic retrieval index | Removes operational and scaling burden |
| **Managed DB / Storage** | Relational app state, FTS, and source artifacts | Simple deployment and durable persistence |

**Partner Outreach Guide:** When requesting credits from partners, explain that the app is a legal research and compliance copilot built for the Meta AI Developer Hackathon, share the expected token/compute workload, specify the exact API/model/compute needs, and ask for enough credits to run both the live demo and evaluation benchmark traffic.

---

## 8. Legal RAG & Reliability Design
This is the most critical technical and product layer. A legal assistant must optimize for **groundedness**, not merely fluency.

### 8.1 Evidence-First Response Contract
* Answer only what the retrieved evidence reasonably supports.
* Attach explicit source references to every material legal claim.
* Clearly distinguish:
  1. **Law / Rule**
  2. **Factual Assumptions**
  3. **Model Interpretation**
  4. **Actionable Recommendation**
* State explicitly when jurisdiction, effective dates, or material facts are missing.
* Prefer *"I could not verify this from the available sources"* over a confident, unsupported answer.
* For high-impact matters, recommend professional legal review rather than presenting the output as a substitute for formal counsel.

### 8.2 Claim & Evidence Validation
To maintain a fast streaming UX without sacrificing reliability, stream the structured draft response to the center pane while executing a lightweight validation pass (structured claim extraction + deterministic `chunk_id` checks) before finalizing citation badges. Unsupported claims are automatically flagged, rewritten with explicit caveats, or removed.

### 8.3 Citation UX
* Inline citation markers open the exact source excerpt in the right-hand evidence panel on click.
* Display full provenance: source title, jurisdiction, effective/publication date, version, and section path.
* Allow the user to expand and inspect surrounding statutory or contractual context.
* Persist a complete research trail so the user can audit and reproduce how an answer was assembled.

---

## 9. MVP Feature Set (Aligned with Demo Flow)
| Priority | Feature | Hackathon Value |
| :--- | :--- | :--- |
| **P0** | Grounded legal chat with mandatory jurisdiction selection | Core demo foundation |
| **P0** | Source-aware inline citations and interactive evidence panel | Primary trust & differentiation layer |
| **P0** | Document upload + automated clause/issue/risk analysis | Concrete small-business workflow |
| **P0** | Hybrid retrieval (Vector + Keyword) + cross-encoder reranking | Technical depth & recall accuracy |
| **P0** | One-click Action Conversion (turn findings into a Compliance Checklist or First Draft with citations retained) | Essential for the 60-second *"Question $\rightarrow$ Evidence $\rightarrow$ Answer $\rightarrow$ Action"* demo flow |
| **P0** | Research workspace with saved questions/results & model routing adapter | Lawyer workflow + cost/reliability story |
| **P1** | Standalone multi-step compliance checklist tracker | Extended business utility |
| **P1** | Side-by-side document comparison | High-value legal workflow |
| **P1** | User feedback capture + automated evaluation harness | Quality loop & benchmark proof |
| **P2** | Monitoring/alerts for legal source updates | Post-hackathon retention |
| **P2** | Team/organization collaboration | Enterprise expansion |

---

## 10. Frontend & UX Plan
Build a **Three-Pane Research Workspace** for the flagship demo:
* **Left Pane (Context & Controls):** Conversation list, query input, active filters, jurisdiction selector, and task mode switcher (Business vs. Research).
* **Center Pane (Work Product):** Streaming answer (Concise Conclusion $\rightarrow$ Rule/Reasoning $\rightarrow$ Caveats), structured clause findings, and one-click action buttons (*Generate Checklist*, *Draft Memo/Email/Notice*, *Save Research Trail*).
* **Right Pane (Evidence & Provenance):** Source viewer with highlighted excerpts, section path metadata, surrounding context view, and claim verification status.

### Key Interaction Patterns
* Streaming response so the application feels responsive and fast.
* Visible retrieval, reranking, and claim-verification states rather than a mysterious loading spinner.
* One-click *"Show why"* on any important claim to jump straight to the highlighted source passage.
* Clear warning banners whenever the system lacks jurisdiction, date, or key factual information.

---

## 11. Backend Data Model
| Entity | Important Fields | Storage Notes |
| :--- | :--- | :--- |
| **User** | `id`, `email`, `preferences`, `created_at` | Managed PostgreSQL |
| **Organization** | `id`, `name`, `plan`, `settings` | Managed PostgreSQL (tenant isolation) |
| **Conversation** | `id`, `org_id`, `title`, `jurisdiction`, `created_at` | Managed PostgreSQL |
| **Message** | `id`, `conversation_id`, `role`, `content`, `model`, `latency`, `token_cost` | Managed PostgreSQL |
| **Source** | `id`, `type`, `title`, `jurisdiction`, `publisher`, `canonical_url`, `version` | Managed PostgreSQL |
| **Document** | `id`, `source_id`, `storage_key`, `checksum`, `extraction_status` | Raw file in Object Storage; metadata in Postgres |
| **Chunk** | `id`, `document_id`, `section_path`, `text`, `metadata` (+ `embedding` via `chunk_id`) | Text & FTS in Postgres; vector in Managed Vector DB |
| **Retrieval** | `id`, `query`, `candidate_ids`, `reranked_ids`, `scores` | Managed PostgreSQL (audit & eval trail) |
| **Citation** | `id`, `message_id`, `source_id`, `chunk_id`, `claim_span` | Managed PostgreSQL |
| **Workflow** | `id`, `type`, `status`, `input`, `output` | Managed PostgreSQL |
| **Evaluation** | `id`, `case_id`, `expected_evidence`, `answer`, `scores` | Managed PostgreSQL |

---

## 12. API Surface
Keep all API responses structured (`answer_text`, `claims[]`, `citations[]`, `warnings[]`, `suggested_actions[]`, and `usage_metadata`). This makes the frontend rendering deterministic and simplifies automated evaluation.

| Method & Endpoint | Description |
| :--- | :--- |
| `POST /v1/chat` | Grounded legal Q&A with jurisdiction filtering and streaming response |
| `POST /v1/research` | Deep legal research query organized by rule, authority, application, and open questions |
| `POST /v1/documents` | Upload a contract/policy to object storage and enqueue background ingestion |
| `GET /v1/documents/{id}` | Fetch document metadata, extraction status, and parsed section structure |
| `POST /v1/documents/{id}/analyze` | Run clause, issue, and missing-provision analysis linked to supporting authority |
| `POST /v1/workflows/compliance` | Generate a source-linked compliance checklist for a specific business type and jurisdiction |
| `POST /v1/drafts` | Convert research or document review findings into a cited memo, notice, or email |
| `GET /v1/sources/{id}` | Retrieve source metadata, version history, and surrounding chunk context |
| `GET /v1/research/{id}` | Load a saved research trail for full reproducibility |
| `POST /v1/feedback` | Record user feedback and flag citation issues for the evaluation dataset |

---

## 13. Evaluation Strategy
Create a small, hand-reviewed benchmark reflecting the exact demo tasks *before* optimizing prompts or routing.

| Metric | What to Measure |
| :--- | :--- |
| **Retrieval Recall** | Did the correct statutory/contractual authority appear in the candidate set? |
| **Reranker Precision** | Did the most useful evidence chunks rise to the top of the evidence pack? |
| **Citation Correctness** | Does each inline citation actually support the specific claim attached to it? |
| **Groundedness** | What proportion of material claims in the answer is supported by retrieved evidence? |
| **Completeness** | Were important legal conditions, exceptions, or caveats omitted? |
| **Latency** | Time to first token (TTFT) and full end-to-end response duration |
| **Cost** | Total embedding + inference cost per question or document analysis |
| **User Utility** | Can a user act on the structured output with significantly less manual work? |

Run an A/B matrix across embedding models, hybrid fusion weights, rerankers, and Llama endpoints. Keep the benchmark fixed so improvements are measurable rather than anecdotal.

---

## 14. Security, Privacy & Abuse Controls
* Encrypt data in transit and at rest using managed platform defaults.
* Treat uploaded documents as sensitive by default and minimize retention windows.
* Attach `org_id` (tenant ID) to every stored object and enforce authorization server-side.
* Log access to documents and generated work products for auditability.
* Never write secrets, API keys, or raw private document text into application logs.
* Defend against prompt injection in retrieved or uploaded documents: treat all retrieved text strictly as untrusted evidence data, never as executable instructions.
* Scan uploads and enforce strict file-size and MIME-type limits.
* Rate-limit expensive analysis endpoints and cap model context windows.

> **Legal-Specific Safeguard:** The system must clearly state in the UI and exported artifacts that it provides informational and research assistance and is not a lawyer or a definitive substitute for formal legal advice.

---

## 15. Deployment Plan
Use managed and serverless infrastructure wherever possible to demonstrate a production-shaped architecture without spending the hackathon managing servers.

1. Containerize the `apps/api` and `apps/worker` packages from the `uv` monorepo.
2. Deploy the API service to a managed container/serverless runtime.
3. Deploy background workers and evaluation jobs to a managed serverless compute platform (e.g., Modal).
4. Provision managed PostgreSQL, object storage, and vector DB instances.
5. Store all model and infrastructure provider keys in platform secret management.
6. Configure CI to run formatting, type checks, unit tests, integration tests, and evaluation smoke tests.
7. Enable production logging and basic latency, error, and token-cost metrics.
8. Seed the production demo environment with a small, verified golden corpus.

---

## 16. Hackathon Execution Timeline
| Phase | Deliverables |
| :--- | :--- |
| **Day 0 — Pre-Build Lock-In** | Lock the first target jurisdiction and 3–5 flagship use cases; define source policy and golden evaluation cases; confirm partner credit constraints |
| **Day 1 — Foundation** | UV monorepo setup, typed domain schemas, API skeleton, 3-pane frontend shell, auth/session, and LLM/embedding provider adapters |
| **Day 2 — Knowledge** | Source acquisition, extraction, structure-aware chunking, batch embeddings, and hybrid vector + keyword retrieval |
| **Day 3 — Intelligence** | Cross-encoder reranking, Llama-based answer generation, inline citations, and interactive evidence panel |
| **Day 4 — Workflows** | Document upload & clause/risk analysis, compliance checklist generator, and one-click drafting workflow |
| **Day 5 — Reliability** | Evaluation benchmark runs, post-generation claim validation pass, feedback loop, and latency/cost optimization |
| **Day 6 — Polish** | UX refinement, seeded demo corpus verification, loading/error states, and deployment hardening |
| **Final Day — Pitch & Demo** | Demo rehearsal, benchmark results slide, architecture story, provider fallback test, and 60-second backup video |

> **Scope Compression Rule:** If time is compressed, cut secondary features—never cut the evidence and citation validation layer. A smaller, demonstrably reliable legal copilot is a much stronger demo than a sprawling feature set with ungrounded answers.

---

## 17. Winning Demo Narrative
1. **Open with a real pain point:** A small business receives a contract or faces an urgent compliance question and needs a reliable, actionable answer quickly.
2. **Ask a jurisdiction-aware question:** Show the system identifying jurisdiction context and retrieving authoritative primary material in real time.
3. **Show the structured answer:** Present a concise conclusion first, followed by structured legal reasoning, explicit caveats, and inline citations.
4. **Open the evidence:** Click an inline citation and display the exact supporting statutory or regulatory passage highlighted in the right-hand evidence panel.
5. **Upload a document:** Upload a contract, automatically identify risky or missing clauses, and link every finding to supporting evidence.
6. **Turn findings into action:** Click once to generate a compliance checklist or first-draft response/memo while retaining all citations.
7. **Finish on the technical story:** Highlight Meta Llama-centered intelligence, hybrid RAG + reranking, hosted embeddings/inference, task-based provider routing, measurable evaluation metrics, and cost-aware serverless architecture.

> **Visual Proof Principle:** The strongest visual proof is not a giant architecture diagram—it is the seamless transition from **question $\rightarrow$ evidence $\rightarrow$ answer $\rightarrow$ action** in under a minute.

---

## 18. Cost & Scaling Strategy
* Cache query embeddings and repeated retrieval results where safe.
* Use a smaller, cheaper, low-latency model for classification, jurisdiction extraction, and routing.
* Reserve stronger Llama reasoning models strictly for final synthesis and difficult legal analysis.
* Limit retrieved prompt context using aggressive reranking and chunk deduplication.
* Batch document embeddings during background ingestion.
* Track per-request token cost in PostgreSQL and enforce hard budgets and rate limits.
* Use partner credits for high-variance workloads while retaining a configured fallback provider.

The objective is not "free forever"—it is a design that runs the hackathon demo inexpensively and demonstrates an obvious path to sustainable unit economics.

---

## 19. Major Risks & Mitigations
| Risk | Mitigation |
| :--- | :--- |
| **Hallucinated legal claims** | Evidence-first generation + post-generation citation validation + explicit uncertainty states |
| **Wrong jurisdiction** | Require jurisdiction selection upfront; hard-filter retrieval by jurisdiction metadata |
| **Stale law** | Track version and effective-date metadata on every source; surface dates in citations |
| **Poor PDF / OCR extraction** | Automated ingestion quality checks + document parsing fallback pipeline |
| **Provider outage / rate limit** | Unified provider abstraction in `packages/llm` + automatic fallback route |
| **High inference cost** | Task-based model routing + strict evidence pack context limits + caching |
| **Prompt injection from documents** | Treat retrieved content strictly as untrusted data; never execute instructions from sources |
| **Demo instability** | Seeded golden corpus, pre-warmed serverless services, graceful fallback, and scripted demo path |

---

## 20. Definition of Done & Final Build Checklist

### Definition of Done
* [ ] A new user can ask a jurisdiction-specific legal question and receive a concise streaming answer with verifiable citations.
* [ ] A user can upload a supported contract/policy document and receive structured issue and risk findings.
* [ ] Each material finding can be traced with one click to an exact evidence excerpt in the right-hand panel.
* [ ] Findings can be converted into a cited compliance checklist or draft memo/notice in one click.
* [ ] The retrieval stack combines semantic vector search and exact-match keyword search with reranking.
* [ ] All LLM and embedding providers are abstracted behind clean internal interfaces.
* [ ] The application runs end-to-end without locally hosting any foundation model.
* [ ] A fixed evaluation set demonstrates measurable retrieval recall, citation accuracy, and groundedness quality.
* [ ] The demo environment is reproducible from the `uv` monorepo and handles sensitive data and secrets safely.

### Final Build Checklist
* **Before Coding:**
  * [ ] Lock the first target jurisdiction and 3–5 flagship use cases.
  * [ ] Define the authoritative source policy and metadata schema.
  * [ ] Create the hand-reviewed golden evaluation cases.
  * [ ] Confirm partner credit quotas, rate limits, and terms.
* **During Coding:**
  * [ ] Keep all model/embedding provider access strictly behind `packages/llm` interfaces.
  * [ ] Persist stable `source_id` and `chunk_id` references across ingestion, retrieval, and generation.
  * [ ] Instrument per-request latency and token cost accounting.
  * [ ] Write automated unit and integration tests around hybrid retrieval and citation validation.
* **Before Demo:**
  * [ ] Seed and verify the golden demo corpus in production.
  * [ ] Rehearse the exact 60-second *"Question $\rightarrow$ Evidence $\rightarrow$ Answer $\rightarrow$ Action"* flow.
  * [ ] Test live provider fallbacks and verify every demo citation link.
  * [ ] Prepare a 60-second backup demo video recording and screenshots in case live infrastructure falters.

> **Product North Star:** The assistant must make every legal task feel like a guided, verifiable research workflow—never like asking a chatbot to guess the law.