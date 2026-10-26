---
name: test-first
description: Write or update a failing test before changing behavior; cover edge cases.
triggers: [bug, fix, regression, feature, endpoint, test, broken, error]
risk: low
---
- Reproduce the problem with a test that fails for the right reason.
- Cover the unhappy paths: empty input, errors, unauthorized users, slow or failed network.
- Make the smallest change that turns the test green, then run the whole suite.
- Tests must assert behavior, not just that code runs.
