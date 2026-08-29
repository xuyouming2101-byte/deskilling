# Local and Online Authentication and Video Delivery Design

Date: 2026-08-29

Status: Final design for approval. No implementation is included in this
document.

## 1. Decision summary

The project remains one Next.js codebase with two independently operated
deployment environments:

| Environment | Git branch | Runtime | Participant identity | Video source | Study data |
| --- | --- | --- | --- | --- | --- |
| LOCAL | `main` | Mac, loopback-only | Participant ID and session only; no password or access code | Files outside Git, streamed through Next.js | Existing Supabase project |
| ONLINE | `release` | Alibaba Cloud ECS | Supabase Auth account entered as participant ID and password | Private Supabase Storage signed URL | Existing Supabase project |

The deployment environment and the study mode are separate concepts:

- Deployment environment is `local` or `online` and controls authentication,
  RPC entry points, and video delivery.
- Study mode is `dev` or `formal` and controls eligible video selection.
- A participant never selects either value in the browser.
- LOCAL supports both DEV and FORMAL by changing trusted database study
  configuration for the local channel, not by accepting a browser flag.

There is no fallback between LOCAL and ONLINE. A failure in the selected mode is
reported as a mode-specific error.

## 2. Current baseline and superseded work

The deployed `release` branch at
`d4957edd455e7f99bc71cbde09c23254edabcfac` uses the existing Study access code
in the participant UI, queue RPC, response RPC, and private-video Edge Function.
It must continue to work until an explicitly approved ONLINE release is
deployed.

The current working tree also contains an uncommitted access-code-removal
attempt, including `supabase/remove_assessment_access_code.sql`. That migration
must not be applied as the final solution. It grants no-auth queue and response
RPC execution to the anonymous browser, which conflicts with the approved
ONLINE identity model. During implementation it must be reconciled or replaced,
not blindly committed or deployed.

The new design preserves these existing behaviors:

- DEV and FORMAL video-pool rules, including exactly 40 videos for a FORMAL
  session;
- persistent randomized queues;
- participant and Session 1/2/3 isolation;
- resume and completion detection;
- first-unanswered-order enforcement;
- duplicate-response and exact-retry protection;
- response timing and `lesion_detection_events` timing;
- atomic response and event insertion;
- private Supabase Storage for ONLINE;
- existing analysis columns and table identities.

## 3. Goals and non-goals

### Goals

1. Run LOCAL on the Mac with no participant credential while retaining all
   Supabase queue and result behavior.
2. Replace the ONLINE Study access code with one Supabase Auth password per
   participant, shared across Sessions 1, 2, and 3.
3. Bind every ONLINE study action to the authenticated Supabase user rather
   than a browser-supplied participant ID.
4. Deliver LOCAL MP4 files through a controlled, seekable Range endpoint.
5. Preserve the current ONLINE private-Storage signed URL model.
6. Change the shared database additively until the public release has completed
   its rollback window.

### Non-goals

- No RDS or OSS migration.
- No local files inside `public/` or Git.
- No `local_path` database column.
- No administrator UI, public signup UI, password reset email flow, or Survey
  Creator.
- No CI/CD, webhook, or automatic deployment.
- No update to `release` during LOCAL implementation.
- No deletion or rewriting of existing research or test responses.

## 4. High-level architecture

```text
LOCAL browser on Mac
  -> server-rendered runtime mode: local
  -> Next.js LOCAL assessment routes
     -> server-only Supabase service client
     -> LOCAL-only RPC wrappers
     -> shared private study functions
     -> videos / assessment_queue / responses / lesion_detection_events
  -> Next.js LOCAL video Range route
     -> service-only current-video authorization RPC
     -> videos.file_path
     -> LOCAL_VIDEO_ROOT + relative file_path

ONLINE browser on ECS
  -> server-rendered runtime mode: online
  -> participant ID + password
  -> Supabase Auth sign-in adapter
  -> authenticated ONLINE RPC wrappers
     -> auth.uid() -> private participant account mapping
     -> shared private study functions
     -> videos / assessment_queue / responses / lesion_detection_events
  -> authenticated video Edge Function v2
     -> validate Supabase user JWT
     -> service-only current-video authorization RPC
     -> private Supabase Storage signed URL
```

