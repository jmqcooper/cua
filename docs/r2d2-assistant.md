# R2D2 assistant fork

This branch adds a persistent Linux personal assistant to Cua Spaces. It reuses the upstream desktop shell, native daemon, computer tools and app-core WASM from the exact `cua-spaces-v0.11.0` release, commit `039eb33770c300e59b8342017250ff3a0191469a`.

The Assistant route runs Hermes with the signed-in Codex subscription or unmodified Claude Code with its native subscription. Inference requests are not sent through a Cua API key, an API fallback or a proxy for subscription tokens. Provider credentials remain in native stores. Each named assistant has a resumable native session, persistent messages, a job queue and optional interval routines. A private Unix-socket controller survives window closure.

Computer tools use a dedicated local Cua Space. Its MCP wrapper starts it lazily, rejects other sandbox targets and blocks during gaming. The controller stops its own desktop to release RAM during gaming or after ten idle minutes. Jobs run one at a time in the existing low-priority worker slice. The normal host desktop remains separate.

The existing Hermes Telegram gateway, Google account connections and shared GBrain remain the authorities for those integrations. The app does not create a second Telegram poller or copy Google tokens into a guest desktop. Interval routines save results in the Cua conversation. Existing Hermes Telegram routines remain independent.

## Build

On Linux x64, with Node 24 or later, pnpm, gh and dpkg-deb:

```sh
python3 apps/cua-spaces-desktop/scripts/build-r2d2.py
```

The script verifies the pinned release deb against its SHA-256 checksums, extracts matching native binaries and WASM into ignored build directories, then builds the web UI, Electron shell and deb. It does not require a new Rust toolchain. Existing root and component licenses and contributor history are preserved. The SDK and application licenses remain upstream's licenses.

The integration installer, user-service definitions and private configuration merge are maintained in Mike's private Fleet repository, `integrations/cua`. The reviewed deb installs root-owned application resources and Ubuntu's sandbox profile. Fleet deploys the reviewed fork's controller and lazy MCP bridge into `~/.local/share/cua-assistant` for the user service, preserving independent backend updates. Do not deploy the development smoke test's `--no-sandbox` argument as the installed launcher.

## Verification

```sh
cd apps/cua-spaces-desktop
node --test controller.check.mjs
pnpm exec vitest run test/assistant.test.ts
cd ../cua-spaces-web
CUA_ASSISTANT_LIVE_TEST=1 node scripts/assistant-smoke.mjs
CUA_ASSISTANT_LIVE_TEST=1 node scripts/assistant-desktop-smoke.mjs
```

The smoke test uses the development Electron host. Packaged release fuses disable Node inspection, so the installed package is checked through its normal desktop launch rather than Playwright attachment. The smoke test is explicitly opt-in. It launches the actual Electron app and uses the real local assistant service and subscription. It creates a verification turn, searches GBrain, opens routines and toggles the queue. It briefly shows the owned window without taking focus for its screenshot. The app is then closed and background completion can be checked through the controller.

Checks on r2d2 also covered both native subscription responses, actual Cua MCP screenshots, cold desktop start, disk preservation on stop, the real gaming guard, and persistent background services. Fleet's 14 tests pass.

The complete upstream Electron suite initially passed 655 tests and failed eight, plus the controller's Node test being picked up by Vitest. The Node test now has a separate filename and command, the added Electron method is accounted for in its contract test, and missing sparse-checkout fixtures were restored. Three remaining assertions were reproduced against unchanged upstream source with the same release binaries: nudges method coverage, nudges adapter arguments and the Linux runtime settings row in Mac fixtures. They are upstream release/test mismatches, outside this integration. The web suite passed 454 tests, skipped 204 opt-in/native cases, and has one unrelated released-WASM drop-well wording assertion. The new bridge, packaging and release tests pass, 26 tests, as do the five controller tests. Both native subscriptions completed Cua screenshot tasks; Codex additionally typed into its terminal. A dated GBrain fact was written and read back through the native subscription. The first native MCP test exposed missing unattended approval support in Hermes; the dedicated Cua server and selected local GBrain maintenance writes now have explicit native Codex tool approval policy. Global shell permissions were not relaxed. Paid GBrain synthesize and submit_agent tools are disabled. Linux is the verified platform for this fork; the cross-platform desktop matrix was not run.

The installed Linux package was also checked through its normal sandboxed launcher on 2026-10-21: a message submitted in the UI completed through the subscription, memory search returned dated evidence, and the desktop viewer opened. That check found a lifecycle mismatch: direct Docker starts and stops left Cua's saved power state unchanged. The controller now updates power through Cua and then fully stops the container to release RAM. The opt-in desktop regression covers two cold starts, viewer registry state, guest readiness, resource limits and idempotent full stops.

## Limits

This is a single-owner first version. Subscription limits still apply; it does not pool one consumer subscription for employees. Claude permission prompts cannot be approved interactively from this first UI; the dedicated Cua, GBrain and read-only Google tools are allowed, and other actions retain native CLI permission rules. A failed or interrupted job is shown for review rather than automatically repeating an external action. Routines use intervals, not a wall-clock calendar.

The desktop uses Docker runc on this machine, with 2 CPUs and 3 GB RAM, without a shared host browser profile. It is not a VM or gVisor sandbox. Cua cloud features retain their own sign-in requirements. Personal health imports and device collection are separate work. iOS builds remain on the Mac.

## Local source tools

The Fleet integration `integrations/life` supplies the owner-only `r2d2-life` MCP tools for source status, structured health measurements, archived meeting sources and requesting the managed inbox worker. Claude's native allowed-tool list includes this local server alongside the existing Cua, GBrain and read-only Google connections. Codex and Claude both called the new tools successfully on 2026-10-21. Health imports require actual owner exports; an empty metrics list is not a connected health device. The source worker and optional daily knowledge review run on r2d2 and respect the existing gaming pause.
