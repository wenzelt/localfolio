# Repository cleanup validation

## Scope and journey

No source plan was supplied. The owner requested cleanup of repository files and local Git history while preserving application behavior and license notices.

## Evidence

| Guarantee | Validation | Result |
| --- | --- | --- |
| Tracked paths and text contain no inventoried development-tool markers | External Python unittest, `/tmp/localfolio-cleanup-check.py` | RED: 13 matches before cleanup; GREEN: zero matches after cleanup |
| Deployment exclusions still protect credentials, dumps and private handoff files | `npm test -- src/deployment.test.ts` | 12 tests passed |
| Existing application behavior remains covered | `npm run test:coverage` | 65 files, 755 tests passed |
| TypeScript remains valid | `npm run typecheck` | Passed |
| Static analysis | `npm run lint` | Passed with 31 warnings and 19 informational diagnostics; no fixes applied |

Coverage: statements 85.04%, branches 85.29%, functions 85.71%, lines 87.68%. Each global category exceeds 80%.

## History and recovery

The rewrite removed tool-specific instruction/evidence directories and explicit attribution/session markers across local branches, tags and the stash. Tool-only author identities were replaced with a neutral unattributed identity, not reassigned to the owner. Tool-named refs were renamed under `development/`. Remote-tracking refs became local branches. Commit IDs changed, and rewritten signatures cannot remain valid.

The RED checkpoint remains reachable on the task branch. GREEN file-cleanup checkpoints were pruned as empty because their changes were applied throughout history; the executed results above preserve that evidence. The temporary check lives outside the repository to avoid embedding the markers it detects.

A recovery copy of the original Git metadata and relocated local tooling directories was saved outside the repository. It intentionally retains the original material. No portfolio data was modified.

## Limitations

No browser E2E or production build was run for this cleanup. Responsive screenshot destinations changed to `test-results/responsive/`; browser behavior was not changed. Framework development commands can regenerate instruction files in some environments.

No remote history was changed or pushed. The rewrite tool removed the remote configuration, and restoring it was blocked by the permission system. Hosted branches, pull requests, caches, other clones and the external recovery copy are outside this local cleanup. History cannot establish whether code was written with development assistance.