The browser-facing assessment flow depends on two small interfaces rather than
embedding provider rules in the player:

```ts
interface AssessmentAccessClient {
  startOrResume(input: StartInput): Promise<AssessmentSession>;
  submitResponse(submission: VideoSubmission): Promise<void>;
}

interface VideoAccessGateway {
  getCurrentVideo(input: CurrentVideoInput): Promise<VideoPlaybackSource>;
}
```

The LOCAL adapters call controlled Next.js routes. The ONLINE adapters use the
authenticated Supabase client and authenticated video Edge Function. The player
receives only a playback URL and does not know whether it is a local stream or a
Supabase signed URL.

## 5. Environment configuration

### Shared browser-safe variables

Both environments require:

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

These are the only Supabase values exposed to browser JavaScript.

### Server-only deployment selector

Both environments require exactly one server-side value:

```env
ASSESSMENT_DEPLOYMENT_MODE=local
```

or:

```env
ASSESSMENT_DEPLOYMENT_MODE=online
```

Rules:

- The variable is not prefixed with `NEXT_PUBLIC_`.
- The Next.js server reads and validates it once.
- Missing or invalid values fail closed with a configuration error.
- Mode is not inferred from `NODE_ENV`, hostname, port, branch name, or
  `localhost`.
- A Server Component may pass a display-mode value to the client to select the
  correct form, but that value is not an authorization boundary. Every server
  route and database function independently enforces its own mode.
- Editing browser state cannot activate LOCAL endpoints on ECS.

### LOCAL `.env.local`

```env
ASSESSMENT_DEPLOYMENT_MODE=local
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SERVICE_ROLE_KEY=
LOCAL_VIDEO_ROOT=/absolute/path/to/colonoscopy-videos
```

`SUPABASE_SERVICE_ROLE_KEY` is used only by server-side LOCAL routes and trusted
upload tooling. It must never be imported into a Client Component, serialized,
logged, or renamed to a `NEXT_PUBLIC_...` variable.

The local Next.js server must bind to `127.0.0.1`, not a LAN interface. LOCAL
mode intentionally has no participant authentication and is not approved for a
publicly reachable server.

### ONLINE `.env.production.local`

```env
ASSESSMENT_DEPLOYMENT_MODE=online
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

ONLINE does not configure `LOCAL_VIDEO_ROOT` and does not require a Supabase
service-role key inside the ECS Next.js process. Privileged Storage signing and
account provisioning remain in trusted Supabase Edge Function or coordinator
environments.

### Supabase Edge Function secrets

Trusted Edge Functions use Supabase-managed server values:

- `SUPABASE_URL`;
- a publishable/anonymous project key for ordinary Auth sign-in calls where
  required;
- `SUPABASE_SERVICE_ROLE_KEY` for private account lookup and Storage signing.
- `ONLINE_APP_ORIGIN` for an exact production CORS allowlist.

No Edge Function returns or logs a service-role key, plaintext password,
internal email, or raw Storage path. Signed URLs are never logged; only the
authenticated video function may return one to its authorized caller.

## 6. ONLINE Supabase Auth account mapping

### 6.1 Account model

Use Supabase Auth email-and-password accounts internally. Participants see only
`participant_id` and `password`; they never see or type an email address.

Create a non-exposed mapping table, for example:

```text
private.assessment_participant_accounts
  auth_user_id uuid primary key references auth.users(id) on delete restrict
  participant_id text unique not null
  internal_email text unique not null
  active boolean not null default true
  created_at timestamptz not null default now()
  updated_at timestamptz not null default now()
