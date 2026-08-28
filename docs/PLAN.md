# BitbyBit plan (reference)

**Status:** working reference. **§1–3 are approved and implemented** (execute-plan request, 27 Aug 2026). Later numbered steps stay blocked until named.

This is the working plan from the August 2026 planning thread. Edit it in place as decisions land. When a slice is approved, copy the relevant numbers into the agent prompt and treat **Must** items as requirements unless they have been struck here.

---

## How to use this file

1. Read **Current product** so you do not re-propose work that already shipped.
2. Treat **§9 Security** and **§10 Data protection** as the bar for any persist, auth, upload, or AI change. They are non-negotiable unless the user strikes a Must.
3. Fill or revise `[edit]` blanks with the user before coding.
4. Ship only the numbered steps the user names. Stop after the step they name.
5. Privacy Policy and Terms (**§11–13**) must stay consistent with the data map in **§10.2**.

---

## Current product (do not re-build)

Signed-out Next.js app still works in the browser. Signed-in users persist money data to Supabase (user JWT + RLS). Source file bytes stay memory-only during parse.

| Area | State |
| --- | --- |
| Structured files (CSV, Excel, OFX, QIF, native PDF text) | Parsed locally in `src/lib/money-flow/` |
| Photos | OpenAI `gpt-4o-mini` vision if `OPENAI_API_KEY` is set; else Tesseract in `readImageDocument` |
| Tagging | Rules first; AI suggests tags only for leftover `Other` |
| Accounts (`/accounts`) | Demo balances |
| Goals (`/goals`) | Redirects to `/savings` |
| Budgets | In demo data and Supabase schema; no tab |
| Auth | Email + password (12+ chars) and magic link; `@supabase/ssr` cookies |
| Persistence | Signed-in: transactions, file metadata, tags, recurring, savings, period on Supabase. Signed-out: existing `localStorage` keys. Import-then-wipe on first login. |
| Supabase | Initial schema + `202608270001_auth_persist_schema.sql` (tags, recurring, savings, preferences). RLS on every user table. |
| AI key | Server-only `OPENAI_API_KEY` (must never be `NEXT_PUBLIC_`) |
| Residual risk | Confidential rows are readable by the Supabase project (no application-layer encryption yet). Restricted source bytes are not stored. |

---

## AI vendor research (decision pending)

`gpt-4o-mini` vision is a cheap general model, not the best fit. Keep it as an optional fallback until the user picks a default.

**What AI is for:** photo → JSON money movements (receipt = one total; statement photo = each row); text-only tag suggestions when rules miss. CSV, Excel, OFX, QIF, and native PDFs must not go to a model.

| Use | Pick | Why | Skip if |
| --- | --- | --- | --- |
| Statement / receipt photos | **Gemini Flash (default) or Gemini Pro** | Strongest current multimodal extraction; Flash is the cost/speed pick | User refuses Google as a processor |
| Receipt dockets only | Azure Document Intelligence `prebuilt-receipt` | Purpose-built; **en-AU** receipts | Extra vendor; overkill if Gemini is already in |
| AU bank statement photos | **Not** Azure `prebuilt-bankStatement.us` | That model is US-only | — |
| Tagging `Other` merchants | Any cheap text model (Gemini Flash / GPT mini / Claude Haiku) | No image needed | — |
| No API key / offline | Keep Tesseract | Already in `readImageDocument` | Accuracy on blurry photos |
| Max privacy | Local VLM later (PaddleOCR-VL / olmOCR) | Data never leaves device | GPU, product complexity |
| Expense-SaaS APIs (Veryfi, Mindee) | Later / skip | High accuracy, high min spend | Consumer app cost |

**Recommended default (not approved until user says so):** hybrid, one paid vision vendor.

1. Structured files: local parsers only.
2. Photos: Gemini Flash → existing JSON schema in `src/lib/money-flow/ai.ts` → Tesseract if empty/fail.
3. Tags: same vendor, text-only, batched.
4. Keep the `MoneyFlowAi` interface so the vendor is swappable.
5. Paid API / Vertex only (not free AI Studio). Disclose the processor in Privacy + Terms.

Sources used in the planning thread: OpenAI API data controls (no training on paid API; ~30-day abuse logs unless Zero Data Retention is approved); Businessware invoice extraction benchmark (Mar 2026); Azure Document Intelligence receipt vs US-only bank-statement prebuilt.

---

## Skeleton

### 1. Scope

