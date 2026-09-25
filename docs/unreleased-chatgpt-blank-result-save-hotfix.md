# ChatGPT Blank Placeholder Result Save Hotfix

Date: 2026-09-12. Source version remains 1.2.4. The fixed installer was packaged and placed on the desktop, but has not been installed or committed.

## Symptom

During desktop ChatGPT generation, the page could create a full-size white placeholder canvas before the generated image pixels had been painted. The automation accepted that placeholder as a result and saved multiple white JPG files into the project folder.

## Root Cause

- The result candidate was considered loaded from its dimensions alone.
- Canvas extraction captured the current pixels, even when those pixels were still the white placeholder.
- Candidate stability compared the DOM identity and dimensions, but not the pixel content.
- A generation control that remained active for 20 seconds could be treated as settled.
- The result validation checked image MIME/data size but did not reject near-uniform placeholder pixels.

## Fix

- Added src/main/chatGptImageReadiness.ts using the existing sharp dependency to inspect a small decoded image sample.
- Rejects empty, transparent and near-uniform placeholder content while accepting images with meaningful luminance or edge variation.
- Requires the generation controls to be inactive.
- Requires the same non-placeholder pixel content to pass two consecutive readiness checks.
- Clears the readiness streak if generation becomes active again or the candidate changes.
- Passes the last validated data URL into the save path and checks it again immediately before ChatGPT JPG persistence.
- The existing hard deadline, checkpoint and no-automatic-resend behavior remain unchanged.

## Verification

- Red test reproduced the same-size white-canvas placeholder being accepted by the old contract.
- Targeted readiness tests: 2/2 passed.
- Targeted automation and readiness tests: 25/25 passed.
- Full npm test: 280/280 passed.
- The full build and TypeScript checks completed successfully.
- Electron shell, result persistence and packaged Windows compatibility verification passed.
- Installer: D:\Yaochuang-Workshop\Worktrees\yaochuang-0.1.2-from-0.1.1\release\Yaochuang-Workshop-1.2.4-Setup.exe
- Desktop copy: D:\Hale_Files\Desktop\耀创工坊 1.2.4 一键安装包.exe
- Installer size: 137796930 bytes. SHA-256: 7925542BBEF454D4D2BAE281DDD527A82335EF743A4BEC66BD092B79E7D4A4A4.

## Compatibility And Residual Risk

- No UI, prompt, upload, model, parallel scheduling, original-image, red-circle, reference-image, result archive, checkpoint or user-data behavior was intentionally changed.
- Gemini and API result persistence use their existing paths; the new readiness gate is applied to the ChatGPT result path only.
- The readiness check is designed for generated photographs and may require review if ChatGPT later introduces a legitimate intentionally uniform image format.
- Live account generation remains pending user acceptance testing. The packaged app was verified for startup compatibility but has not been installed.

## Lesson

An image element being present, decoded and dimensionally correct is not proof that its visual content is final. Result automation must validate content readiness and preserve the exact validated snapshot used for persistence.