```

Security rules:

- The table is not in an exposed Data API schema.
- Revoke access from `PUBLIC`, `anon`, and `authenticated`.
- Only trusted provisioning code and narrowly scoped `SECURITY DEFINER`
  functions may read it.
- Authorization uses the table lookup from `auth.uid()` to `participant_id`.
- `user_metadata` is never authoritative because users may edit it.
- No password, password hash, access code, or reusable secret is stored in this
  table.
- Existing study tables retain text `participant_id`; no Auth UUID is added to
  `responses`, `assessment_queue`, `lesion_detection_events`, or `videos`.

The `on delete restrict` relationship is intentional. Deactivating an account
must not silently detach an Auth identity from preserved research data.

### 6.2 Provisioning

A trusted coordinator script or administrative procedure performs provisioning;
there is no participant signup flow.

For each participant:

1. Validate the exact canonical `participant_id`. Trim surrounding whitespace,
   but do not silently change case or rewrite existing IDs.
2. Generate an opaque internal email address that is not shown to the
   participant.
3. Generate one cryptographically random password, preferably 12 characters
   from an unambiguous alphabet. Values from 8 to 12 random characters are
   acceptable for this controlled study workflow.
4. Call Supabase Auth Admin `createUser` from a trusted server context with the
   email pre-confirmed.
5. Insert the Auth UUID, exact participant ID, and internal email into the
   private mapping table.
6. Deliver the participant ID and password once through the study's controlled
   channel.

Auth-user creation and mapping insertion cannot be one PostgreSQL transaction.
Provisioning therefore must be idempotent and compensating: if mapping creation
fails, disable or delete the newly created unused Auth account; if retrying,
verify both sides before creating anything new.

One mapping row and one Auth user cover Sessions 1, 2, and 3. Password rotation
changes the Supabase Auth password only and does not change participant IDs,
queues, responses, or events. Password recovery is coordinator-managed because
the internal email is not a participant communication address.

### 6.3 Login flow

The recommended login adapter is a small `participant-sign-in` Supabase Edge
Function:

1. The ONLINE UI sends trimmed `participant_id` and password over HTTPS.
2. The function validates input shape and applies rate limiting.
3. A service client resolves the participant ID to the private internal email.
4. A normal publishable-key Supabase client calls
   `auth.signInWithPassword(internal_email, password)`.
5. On success, the browser installs the returned Supabase Auth session and uses
   its user JWT for subsequent RPC and Edge Function calls.
6. On any lookup, inactive-account, or password failure, return the same generic
   message: `Participant ID or password is invalid.`

This function is unauthenticated only because it is the login boundary. Its
`verify_jwt = false` setting is scoped to this function alone and does not grant
study-data or video access. It must validate the project publishable-key request,
apply abuse controls, never log the password, and never return the internal
email.

The authenticated Supabase browser client enables normal session persistence
and token refresh. Refreshing the assessment preserves login and then resumes
from the database. Expired or revoked sessions return to the login screen. An
explicit sign-out control clears the Supabase session, but completing one
session does not force sign-out because the same account may continue to the
next study session.

## 7. LOCAL no-auth boundary

LOCAL participants enter only:

- `participant_id`;
- `session_number` in 1, 2, or 3.

There is no password field, Study access code field, browser-generated access
token, or Supabase Auth requirement.

The trust boundary is the loopback-only Next.js server:

- Client Components never receive the service-role key.
- LOCAL start/resume and submission go through Next.js Route Handlers or Server
  Actions.
- Every LOCAL handler first checks server-only
  `ASSESSMENT_DEPLOYMENT_MODE=local`.
- In ONLINE mode, LOCAL handlers return `404` or a generic mode-disabled error
  before parsing study inputs, calling Supabase, or touching the filesystem.
- The LOCAL server calls service-role-only LOCAL RPC wrappers. Anonymous
  browsers receive no direct execution grant on those functions.
- Participant ID and session are trusted only because the process is local and
  loopback-bound. This mode is not suitable for LAN or Internet exposure.

No client-side boolean, query parameter, cookie, build branch, or failed Auth
request can activate LOCAL mode.

## 8. Study mode and session binding

LOCAL and ONLINE share one Supabase project, so one global study-mode row cannot
safely represent both environments. Add an environment-scoped configuration
table without changing the old table during transition:

```text
private.assessment_runtime_channels
  runtime_channel text primary key check in ('local', 'online')
  study_mode text not null check in ('dev', 'formal')
  updated_at timestamptz not null default now()