- In: Sign in, then keep **transactions, tags, file metadata, recurring, savings, and the period filter** on the user’s account instead of this browser.
- Out: Accounts tab replacement, restoring `/goals` or budgets, AI vendor swap, Privacy/Terms pages, application-layer encryption, production launch, storing original statement bytes.
- Success: A signed-in user can refresh or use another browser and still see their money data. A second user cannot read it. Auth tokens are not in `localStorage`. Signed-out demo/local behaviour still works without Supabase.

### 2. Auth

- Sign-in: **email + strong password** (primary) **and magic link** (same email)
- Session: **Supabase SSR cookies** (`httpOnly`, `Secure` on HTTPS, `SameSite=Lax`). No tokens in `localStorage`.
- Demo after login: **keep** until the account has its own money-flow or savings rows
- MFA: optional later (not required now)
- Password: **strong password** — at least 12 characters, a letter, and a number
- Idle timeout: **30 minutes** of no requests; absolute session cookie **7 days**
- `service_role` is never in the browser, Edge/proxy, or `NEXT_PUBLIC_*`. Data access uses the **user JWT**.

### 3. Persistence

- Move off `localStorage`: **all** of transactions, recurring, savings, period (when signed in)
- Existing Supabase tables: **migrate first** — keep users/accounts/files/categories/transactions/budgets; add tag columns, recurring, savings, preferences
- Schema gaps: **primary/sub-tags, recurring, savings** (filled in `202608270001_auth_persist_schema.sql`)
- Local + cloud: **one-time import then wipe this browser**
- Source files: **memory-only** (parse → persist movements + filename metadata → drop bytes). `storage_path` stays null.
- Application-layer encryption: **later**, with residual risk documented: the database can read Confidential plaintext. Restricted originals are not kept.

### 4. Accounts

- Replace demo `/accounts`: `[upload-derived | user-created | both]`
- Link transactions to an account: `[required | optional]`

### 5. Money views

- Cross-page consistency: `[what must stay consistent across Dashboard, Transactions, Recurring, Savings]`
- Period filter: `[server-backed | keep client]`
- Charts: `[primary tag only | include sub-tags | budgets overlay]`

### 6. Goals / budgets

- Restore `/goals`: `[yes | no | later]`
- Budgets (schema + demo data, no tab): `[new tab | fold into Dashboard | skip]`

### 7. Upload / AI (vendor)

- Vision extract: `[Gemini Flash | Gemini Pro | keep gpt-4o-mini | Azure receipt only]`
- Tag suggest: `[same vendor | cheaper text model]`
- Never send to AI: `[CSV | Excel | OFX | parsed PDFs | all structured files]`
- Offline fallback: `[keep Tesseract | drop]`
- Region / contract: `[paid Gemini API | Vertex AU/US | OpenAI paid | Azure AU]`
- Retention: `[default ~30d logs | request ZDR]`
- User control: `[opt-in AI | opt-out | always-on if keyed]`

Any change here must also satisfy **§9.7** and **§10.6**.

### 8. Data rules

- Duplicate uploads: `[merge | reject | user chooses]`
- Tag model vs DB `categories` / `subcategory`: `[map 1:1 | new columns]`
- Recurring vs posted transactions: `[keep current matching | change]`

### 9. Security

Treat **Must** as non-negotiable unless struck. `[edit]` is a choice, not a skip.

#### 9.1 Threat model

- **Assets:** bank/card statements, receipt photos, balances, merchants, recurring bills, savings, auth sessions, AI keys.
- **Attackers:** XSS on our origin, stolen device, malicious upload, prompt injection in a statement image, compromised npm dep, leaked `service_role` / AI key, insider with dashboard access, AI vendor breach.
- **Assume breach:** a single XSS today dumps every interpreted transaction. Design so that is no longer true.
- In scope for v1: `[web app + API + DB + AI vendor]`. Out: `[native apps | bank screen-scraping | …]`.

#### 9.2 Data classes (use everywhere)

- **Restricted:** source files, images, account/BSB/card numbers, raw statement text, AI prompts that contain any of the above.
- **Confidential:** transactions, tags, pots, recurring, budgets, email.
- **Internal:** period prefs, feature flags, aggregate metrics with no PII.
- **Rule:** Restricted never in `localStorage`, never in client logs, never in analytics, never in LLM **training**, never in tickets/screenshots.

#### 9.3 Identity and access — Must

- Auth before any cloud persist. Session: `[httpOnly, Secure, SameSite=Lax cookies | Supabase SSR cookies]`. No tokens in `localStorage`.
- MFA: `[optional now | required]`. Password: `[magic link only | + strong password]`.
- RLS on every user table (`auth.uid() = user_id` already drafted). No `FOR ALL` policy without `WITH CHECK`. Deny by default.
- **Never** put `service_role` in the browser, Edge middleware, or `NEXT_PUBLIC_*`.
- Server paths that read/write finance data use the **user JWT**, not service role. Service role only for: `[auth hook | storage GC | none]`.
- Admin/support access: `[none in v1 | break-glass with audit]`. No standing production DB login from laptops.

