# Design phases and verification

The continuation uses the five phases in the owner's UI research supplied on 2026-11-26.

1. Audit the existing screens and flows against the design references and product contracts.
2. Reuse the established typography, semantic colors, spacing, and components.
3. Improve landing, sign in, customer requests, provider home, and admin operations.
4. Add meaningful statistics, request timelines, loading skeletons, and error states.
5. Verify responsive layouts, keyboard use, RTL, translations, and complete journeys.

## Review corrections on 2026-11-26

The review found and corrected an online payment label on the full job price, draft legal text marked final, unavailable dashboard data shown as zero, regional revenue combined under a misleading period, and provider stages labelled as request states. Customer summaries now use valid definition lists. Public logos return home and authenticated logos lead to each role's home.

Request ownership resolves before the detail loading boundary streams, preserving HTTP 404 for inaccessible and malformed request IDs. The skip link precedes navigation and focuses the main content in each page shell.

## Evidence

PR #79 merged as `fcf85c5`. GitHub Actions run 45907236079 passed checks, the build, database tests, security advisors, secret scanning, and all 176 e2e journeys. The public visual suite captured landing, login, and 404 in ar, tr, and en at 390px and 1440px and checked keyboard navigation and overflow. The public-visual-qa artifact contains only these public pages.

Run 45898290212 passed the public visual matrix and 170 journeys, then found analytics assertion ordering failures. Run 45903435696 passed those fixes with 174 journeys and found two provider onboarding accessibility waits. The final run passed after the checks observed batched analytics before navigation and waited for rendered form readiness before accessibility scans. Unit tests were 1887 passed, 2 skipped, and 1 todo. Automated accessibility checks cover their tested paths and do not establish comprehensive WCAG conformance.

Legal draft approval and the production launch gate remain pending under the existing product decisions.