```

Seed both channels from the current authoritative mode, then allow the study
operator to change LOCAL independently. The participant UI never writes this
table.

Add a credential-free session binding table:

```text
private.assessment_session_context
  participant_id text not null
  session_number integer not null check between 1 and 3
  runtime_channel text not null check in ('legacy', 'local', 'online')
  study_mode text not null check in ('dev', 'formal')
  created_at timestamptz not null default now()
  primary key (participant_id, session_number)
```

On first start, the appropriate wrapper binds the participant/session to its
hard-coded channel and the channel's database-configured study mode. Every
resume, response, and video authorization requires the same binding. A
participant/session created in LOCAL cannot later be opened in ONLINE, or vice
versa. This prevents shared-database test activity from silently merging with a
public study session while preserving the analysis key of participant ID plus
session number.

`legacy` exists only for migration of queues whose origin was not previously
recorded. A legacy session may be claimed once, atomically, by LOCAL or by the
correct authenticated ONLINE account, only when its recorded study mode matches
the selected channel. New sessions never use `legacy`.

## 9. Database and RPC design

### 9.1 Shared private business functions

Move queue, response, event, and current-order rules behind private functions
that receive an already resolved participant ID. These functions retain the
existing advisory locks, exact eligible-pool checks, randomization, queue
validation, first-unanswered-order checks, atomic event/response insertion,
derived correctness/timing fields, and idempotent retry comparison.

The private functions are not exposed through the Data API and grant no execute
privilege to `PUBLIC`, `anon`, or `authenticated`.

### 9.2 LOCAL wrappers

Create separately named LOCAL entry points, for example:

```text
start_or_resume_assessment_local(participant_id, session_number)
submit_video_response_local(participant_id, session_number, ...payload)
authorize_current_assessment_video_local(participant_id, session_number, video_order)
```

All are executable only by `service_role`. They hard-code the `local` channel,
resolve its database study mode, enforce the session context, and then call the
shared private business functions. The LOCAL video authorization result includes
only the canonical current `video_id` and relative `file_path` required by the
server route; it never accepts or returns an absolute local path.

### 9.3 ONLINE wrappers

Create separately named ONLINE entry points:

```text
start_or_resume_assessment_online(session_number)
submit_video_response_online(session_number, ...payload)
authorize_current_assessment_video_online(auth_user_id, session_number, video_order)
```

The start and response wrappers are executable only by `authenticated`. They do
not accept `participant_id`. Each call requires a non-null `auth.uid()`, looks
up one active mapping row, obtains the canonical participant ID, hard-codes the
`online` channel, validates session context, and invokes the private function.

The video authorization wrapper is executable only by `service_role` because it
returns `bucket` and `file_path`. The authenticated video Edge Function first
validates the user JWT, obtains the Auth UUID, and then supplies that verified
UUID. The function repeats account mapping, session-context, first-unanswered
order, and queue membership checks before returning one Storage object.

Authenticated role membership alone is never sufficient authorization. Every
ONLINE function must bind `auth.uid()` or the Edge-verified Auth UUID to the
private participant mapping.

### 9.4 Result payloads

ONLINE browser payloads omit `participant_id`; PostgreSQL derives it from the
Auth mapping. LOCAL browser payloads include participant ID only to the local
Next.js server, which invokes the LOCAL service wrapper.

Both paths insert the same final records into:

- `assessment_queue`;
- `responses`;
- `lesion_detection_events`.

No result-table columns are duplicated or renamed. `responses.id` and
`created_at` remain database-generated. Positive summaries still use the first
valid lesion click; negative summaries keep lesion detection time null. Deleted
unsubmitted marks are not uploaded.

## 10. LOCAL video streaming

### 10.1 Path mapping

Reuse `videos.file_path` exactly as a relative local path:

```text
LOCAL_VIDEO_ROOT=/Users/.../colonoscopy-videos
videos.file_path=video_001.mp4