#### 9.4 Secrets and keys — Must

- AI keys, DB URLs, service role: server env only; rotate `[90 days | on incident]`.
- Separate keys per env (dev / staging / prod). Dev keys cannot read prod.
- `.env.local` gitignored; secret scan in CI: `[gitleaks | …]`.
- If a key leaks: revoke first, then rotate, then audit vendor logs.

#### 9.5 Encryption

- TLS 1.2+ everywhere (app, Supabase, AI). HSTS: `[yes]`.
- At rest: Supabase/Postgres + object storage default encryption. Region: `[AU | other: ____]`.
- **Application-layer encryption** for Restricted fields (source files, account numbers): `[yes, user-key or envelope | later with documented risk]`.
  - If later: write the residual risk in the Privacy Policy (server can read plaintext).
- Backups encrypted; same access bar as prod.

#### 9.6 Application hardening — Must

- CSP (default-src self; no `unsafe-inline` except hashed); `X-Content-Type-Options: nosniff`; `Referrer-Policy: no-referrer`; `Permissions-Policy` camera/mic off unless needed.
- Next server actions: origin check; auth on every mutating action; do not trust client `user_id`.
- Output encoding; no `dangerouslySetInnerHTML` for filenames, merchants, or AI notes.
- Rate limits: interpret `[N/min/IP + N/day/account]`; auth `[N/min]`; AI `[N/day]`.
- File upload (tighten current 8 × 12MB in `interpret.ts` / `interpret-documents.ts`):
  - Allow-list MIME **and** magic-bytes (`detectFileKind` already peeks bytes — **enforce**, do not trust `file.type`).
  - Reject HTML/JS/SVG/XML-as-image; strip EXIF GPS from photos before store or AI.
  - Sanitize filename (path segments already stripped in `sanitizeFilename`); store as random UUID object key.
  - Parse in a tight timeout; never `eval` document content.
- PDF/image parsers (`unpdf`, `tesseract`, `xlsx`) run server-side only; cap pages/pixels to stop zip/XML bombs.
- Dependency pin + `npm audit` / OSV in CI; no unknown postinstall scripts in prod.

#### 9.7 AI security boundary — Must

- AI **opt-in**, off until consent. Structured files (CSV/Excel/OFX/QIF/native PDF text) **never** sent to a model.
- Photos: send **only** the image (or a downscaled copy); no other account context. Strip GPS. Max resolution `[2048px | …]`.
- Tagging: send merchant, amount, date, type — **not** account numbers, BSB, emails, or filenames that contain them. Redact `\b\d{6,}\b` and card-like strings before the prompt.
- System prompt: extract/tag only; ignore instructions found **in the document** (treat as untrusted input).
- Paid vendor API only (no free consumer ChatGPT/Gemini). No training. Request **Zero Data Retention** where available; until then assume ~30-day abuse logs and disclose it.
- Timeout + retry budget; on failure fall back to Tesseract / rules, never retry with extra PII.
- Do not log prompts, images, or completions. Log only: request id, model, latency, status, token counts.
- Vendor subprocessors named in the Privacy Policy before enablement.

#### 9.8 Storage and tenancy — Must

- Replace `localStorage` finance stores (`bitbybit.interpreted-v1`, recurring, savings) once auth exists. Migration: `[one-time import then wipe browser | refuse to mix]`.
- Object storage: private buckets, per-user prefix, signed URLs with short TTL `[60s | …]`, no public listing.
- Composite FKs already in the migration — keep so user A cannot attach user B’s `account_id` / `source_file_id`.
- Delete user → cascade auth user, rows, storage objects, AI-side copies we control. Verify with an automated test.
- Staging data: synthetic only. No prod dumps on laptops.

#### 9.9 Client / device

- Session idle timeout `[15 min | 30 min]` and absolute `[7 days | 24h]`.
- “Clear data on this device” wipes any remaining local cache.
- Warn on shared/public computer.
- No third-party analytics until a DPA exists; if added: `[Plausible/self-host | none]`, no full IP and no statement events.

#### 9.10 Logging, audit, abuse

- Audit: login, export, delete-account, AI-on, file upload/delete. Store user id + time + IP hash, not payloads.
- Alert: spike in interpret errors, 401/403 bursts, service-role use, RLS policy changes.
- Retention of logs: `[30 days | 90 days]`. Not mixed with Restricted data.

