---
name: refactor-safely
description: Restructure code without changing behavior.
triggers: [refactor, rename, restructure, cleanup, extract, migrate, simplify, reorganize]
risk: medium
---
- Confirm tests pass before starting; add characterization tests if coverage is thin.
- Change structure in small steps and run checks after each step.
- Do not mix behavior changes into a refactor.
- Follow the project's existing naming, folder and import conventions.
