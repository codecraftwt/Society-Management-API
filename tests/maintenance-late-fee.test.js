const request = require("supertest");
const express = require("express");

const { calculateLateFee, buildBillLateFeeFields } = require("../utils/lateFeeHelper");

describe("lateFeeHelper - Calendar Month Calculation", () => {
  const baseBill = {
    id: 1,
    amount: 25000,
    due_date: "2026-06-30",
    status: "PENDING",
    late_fee_enabled: true,
    late_fee_type: "FIXED_PER_MONTH",
    late_fee_value: 1000,
    late_fee_grace_days: 0,
    late_fee_max_amount: null,
  };

  test("charges 0 on or before due date (30 June)", () => {
    const res = calculateLateFee(baseBill, { asOfDate: "2026-06-30T22:00:00+05:30" });
    expect(res.overdueMonths).toBe(0);
    expect(res.calculatedLateFee).toBe(0);
    expect(res.totalPayable).toBe(25000);
    expect(res.isOverdue).toBe(false);
  });

  test("charges 1 month on 5 July (₹26,000)", () => {
    const res = calculateLateFee(baseBill, { asOfDate: "2026-07-05T10:00:00+05:30" });
    expect(res.overdueMonths).toBe(1);
    expect(res.calculatedLateFee).toBe(1000);
    expect(res.totalPayable).toBe(26000);
    expect(res.isOverdue).toBe(true);
  });

  test("charges 2 months on 10 August (₹27,000)", () => {
    const res = calculateLateFee(baseBill, { asOfDate: "2026-08-10T10:00:00+05:30" });
    expect(res.overdueMonths).toBe(2);
    expect(res.calculatedLateFee).toBe(2000);
    expect(res.totalPayable).toBe(27000);
  });

  test("charges 3 months on 15 September (₹28,000)", () => {
    const res = calculateLateFee(baseBill, { asOfDate: "2026-09-15T10:00:00+05:30" });
    expect(res.overdueMonths).toBe(3);
    expect(res.calculatedLateFee).toBe(3000);
    expect(res.totalPayable).toBe(28000);
  });

  test("handles mid-month due date (11 Dec): 12-31 Dec is month 1, Jan is month 2, Feb is month 3", () => {
    const midMonthBill = { ...baseBill, due_date: "2026-12-11" };
    expect(calculateLateFee(midMonthBill, { asOfDate: "2026-12-11T22:00:00+05:30" }).overdueMonths).toBe(0);
    expect(calculateLateFee(midMonthBill, { asOfDate: "2026-12-12T10:00:00+05:30" }).overdueMonths).toBe(1);
    expect(calculateLateFee(midMonthBill, { asOfDate: "2026-12-31T10:00:00+05:30" }).totalPayable).toBe(26000);
    expect(calculateLateFee(midMonthBill, { asOfDate: "2027-01-05T10:00:00+05:30" }).overdueMonths).toBe(2);
    expect(calculateLateFee(midMonthBill, { asOfDate: "2027-01-05T10:00:00+05:30" }).totalPayable).toBe(27000);
    expect(calculateLateFee(midMonthBill, { asOfDate: "2027-02-05T10:00:00+05:30" }).overdueMonths).toBe(3);
  });

  test("respects grace period before applying first penalty", () => {
    const billWithGrace = { ...baseBill, late_fee_grace_days: 5 };
    const withinGrace = calculateLateFee(billWithGrace, { asOfDate: "2026-07-05T10:00:00+05:30" });
    expect(withinGrace.overdueMonths).toBe(0);
    expect(withinGrace.calculatedLateFee).toBe(0);
    expect(withinGrace.totalPayable).toBe(25000);

    const afterGrace = calculateLateFee(billWithGrace, { asOfDate: "2026-07-06T10:00:00+05:30" });
    expect(afterGrace.overdueMonths).toBe(1);
    expect(afterGrace.calculatedLateFee).toBe(1000);
    expect(afterGrace.totalPayable).toBe(26000);
  });

  test("applies max_fee_amount cap", () => {
    const capped = { ...baseBill, late_fee_max_amount: 1500 };
    const res = calculateLateFee(capped, { asOfDate: "2026-09-15T10:00:00+05:30" });
    expect(res.overdueMonths).toBe(3);
    expect(res.calculatedLateFee).toBe(1500);
    expect(res.totalPayable).toBe(26500);
  });

  test("supports FIXED_ONE_TIME and compounding PERCENT_PER_MONTH", () => {
    const oneTime = calculateLateFee(
      { ...baseBill, late_fee_type: "FIXED_ONE_TIME", late_fee_value: 1000 },
      { asOfDate: "2026-10-15T10:00:00+05:30" }
    );
    expect(oneTime.calculatedLateFee).toBe(1000);
    expect(oneTime.totalPayable).toBe(26000);

    const pctBill = { ...baseBill, late_fee_type: "PERCENT_PER_MONTH", late_fee_value: 10 };
    expect(calculateLateFee(pctBill, { asOfDate: "2026-07-05T10:00:00+05:30" }).totalPayable).toBe(27500);
    expect(calculateLateFee(pctBill, { asOfDate: "2026-08-10T10:00:00+05:30" }).totalPayable).toBe(30250);
    expect(calculateLateFee(pctBill, { asOfDate: "2026-09-15T10:00:00+05:30" }).totalPayable).toBe(33275);
    expect(calculateLateFee(pctBill, { asOfDate: "2026-10-15T10:00:00+05:30" }).totalPayable).toBe(36602.5);
  });

  test("subtracts multiple approved waivers and formats snake_case fields", () => {
    const waivers = [{ waiver_amount: 600 }, { waiver_amount: 400 }];
    const fields = buildBillLateFeeFields(baseBill, {
      asOfDate: "2026-08-10T10:00:00+05:30",
      waivers,
    });
    expect(fields).toEqual({
      base_amount: 25000,
      late_fee: 1000,
      calculated_late_fee: 2000,
      waived_amount: 1000,
      total_payable: 26000,
      overdue_months: 2,
      is_overdue: true,
    });
  });

  test("historical bills with late_fee_enabled=false receive 0 late fee", () => {
    const legacyBill = { id: 2, amount: 25000, due_date: "2025-01-31", status: "PENDING", late_fee_enabled: false };
    const res = calculateLateFee(legacyBill, { asOfDate: "2026-08-10T10:00:00+05:30" });
    expect(res.calculatedLateFee).toBe(0);
    expect(res.totalPayable).toBe(25000);
  });

  test("PAID bills never accrue additional late fees", () => {
    const paidBill = { ...baseBill, status: "PAID" };
    const res = calculateLateFee(paidBill, {
      asOfDate: "2026-12-10T10:00:00+05:30",
      settledPayment: { amount: 26000, late_fee_amount: 1000, waived_amount: 0 },
    });
    expect(res.overdueMonths).toBe(0);
    expect(res.outstandingLateFee).toBe(1000);
    expect(res.totalPayable).toBe(26000);
  });
});