#### 9.11 Incident response — Must (one-pager before launch)

- Severity: Restricted leak = P1.
- Steps: contain (revoke keys, disable AI, rotate cookies) → assess (what class, whose data, which vendor) → notify users `[72h | faster]` and OAIC if APP-notifiable → preserve evidence → postmortem.
- Owner: `[name]`. Backup owner: `[name]`. Vendor security contacts on file (Supabase, AI).

#### 9.12 Assurance before launch

- Threat review of interpret action, RLS, storage, AI redaction.
- Automated: RLS regression (user A cannot read B), secret-in-repo scan, header scan.
- Manual: upload a statement containing a fake PAN/BSB; confirm it never appears in AI logs or browser storage after persist.
- No production AI key in preview deployments.

### 10. Data protection

#### 10.1 Stance — Must

- Treat BitbyBit as if it **were** an APP entity even if turnover is under the small-business threshold. Financial personal information is sensitive in practice; do not rely on the exemption as the product design.
- Privacy by design: collect least, keep shortest, access fewest, encrypt hardest class, delete on request.
- We are **not** a bank, licensee, or credit provider. No secondary use for marketing, scoring, or sale of data. Ever. `[confirm]`

#### 10.2 Data map (fill every row before coding persist)

| Data | Class | Collected | Stored | Who can read | Leaves AU? | TTL |
| --- | --- | --- | --- | --- | --- | --- |
| Source PDF/CSV/photo | Restricted | Upload | `[DB/Storage/memory-only]` | user + parse job | `[AI vendor Y/N]` | `[delete after parse | N days]` |
| Extracted txns | Confidential | Parse | `[DB]` | user | `[N]` | `[account life]` |
| Account identifiers in file | Restricted | Parse | `[redact | encrypt | never store]` | — | — |
| AI image prompt | Restricted | Opt-in | vendor ~30d unless ZDR | vendor | **Yes** | vendor policy |
| AI tag batch | Confidential | Opt-in | vendor ~30d | vendor | **Yes** | vendor policy |
| Auth email | Confidential | Signup | Supabase Auth | user + auth | `[region]` | account life |
| Recurring / savings | Confidential | User | `[DB]` | user | `[N]` | account life |
| Server logs | Internal | Auto | `[host]` | ops | `[region]` | `[30/90d]` |

#### 10.3 Purpose limitation — Must

- Allowed: parse, display, tag, user-requested export, security, legal obligation.
- Forbidden: ads, model training (ours or vendor), sharing with partners, “improving the product” by reading statements.
- New purpose = new consent + policy update, not a silent code path.

#### 10.4 Minimisation — Must

- Prefer **memory-only** source files: parse → persist transactions → drop bytes. Keep original only if user opts into “store my statements” `[default off]`.
- Downscale photos; do not store EXIF.
- Redact PAN / BSB / account numbers from stored descriptions where detectable.
- AI tagging sends the smallest JSON batch (`id, merchant, amount, type, date`), not the file.
- No session replay, heatmaps, or error trackers that capture DOM with amounts.

#### 10.5 Lawful processing and APPs (design to)

- APP 1: public Privacy Policy, easy language, AI and overseas disclosure named.
- APP 3/6: collect only for stated purposes; no reuse.
- APP 8: overseas AI/hosting — take reasonable steps (paid API, DPA, no-training, ZDR request, named country). If we cannot get ZDR, **say so in the policy** and keep AI optional.
- APP 11: **§9** is the APP 11 programme, not a separate vibe.
- APP 12/13: access and correction in-app (view txns, edit tags, export JSON/CSV).
- APP 1.7–1.9 (from 10 Dec 2026): disclose that software extracts amounts and suggests tags; it **assists**, user can edit/reject; it does **not** decide credit, employment, or insurance. `[confirm still true]`

#### 10.6 Cross-border and vendors — Must

- Written list before launch: hosting `[Vercel/other]`, DB `[Supabase region ____]`, AI `[Gemini/OpenAI/Azure + country]`, email `[…]`.
- DPA or equivalent **before** prod traffic. No vendor on free consumer tier.
- Default AI **off** until the user accepts: vendor name, data sent, country, retention, “not used to train”, “can be wrong”.
- Switch vendor = policy + in-app notice, not a silent env change.

#### 10.7 Retention and deletion — Must

- Account data: until user deletes + `[30 days]` backup expiry.
- Source files: `[0 days default | user opt-in N days]`.
- AI vendor copies: we cannot delete their abuse logs; therefore AI stays optional and disclosed.
- Inactive accounts: email then delete after `[18 months | 24 months]`.
- “Delete my account” is a real cascade (auth, DB, storage, local caches). Confirm with a receipt email. Cooling-off `[none | 7 days]`.
- Export before delete: CSV of transactions + pots + recurring, available in-app.

