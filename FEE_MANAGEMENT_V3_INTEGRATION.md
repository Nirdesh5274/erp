# Fee Management V3 Integration Guide

This guide explains how to enable and use the normalized fee module added in this repository.

## 1) Scope

V3 fee tables:
- `fee_structures`
- `fee_components`
- `student_fees`
- `student_fee_items`
- `payments`
- `receipts`

Legacy fee tables are still present for backward compatibility.

## 2) Apply Database Migration

Run SQL in this order:
1. Existing schema baseline (if not already applied)
2. `supabase/fee_management_v3.sql`

Use Supabase SQL Editor or your migration runner.

## 3) Admin Flow (V3)

### Structure setup
- Open `/admin/fee-structures`
- Create a structure for a slot and academic year
- Add component rows (tuition, lab, exam, etc.)

API used:
- `GET /api/admin/fee-structures`
- `POST /api/admin/fee-structures`
- `PATCH /api/admin/fee-structures/:id`
- `DELETE /api/admin/fee-structures/:id`

### Student fee assignment
- In `/admin/fee-structures`, choose student + structure
- Assign due date / grace days

API used:
- `POST /api/admin/student-fees/assign`

### Payments
- Record payment against `student_fees`

API used:
- `POST /api/admin/payments`
- `GET /api/admin/payments?studentFeeId=<id>`

### Adjustments
- Add discount/fine/extra to a student fee

API used:
- `POST /api/admin/student-fees/:id/adjustments`

## 4) Student Flow

### Ledger view
- Open `/student/ledger`
- Student sees full statement: fee headers, items, payments, receipts

API used:
- `GET /api/student/ledger`

### Receipt rendering
- Printable endpoint supports both legacy and V3 records

API used:
- `GET /api/fees/receipt/:receiptId`

## 5) Reports

Operational reports continue from:
- `GET /api/admin/reports`

This endpoint currently serves dashboard metrics and transaction summaries.

## 6) Compatibility Notes

- Legacy pages under `/admin/fees` and `/student/fees` remain active.
- V3 is enabled in parallel to reduce migration risk.
- Receipt endpoint is dual-compatible (legacy + V3).

## 7) Recommended Cutover Plan

1. Apply V3 migration in staging.
2. Create slot-wise structures in `/admin/fee-structures`.
3. Assign V3 student fees for one department batch.
4. Use `/student/ledger` for validation.
5. Validate reports and receipts.
6. Migrate remaining cohorts.
7. Retire legacy write paths after full validation.
