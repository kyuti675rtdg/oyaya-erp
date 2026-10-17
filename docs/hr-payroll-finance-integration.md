# Module 15 — HR & Payroll: Finance Integration Point

When an HR payroll run is posted (`POST /api/v1/hr/payroll-runs/:id/post`,
permission `hr:approve`), the backend writes a balanced payroll journal via
`postJournal()` in `packages/api/src/modules/finance/service.ts`
(see `postHrPayrollRun()` in `packages/api/src/modules/payroll/hr.service.ts`).

## Journal layout

| Line | Account | Debit | Credit |
|------|---------|-------|--------|
| 1 | 6000 Payroll Expense | gross + allowances | — |
| 2 | 2000 Accounts Payable | — | deductions (memo: "Payroll deductions withheld") |
| 3 | 2000 Accounts Payable | — | net pay (memo: "Net pay payable to staff") |

- `module = 'payroll'`, `referenceType = 'PayrollRun'`, `referenceId = <run id>` —
  traceable from Finance → the originating payroll run.
- `PayrollRun.journalEntryId` stores the created `JournalEntry` id.
- Payslips are generated in the same transaction as posting.

## Run lifecycle & locking

`DRAFT` → (compute) → `APPROVED` (`hr:approve`) → `POSTED` (`hr:approve`).
A `POSTED` run is locked: compute/approve endpoints reject further mutation
of the period (HTTP 409), and posting is idempotent-guarded by
`journalEntryId`.

## Prerequisites for posting

- Chart of accounts contains active `6000` (Payroll Expense) and `2000`
  (Accounts Payable) — seeded by default.
- The run must be `APPROVED` and contain at least one line with a positive
  total cost.
