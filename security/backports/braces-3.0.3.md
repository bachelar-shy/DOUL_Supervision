# Local `braces@3.0.3` security backport

The lockfile intentionally retains the published `braces@3.0.3` package and registry integrity. The install-time script applies a checksum-verified subset of upstream `micromatch/braces` PR [#72](https://github.com/micromatch/braces/pull/72), pinned to head commit [`28d440b5dd449dbf1fe6f3506cf94ecca4d02660`](https://github.com/micromatch/braces/commit/28d440b5dd449dbf1fe6f3506cf94ecca4d02660). The backport contains the PR's parser depth limit, recursive AST traversal guards, nested-brace stringification correction, and cycle guard. It excludes unrelated changes in the PR branch history, including quote parsing changes.

The upstream PR was closed unmerged and no fixed release was published as of 2026-10-10. This local change does not claim an official fixed version or resolve GHSA-vfj7-8cjw-p6xm. The installed dependency remains `braces@3.0.3`, so dependency auditors should continue to report the advisory. Project status: **mitigated by a pinned local backport; upstream release and release review pending**.

The PR sets a default maximum nesting depth of 100 for brace and parenthesis nesting. Patterns exceeding this limit now throw a deterministic error; previously accepted patterns deeper than 100 may require adjustment. The option cannot raise the hard maximum above 100.

The upstream package's MIT license and copyright notice remain in `node_modules/braces/LICENSE`. The backport only modifies its existing JavaScript source files and adds no new runtime dependency.