resolved file=/Users/.../colonoscopy-videos/video_001.mp4
```

Do not add `local_path`. `videos.bucket` remains relevant to ONLINE Storage and
is ignored by LOCAL playback after authorization.

### 10.2 Controlled route

Expose a LOCAL-only route such as:

```text
GET /api/local/video/current?participant_id=...&session_number=...&video_order=...
HEAD /api/local/video/current?participant_id=...&session_number=...&video_order=...
```

For every request, including every Range request, the route:

1. Requires server mode `local`.
2. Validates participant ID, session number, and positive video order.
3. Calls `authorize_current_assessment_video_local` through the server-only
   service client.
4. Uses only the returned canonical `file_path`; a browser-supplied `video_id`
   or path is never used for filesystem access.
5. Resolves the path under `LOCAL_VIDEO_ROOT` and verifies containment.
6. Verifies that the resolved target is a regular MP4 file.
7. Streams the requested bytes.

Knowing a video ID, guessing a filename, or requesting a future video order is
insufficient. The database must confirm that the order is the first unanswered
queue item for that participant/session.

### 10.3 Traversal and symlink protection

Reject:

- empty paths;
- absolute paths;
- NUL bytes;
- `.` or `..` traversal segments;
- non-MP4 targets;
- directories;
- symlinks whose real target leaves the configured root.

Resolve the real root and real target, then verify `path.relative(realRoot,
realTarget)` is neither absolute nor prefixed by `..`. Do not rely on string
prefix comparison alone.

### 10.4 HTTP Range behavior

The route supports HTML5 seeking and replay:

- No `Range` header: return `200 OK` with the complete stream.
- Valid single byte range: return `206 Partial Content`.
- Include `Accept-Ranges: bytes`, `Content-Type: video/mp4`, accurate
  `Content-Length`, and `Content-Range` for partial responses.
- Support open-ended and suffix byte ranges.
- Reject malformed, multiple, unsatisfiable, or out-of-bounds ranges with
  `416 Range Not Satisfiable` and `Content-Range: bytes */<size>`.
- `HEAD` returns the same applicable headers without a body.
- Stream from disk; do not read the entire MP4 into memory.

If the authorized file is missing, return a clear LOCAL configuration error
that identifies the authorized `video_id` for the operator but does not expose
the absolute root or resolved filesystem path to the browser. Never request a
Supabase Storage URL as fallback.

## 11. ONLINE private video delivery

Keep private Supabase Storage and signed URLs. Introduce a versioned
authenticated Edge Function during migration, for example
`issue-assessment-video-url-v2`, so the currently deployed access-code function
remains available for rollback.

The v2 flow is:

1. Browser invokes the function with its Supabase user JWT and project
   publishable key.
2. Edge gateway JWT verification remains enabled for this function.
3. The handler validates the current user and accepts only `session_number` and
   `video_order`; it does not trust a browser participant ID.
4. The handler calls the service-only ONLINE video authorization RPC with the
   verified Auth UUID.
5. PostgreSQL maps the Auth UUID to the canonical participant, verifies channel,
   session, queue, and first-unanswered order, and returns one `bucket` and
   `file_path` to the Edge Function only.
6. The service client creates the temporary private Storage signed URL.
7. The browser receives only the signed URL, order, and expiry metadata.

The Storage bucket remains private. The function does not list objects, return
raw Storage paths, accept arbitrary video IDs, or fall back to LOCAL files.

## 12. Removal of Study access code

The active final UI contains:

- LOCAL: participant ID and session number;
- ONLINE: participant ID, password, and session number.

It contains no Study access code field, default code, code validation, code ref,
RPC parameter, Edge Function parameter, documentation instruction, or test
fixture.

The final active database API contains no access-code argument or digest check.
Supabase Auth replaces participant authentication ONLINE; loopback server mode
replaces it LOCAL.

Do not immediately drop the old functions or access tables. They remain only as
a temporary rollback boundary and receive no new design features. After the new
ONLINE release and rollback window succeed, a dedicated cleanup migration:

1. revokes anonymous execution of the old access-code RPC signatures;
2. removes the old access-code Edge Function after its rollback window;
3. archives or exports the old access mapping counts for deployment records;
4. drops `assessment_session_access` and `assessment_enrollments` only after
   confirming the new Auth mapping and session context cover every active
   ONLINE participant/session;
5. removes obsolete access-code code, tests, and documentation.

The uncommitted `remove_assessment_access_code.sql` is superseded because it
combines destructive cleanup with anonymous no-auth grants.

## 13. Migration strategy

### Phase A: live-schema and data preflight

Before any Supabase write:

1. Inspect the live function signatures, owners, grants, RLS state, Storage
   policies, and Edge Function configuration.
2. Determine whether the live database is the access-code schema, the
   no-access-code experiment, or a mixed state. Repository files are not proof
   of live state.
3. Record row counts and distinct participant/session counts for `videos`,
   `assessment_queue`, `responses`, and `lesion_detection_events`.
4. Record duplicate checks, orphan checks, queue-order continuity, response
   uniqueness, and event-to-response linkage.
5. Export a rollback-safe schema snapshot and backup before migration.

If live state cannot be identified unambiguously, stop with
`BLOCKED_BY_ENVIRONMENT`; do not substitute guessed SQL.

### Phase B: additive database migration

Without changing or dropping current production objects:

1. Create the private participant account mapping table.
2. Create environment-scoped runtime configuration.
3. Create session context.
4. Create private shared business functions.
5. Create new LOCAL and ONLINE wrapper functions with new names.
6. Apply explicit `REVOKE` and least-privilege `GRANT` statements.
7. Seed channel modes from the existing authoritative mode.
8. Populate legacy session context without changing queue or result rows.

The new wrappers must also handle sessions created by the still-running old
release after this additive migration. If a queue has a valid historical access
binding but no new context row, the first new-wrapper request materializes a
`legacy` context inside the same advisory-locked transaction before applying the
normal one-time claim rules. This prevents a queue created during the migration
window from becoming orphaned.

For existing queues, derive study mode first from the historical session access
or enrollment record. If those records do not exist, compare the exact queued
video set against eligible DEV and FORMAL pools. Infer only when exactly one
mode is a complete match. Mark the channel `legacy`; never guess LOCAL versus
ONLINE from participant naming, timestamps, or directory order. Report and
manually resolve ambiguous sessions before cutover.

### Phase C: LOCAL implementation on `main`

Implement LOCAL UI, server routes, LOCAL RPC adapter, and Range streaming on
`main`. Use only the additive new database objects. Do not deploy a modified
existing ONLINE Edge Function, do not alter `release`, and do not change the
running ECS process.

Because the database is shared, LOCAL test participant IDs must not reuse
active ONLINE participant/session keys. The session-context constraint provides
the final enforcement.

### Phase D: ONLINE Auth preparation

1. Provision Supabase Auth accounts and private mappings.
2. Deploy the new participant sign-in function.
3. Deploy the new versioned authenticated video function.
4. Test ONLINE Auth and authorization without modifying the old production
   function names.
5. Verify one password resumes all three sessions for the mapped participant,
   while another participant cannot access them.

### Phase E: manual release and cutover

After LOCAL and ONLINE tests pass and the user explicitly approves release:

1. Promote only approved commits from `main` to `release` using the documented
   manual workflow.
2. Record the current ECS commit.
3. Deploy `origin/release` manually.
4. Run HTTP, Auth, queue, signed-video, response, resume, and completion smoke
   tests.
5. Keep old database functions, old Edge Function, and access tables intact for
   rollback.

If rollback is needed, restore the previous ECS commit and old Edge Function;
the additive database objects do not prevent the old access-code application
from running.

### Phase F: delayed cleanup

Only after an explicit second approval and a completed rollback window:

1. Re-run preservation counts and integrity checks.
2. Revoke and remove old access-code entry points.
3. Remove obsolete access tables after recording their migration audit.
4. Keep all videos, queues, responses, events, IDs, timestamps, and unique
   constraints unchanged.
5. Verify export/analysis queries against the preserved tables.

No phase uses `DELETE`, `TRUNCATE`, or table recreation on the four protected
research tables.

## 14. Error handling

### Configuration

- Missing/invalid deployment mode: application configuration error; no mode
  selected.
- LOCAL missing root or service key: LOCAL configuration error; no ONLINE
  fallback.
- ONLINE missing Supabase public configuration: ONLINE configuration error; no
  LOCAL fallback.
- Missing channel study configuration: assessment not started.

### Authentication and authorization

- Invalid participant ID, password, inactive mapping, or missing mapping: one
  generic login error.
- Expired/revoked ONLINE session: clear local Auth state and return to login.
- Authenticated user attempts another participant: generic authorization error;
  do not reveal whether the target exists.
- Cross-channel session or wrong study mode: reject without creating or
  reshuffling a queue.
- Future, previous, skipped, or completed video order: generic video access
  denied.

### Video

- LOCAL missing file: clear LOCAL missing/configuration message; no absolute
  path and no Storage fallback.
- LOCAL unsafe path: generic access denied and server-side security log without
  participant password or secret.
- Invalid Range: `416` with standards-compliant size header.
- ONLINE signing failure: remote video preparation error; no local fallback.

### Submission

- A failed Supabase commit does not count as completed and leaves the response
  retryable.
- Exact retries remain idempotent; differing duplicate payloads remain rejected.
- The client advances only after the database confirms success.

## 15. Security boundaries

1. `ASSESSMENT_DEPLOYMENT_MODE` and `LOCAL_VIDEO_ROOT` are server-only.
2. ECS does not contain local paths or a LOCAL server service-role secret.
3. The browser never receives the service-role key.
4. LOCAL service-role usage is confined to loopback-only Next.js server code.
5. ONLINE authorization is based on Auth UUID mapping, never browser
   participant ID or editable user metadata.
6. ONLINE start and submit RPCs derive participant ID inside PostgreSQL.
7. Video authorization repeats current-order checks independently of the UI.
8. `bucket` and `file_path` remain hidden from ONLINE browsers.
9. LOCAL filesystem resolution uses a database-authorized path and realpath
   containment.
10. Private functions and mapping tables are not directly executable/readable
    by `anon` or `authenticated`.
11. Every `SECURITY DEFINER` function has a trusted owner, empty search path,
    schema-qualified objects, explicit input validation, explicit grants, and
    tests for unauthorized callers.
12. Credentials, JWTs, passwords, service keys, raw local paths, and signed URLs
    are excluded from application logs.
13. CORS is restricted to the configured ONLINE origin for authenticated Edge
    Functions; wildcard CORS is not retained for the final public path.

## 16. Testing and verification

### Static and unit tests

- Runtime mode parser accepts only `local` or `online` and fails closed.
- Client mode display cannot authorize a server route.
- LOCAL and ONLINE adapters satisfy the same assessment contracts.
- Existing timing, mark deletion, yes/no exclusivity, response snapshot, and
  completion tests remain unchanged.
- Entire project contains no active Study access code UI or payload after final
  cutover.

### SQL and migration tests

- New tables and functions are additive during transition.
- `anon` cannot execute LOCAL, ONLINE, private, response, or video authorization
  functions.
- `authenticated` can execute only ONLINE start and submit wrappers.
- ONLINE wrappers reject null or mismatched `auth.uid()` mappings.
- LOCAL and video authorization wrappers are service-role-only.
- Session context prevents cross-channel and cross-mode reuse.
- Existing queue order, response IDs, event IDs, timestamps, and row counts are
  unchanged by migration.
- Existing unique constraints and exact retry behavior still hold.
- Formal sessions still require exactly 40 eligible videos from their own pool.

### Auth integration tests

- Coordinator creates an account without exposing the service key.
- UI logs in with participant ID and password, not email.
- Wrong ID and wrong password produce indistinguishable errors.
- One Auth account starts/resumes Sessions 1, 2, and 3 independently.
- Editing participant ID after login cannot change the database participant.
- A second Auth account cannot read, resume, submit, or authorize the first
  participant's session.
- Deactivated accounts are denied.

### LOCAL video tests

- Complete response returns `200` and correct headers.
- Valid start-end, open-ended, and suffix ranges return `206` and exact bytes.
- Invalid or multiple ranges return `416`.
- Seeking and replay work in a real HTML5 video element.
- Missing file returns the LOCAL-specific error.
- Absolute paths, `..`, encoded traversal, NULs, directories, and escaping
  symlinks are rejected.
- Future video order and completed video order are denied.
- Supabase Storage is never called in LOCAL mode, including failure paths.

### ONLINE video tests

- Missing or invalid JWT is rejected before signing.
- Auth identity is mapped to the correct participant.
- Current order receives one private signed URL.
- Future, skipped, previous, and completed orders are rejected.
- LOCAL filesystem APIs and paths are never called in ONLINE mode.
- Storage remains private and direct anonymous reads fail.

### End-to-end verification

For both LOCAL and ONLINE, verify:

1. first start creates one persisted randomized queue;
2. refresh resumes the first unanswered video;
3. Sessions 1, 2, and 3 stay isolated;
4. a response and lesion events commit atomically;
5. duplicate protection and exact retry work;
6. completion is dynamic from queue length;
7. DEV and FORMAL pool rules remain correct;
8. resulting Supabase rows remain directly exportable for analysis.

Run `npm run typecheck`, `npm test`, and `npm run build` before any manual
promotion. Database migrations additionally require live-schema preflight,
transactional verification, post-migration counts, privilege inspection, and
real browser smoke tests.

## 17. Branch and release safety

- `main` remains the active local development branch.
- LOCAL implementation commits go only to `main` until explicitly approved.
- `release` remains at its known-good public commit during LOCAL work.
- Shared Supabase changes made before release are additive and use new names, so
  the running access-code release remains functional.
- Existing Edge Function names used by ECS are not overwritten during LOCAL or
  pre-release ONLINE testing.
- Promotion is manual fast-forward or selective cherry-pick according to
  `docs/environment-and-release-workflow.md`.
- ECS fetches and deploys only `origin/release`.
- No CI/CD, webhook, scheduled deployment, branch synchronization, or automatic
  database migration is added.
- The single ECS directory remains
  `/var/www/deskilling/colonoscopy-assessment-platform`.

## 18. Acceptance criteria

The architecture is complete only when all of the following are true:

1. LOCAL accepts participant ID and session only, streams authorized local MP4s
   with Range support, and stores all results in Supabase.
2. ONLINE accepts participant ID and one participant password, uses Supabase
   Auth, and never trusts browser participant identity.
3. LOCAL and ONLINE cannot fall back to each other.
4. DEV/FORMAL, queue, resume, response, timing, event, and completion behavior
   remain unchanged.
5. Existing research/test rows are preserved exactly.
6. The old Study access code is absent from the final active UI and API, but its
   rollback path is retained until separately approved cleanup.
7. `release` and the public ECS deployment change only after explicit manual
   promotion and deployment approval.

## 19. Supabase references verified for this design

- Password sign-in:
  <https://supabase.com/docs/guides/auth/passwords>
- Server-only Auth account provisioning:
  <https://supabase.com/docs/reference/javascript/auth-admin-createuser>
- Auth-user data mapping and primary-key references:
  <https://supabase.com/docs/guides/auth/managing-user-data>
- Edge Function authorization headers and JWT verification:
  <https://supabase.com/docs/guides/functions/auth-headers>
- Auth context inside Edge Functions:
  <https://supabase.com/docs/guides/functions/auth>
- Supabase password storage:
  <https://supabase.com/docs/guides/auth/password-security>