#### 10.8 User rights UX — Must

- Download my data.
- Correct tags/amounts (already in product — keep after persist).
- Withdraw AI consent (further photos stay local/Tesseract only).
- Delete file / delete all / delete account.
- Contact: `[privacy@…]` responded in `[30 days]`.
- Complaints path: us, then OAIC, named in policy.

#### 10.9 Children, sensitive, financial-specific

- Age: `[18+ | 16+ with no kids’ accounts]`. No known child collection.
- Health inferences: do not build them from merchants.
- Tax / Centrelink / ID pages: refuse or do not special-case store; treat as Restricted if uploaded by mistake.
- Accuracy: AI/OCR amounts are **unverified**; UI must keep the “check a couple of amounts” warning; we do not assert bank-grade accuracy.

#### 10.10 Breach and records — Must

- Notifiable if Restricted likely accessed (plan as if we are an APP entity under the NDB scheme).
- Register: what happened, class of data, count of users, vendors told, notifications sent.
- Tabletop once before public launch.

#### 10.11 Launch gate (all boxes or no prod persist / no prod AI)

- [ ] Auth + RLS tests green
- [ ] No Restricted data in `localStorage`
- [ ] Service role not in any client bundle
- [ ] AI opt-in + redaction + no structured-file upload to models
- [ ] CSP and security headers
- [ ] Rate limits on interpret
- [ ] Delete-account cascade tested
- [ ] Privacy Policy + Terms live and linked at signup/upload
- [ ] Vendor DPA / paid API + region recorded
- [ ] Incident one-pager + key rotation path
- [ ] Fake PAN/BSB test: not in logs, not in AI transcript we control

### 11. Privacy policy (public page + signup tick)

- Who we are / contact: `[legal name, email]`
- What we collect: `[uploads, txns, tags, pots, account, device]`
- Why: `[provide the service | security | AI extract]`
- AI disclosure: photos and merchant text may go to `[vendor]`; not used to train on paid API; may be stored ~30 days for abuse monitoring unless ZDR
- Automated processing (from 10 Dec 2026 if APP entity): tagging and extract are assistive, user-editable, not credit/lending decisions `[confirm]`
- Overseas disclosure: `[countries]`
- Retention / deletion / cookies-or-local-storage
- Complaints: `[us first | OAIC]`
- Must match **§10.2** and **§10.5**. This is not legal advice; have counsel review before public launch.

### 12. Terms of use + acceptable use

- Licence: personal finance tracking only; **not** financial, tax, or credit advice
- Accuracy: interpreted amounts can be wrong; user is responsible
- Acceptable use: own documents only; no malware; no scraping others’ statements
- AI: optional; vendor processing as in Privacy Policy; no guarantee of extract quality
- Consumer guarantees: ACL rights not excluded for AU consumers
- Accounts: one person; keep credentials safe; we may suspend abuse
- Liability cap: `[to fees paid | …]` except ACL non-excludables
- Termination / data export
- Changes to terms: `[notice how]`
- Governing law: `[NSW | VIC | …]`, Australia
- Age gate: `[same as privacy]`
- Have counsel review before public launch.

### 13. In-app legal UX

- Routes: `/privacy`, `/terms` `[yes]`
- Before first upload / AI call: short consent `[yes | only for AI]`
- Footer + signup: links + last-updated date
- “Clear data” / delete account control: `[where]`

### 14. Ship bar

- Tests: `[unit | no new tests]`
- Browser: `[which routes, including legal pages]`
- PRs: `[legal+security | AI vendor swap | product | split: ____]`

### 15. First implement step

- Start with: **1**
- Stop after: **3**

**§1–3 shipped in this slice.** Do not treat this as a production launch: **§10.11** still has open boxes (Privacy/Terms, DPA, delete-account UX, incident one-pager). Suggested next slices remain **§11–13** then **§7**, unless the user names other numbers.

---

## Open decisions

Filled for §1–3 on 27 Aug 2026. Leave the rest blank until the user fills them.

- ~~Auth method and session storage~~ email + password, magic link, Supabase SSR cookies
- ~~Whether to persist to Supabase next, and which stores move first~~ all of transactions, recurring, savings, period
- AI vendor (Gemini Flash vs keep OpenAI vs Azure receipts)
- ~~Application-layer encryption now vs documented residual risk~~ later; residual risk documented in Current product
- Hosting / DB / AI regions and DPA owners
- Age gate, governing law, privacy contact email
- Whether `/goals` and budgets come back
