# ChatGPT September Page Adaptation

Date: 2026-09-07. Source version remains 1.2.4. No release, installation, version bump or commit.

## Evidence And Root Causes

- Current signed-in ChatGPT homepage was inspected through the browser UI. The editor remains `#prompt-textarea`, a contenteditable textbox inside `form[data-type="unified-composer"]`.
- The current intelligence picker uses an aria-labelled `选择模型` menuitem to switch views. It has `aria-expanded`, but no `aria-haspopup`. Its displayed text is the current effort, not the branch name. Inactive model/slider panels remain laid out in the DOM with `inert` and `data-active="false"`.
- Model options observed: `最新`, `GPT-5.6 Sol`, `GPT-5.5`. The old name filter discarded Latest. A panel carrying a model test ID could also shadow its first checked option during deduplication.
- Current image response is a `section[data-turn="assistant"]` without a nested `data-message-author-role="assistant"`. Read-only comparison on the same loaded conversation: old assistant count 0; updated count 1; composer present. There was no generated image rendered in that inspected response, so this is not evidence of a completed generation.
- Production diagnostics at 2026-09-07 10:14-10:17 UTC show task 1 uploaded, submitted and saved, then task 2 uploaded and submitted but exited after 60729 ms with `exitAction=no-signal`, assistant count 0, message-node count 3, no candidate, no busy/stop control. This is consistent with the reproduced missing assistant-turn signal, not proof that every upstream failure is a selector problem.
- New reasoning sliders announce their level via the keyboard menuitem's `aria-describedby`. The thumb is aria-hidden and lacks `aria-valuetext`; the opened composer pill says only `思考强度`. Reading an inactive slider or just the pill produces stale/unknown effort.

## Narrow Fix

- Exclude inert/inactive model panels. Read the model branch's accessible name and include the actual Latest option without inventing a fixed underlying model identity.
- Prefer actionable option nodes over model panel wrappers. After a trusted selection, verify the checked option when the collapsed pill only shows a shorthand plus effort. No repeated model selection is used as confirmation.
- Read active reasoning announcements and preserve the reasoning gate for Latest outside direct mode.
- Count current assistant sections and nested message markers once per reply. Apply the same counting to send baselines, analysis extraction and generated-result waiting. Keep user-image exclusion and old-source baselines.
- No new dependencies, queue/state-machine changes, API changes, UI redesign or timeout extension. Minimal direct mode still bypasses model/effort discovery.

Changed files: `src/main/index.ts`, `src/main/chatGptReasoningControl.ts`, `src/shared/chatGptModelPolicy.ts`, `tests/chatGptIntelligencePicker.test.mjs`, `tests/fixtures/chatgpt/intelligence-picker.html`, this record and `docs/MAINTENANCE_HANDOFF.md`.

## Tests

New `tests/chatGptIntelligencePicker.test.mjs` and the synthetic `intelligence-picker.html` fixture execute compiled production page scripts in isolated Chrome:

1. Model branch activation, hidden-option exclusion, Latest enumeration and selection: red (branch never opened), then green.
2. Trusted selection with abbreviated pill: red (unconfirmed), then green; selection click count remains one.
3. Latest reasoning gate: red, then green; Latest never aliases a concrete GPT version.
4. New assistant turn, mixed nested marker, analysis text and image baseline: red (0 vs 1 reply), then green. New image accepted; old image and composer attachment excluded.
5. Active keyboard announcement vs inert slider: red (low instead of extreme), then green.

Final `npm test`: 271/271 passed, including the 5 additions. `npm run typecheck` passed.

After building, existing verification scripts were run directly against those compiled artifacts:

- `verify-chatgpt-model-page-fixtures.mjs`: passed, including 20 repeated catalog cycles and bounded reasoning cases.
- `verify-chatgpt-upload-page-fixtures.mjs`: passed; two real preview signals, busy gate, unrelated input exclusion, one trusted send and one protection acknowledgement in fixture.
- `run-result-persistence-verification.mjs`: passed; dimensions, orientation and guarded recovery.
- `verify-electron-shell.mjs`: passed, no renderer errors; isolated shell screenshot visually inspected.
- `verify-web-pose-ui.mjs`: passed.
- `verify-adaptive-canvas-ui.mjs`: passed six sizes and native window bounds.
- `verify-face-occlusion-ui.mjs`: passed, no page errors.
- Gemini fixture business assertions passed on the first run, but cleanup exited with Windows EPERM on its isolated temporary profile. A separate rerun passed all assertions and exited 0. This is recorded separately from business validation.
- Scoped `git diff --check`: passed; only existing Windows line-ending notices.

## Boundaries And Review

Reviewed model identity, inactive controls, checked-state confirmation, response deduplication, source baselines and unchanged direct/protection behavior. No further blocking defect identified in this patch.

Live inspection used CUA browser controls; `js_repl` required by playwright-interactive was not available. Existing Playwright/Chrome/Electron fixture scripts provided isolated executable verification instead. This is not a claim of a completed interactive-skill Electron session.

No new real-account prompt or image was submitted. The briefly changed homepage model was restored to Latest/extreme. Real upload/generation/download after the patch remains a user acceptance boundary. No private conversation API, credentials, cookies, full prompts or real images were exported into fixtures or documentation.

The fix addresses observed DOM mismatches, not server-side refusal, access protection, quota, network disconnection or a response that contains no image. It cannot guarantee zero future failures or compatibility with unobserved account rollouts. Existing user data, checkpoints and dedicated Chrome profiles remain intact; installed and desktop packages are unchanged.
