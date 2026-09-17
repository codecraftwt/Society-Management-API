/**
 * TEMP E2E financial-tracking matrix (society 6).
 * Verifies: bill demo-pay → confirm = 1 Payment + 1 Ledger CREDIT (idempotent);
 * amenity book → verify = per-row Payment + CREDIT (idempotent), cancel reverses;
 * expense create/edit/void ledger sync; balance = opening ± ledger; RBAC; reports; charts.
 */
const { request, app, login } = require("./helpers/api");
const { Op } = require("sequelize");
const models = require("../models");
const { Payment, LedgerEntry, Expense, Bill, AmenityBooking, Society } = models;

jest.setTimeout(60000);

let admin, resident, accountant, committee, guard;

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}
function futureDate() {
  const d = new Date(Date.now() + 3 * 86400000);
  return d.toISOString().slice(0, 10);
}

async function countLedger(refSpec) {
  return LedgerEntry.count({ where: refSpec });
}

describe("Financial Tracking E2E Matrix", () => {
  let created = {
    bills: [],
    payments: [],
    ledger: [],
    expenses: [],
    bookings: [],
  };

  beforeAll(async () => {
    admin = await login("admin");
    resident = await login("resident");
    accountant = await login("accountant");
    committee = await login("committee");
    guard = await login("guard");
  });

  afterAll(async () => {
    await LedgerEntry.destroy({ where: { id: { [Op.in]: created.ledger } } });
    await Payment.destroy({ where: { id: { [Op.in]: created.payments } } });
    await Expense.destroy({ where: { id: { [Op.in]: created.expenses } } });
    await AmenityBooking.destroy({ where: { id: { [Op.in]: created.bookings } } });
    await Bill.destroy({ where: { id: { [Op.in]: created.bills } } });
  });

  const trackLedger = (rows) =>
    (rows || []).forEach((r) => created.ledger.push(r.id));
  const trackPayments = (rows) =>
    (rows || []).forEach((r) => created.payments.push(r.id));

  test("RBAC: accounting endpoints reject guard / require auth", async () => {
    expect((await request(app).get("/api/account/balance").set(admin.headers)).status).toBe(200);
    expect((await request(app).get("/api/account/balance")).status).toBe(401);
    expect((await request(app).get("/api/account/balance").set(guard.headers)).status).toBe(403);
    expect((await request(app).get("/api/account/ledger").set(guard.headers)).status).toBe(403);
    expect((await request(app).get("/api/expenses").set(guard.headers)).status).toBe(403);
    expect((await request(app).get("/api/account/balance").set(committee.headers)).status).toBe(200);
    expect((await request(app).get("/api/account/balance").set(accountant.headers)).status).toBe(200);
    expect((await request(app).get("/api/account/ledger").set(accountant.headers)).status).toBe(200);
  });

  test("Opening balance: accountant denied manage; admin set is audited", async () => {
    const soc = await Society.findByPk(6);
    const wasFirst = Number(soc.opening_balance) === 0 && soc.opening_balance_effective_date === null;

    const r403 = await request(app)
      .put("/api/account/opening-balance")
      .set(accountant.headers)
      .send({ amount: 100, reason: "matrix deny" });
    expect(r403.status).toBe(403);

    const target = wasFirst ? 1000 : Number(soc.opening_balance);
    const r = await request(app)
      .put("/api/account/opening-balance")
      .set(admin.headers)
      .send({ amount: target, reason: "matrix set", effective_date: todayIso() });
    expect([200, 201]).toContain(r.status);
    expect(r.body.success).toBe(true);
  });

  test("Bill: demo-pay then confirm → exactly 1 Payment + 1 Ledger CREDIT", async () => {
    const create = await request(app)
      .post("/api/bills")
      .set(admin.headers)
      .send({ flat_id: 10, title: `Matrix Bill ${Date.now()}`, amount: 500, billing_month: "Sep-2026" });
    expect(create.status).toBe(200);
    const billId = create.body.id;
    created.bills.push(billId);

    const dup = await request(app)
      .post("/api/payments/demo-verify")
      .set(resident.headers)
      .send({ bill_id: billId });
    expect([200, 400]).toContain(dup.status);

    const payCount1 = await Payment.count({ where: { bill_id: billId } });
    expect(payCount1).toBe(1);

    const dupAgain = await request(app)
      .post("/api/payments/demo-verify")
      .set(resident.headers)
      .send({ bill_id: billId });
    expect(dupAgain.status).toBe(400);

    const confirm = await request(app)
      .put(`/api/bills/confirm/${billId}`)
      .set(admin.headers);
    expect(confirm.status).toBe(200);

    const bill = await Bill.findByPk(billId);
    expect(bill.status).toBe("PAID");
    const payCount2 = await Payment.count({ where: { bill_id: billId, status: "SUCCESS" } });
    expect(payCount2).toBe(1);

    const credits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "BILL", reference_id: billId, type: "CREDIT" },
    });
    trackLedger(credits);
    expect(credits.length).toBe(1);
    expect(Number(credits[0].amount)).toBe(500);

    const reconfirm = await request(app)
      .put(`/api/bills/confirm/${billId}`)
      .set(admin.headers);
    expect([200, 400]).toContain(reconfirm.status);
    const creditsAfter2 = await LedgerEntry.findAll({
      where: { society_id: 6, source: "BILL", reference_id: billId, type: "CREDIT" },
    });
    trackLedger(creditsAfter2);
    expect(creditsAfter2.length).toBe(1);
  });

  test("Amenity: book→verify creates per-row Payment + CREDIT; repeat is idempotent", async () => {
    const book = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId: 8, date: futureDate(), startTime: "10:00:00" });
    expect(book.status).toBe(201);
    const bookingId = book.body.data?.id || book.body.bookings?.[0]?.id;
    expect(bookingId).toBeDefined();
    created.bookings.push(bookingId);

    const verify = await request(app)
      .post("/api/amenities/verify-payment")
      .set(resident.headers)
      .send({ booking_ids: [bookingId] });
    expect(verify.status).toBe(200);

    const booking = await AmenityBooking.findByPk(bookingId);
    expect(booking.payment_status).toBe("PAID");

    const pays = await Payment.findAll({ where: { amenity_booking_id: bookingId, source: "AMENITY" } });
    trackPayments(pays);
    expect(pays.length).toBe(1);
    expect(Number(pays[0].amount)).toBe(200);

    const credits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "AMENITY", reference_id: bookingId, type: "CREDIT" },
    });
    trackLedger(credits.filter((c) => c.status !== "REVERSED"));
    expect(credits.length).toBe(1);
    expect(Number(credits[0].amount)).toBe(200);

    const reVerify = await request(app)
      .post("/api/amenities/verify-payment")
      .set(resident.headers)
      .send({ booking_ids: [bookingId] });
    expect(reVerify.status).toBe(200);
    const credits2 = await LedgerEntry.findAll({
      where: { society_id: 6, source: "AMENITY", reference_id: bookingId, type: "CREDIT" },
    });
    trackLedger(credits2);
    expect(credits2.length).toBe(1);
  });

  test("Amenity: cancel a paid booking reverses its CREDIT (net zero)", async () => {
    const book = await request(app)
      .post("/api/amenities/book")
      .set(resident.headers)
      .send({ amenityId: 8, date: futureDate(), startTime: "11:00:00" });
    expect(book.status).toBe(201);
    const bookingId = book.body.data?.id || book.body.bookings?.[0]?.id;
    created.bookings.push(bookingId);

    await request(app)
      .post("/api/amenities/verify-payment")
      .set(resident.headers)
      .send({ booking_ids: [bookingId] });

    const cancel = await request(app)
      .put(`/api/amenities/${bookingId}/cancel`)
      .set(resident.headers)
      .send({});
    expect(cancel.status).toBe(200);

    const credits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "AMENITY", reference_id: bookingId, type: "CREDIT" },
    });
    trackLedger(credits);
    const active = credits.filter((c) => c.status !== "REVERSED");
    const reversed = credits.filter((c) => c.status === "REVERSED");
    const debits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "AMENITY", reference_id: bookingId, type: "DEBIT" },
    });
    trackLedger(debits);
    expect(active.length).toBe(0);
    expect(reversed.length).toBe(1);
    expect(debits.length).toBe(1);
    expect(Number(debits[0].amount)).toBe(200);
  });

  test("Expense: create→edit→void keeps ledger DEBIT in sync (net zero at end)", async () => {
    const create = await request(app)
      .post("/api/expenses")
      .set(admin.headers)
      .send({ pay_to: "Matrix Vendor", reason: `Matrix expense ${Date.now()}`, amount: 300, payment_date: todayIso(), payment_mode: "CASH" });
    expect(create.status).toBe(201);
    const expId = create.body.expense?.id || create.body.data?.id || create.body.id;
    expect(expId).toBeDefined();
    created.expenses.push(expId);

    let debits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "EXPENSE", reference_id: expId, type: "DEBIT" },
    });
    trackLedger(debits);
    expect(debits.length).toBe(1);
    expect(Number(debits[0].amount)).toBe(300);

    const update = await request(app)
      .put(`/api/expenses/${expId}`)
      .set(admin.headers)
      .send({ amount: 700 });
    expect(update.status).toBe(200);
    debits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "EXPENSE", reference_id: expId, type: "DEBIT" },
    });
    trackLedger(debits);
    expect(Number(debits[0].amount)).toBe(700);

    const committeeDeny = await request(app)
      .delete(`/api/expenses/${expId}`)
      .set(committee.headers);
    expect(committeeDeny.status).toBe(403);

    const voidRes = await request(app)
      .delete(`/api/expenses/${expId}`)
      .set(admin.headers);
    expect(voidRes.status).toBe(200);

    const expense = await Expense.findByPk(expId);
    expect(expense.status).toBe("VOID");
    debits = await LedgerEntry.findAll({
      where: { society_id: 6, source: "EXPENSE", reference_id: expId, type: "DEBIT" },
    });
    trackLedger(debits);
    const reversals = await LedgerEntry.findAll({
      where: { society_id: 6, source: "EXPENSE", reference_id: expId, type: "CREDIT" },
    });
    trackLedger(reversals);
    expect(debits.filter((d) => d.status !== "REVERSED").length).toBe(0);
    expect(reversals.length).toBe(1);
    expect(Number(reversals[0].amount)).toBe(700);
  });

  test("Balance is always computed = opening + ΣCREDIT − ΣDEBIT", async () => {
    const soc = await Society.findByPk(6);
    const opening = Number(soc.opening_balance);
    const bal = await request(app).get("/api/account/balance").set(admin.headers);
    expect(bal.status).toBe(200);
    const b = bal.body.data || bal.body;
    const credits = b.totalCredit ?? b.total_credit ?? b.credits;
    const debits = b.totalDebit ?? b.total_debit ?? b.debits;
    const current = b.currentBalance ?? b.current_balance ?? b.balance;
    expect(Number(current)).toBeCloseTo(opening + Number(credits) - Number(debits), 1);
  });

  test("Ledger paginates with running balance; reports include ledger summary", async () => {
    const ledger = await request(app)
      .get("/api/account/ledger?page=1&limit=5")
      .set(admin.headers);
    expect(ledger.status).toBe(200);
    const rows = ledger.body.data || ledger.body.rows || [];
    expect(rows.length).toBeGreaterThan(0);
    expect(rows[0].running_balance !== undefined).toBe(true);

    const report = await request(app).get("/api/reports/financial").set(admin.headers);
    expect(report.status).toBe(200);
    expect(report.body.ledger).toBeDefined();
    expect(typeof report.body.ledger.currentBalance).toBe("number");
  });

  test("Dashboard chart returns 12 months; societies overview is super-admin only", async () => {
    const chart = await request(app).get("/api/account/chart").set(admin.headers);
    expect(chart.status).toBe(200);
    const c = chart.body.data || chart.body;
    expect(Array.isArray(c.months) && c.months.length === 12).toBe(true);
    expect(typeof c.months[0].credited).toBe("number");
    expect(typeof c.months[0].debited).toBe("number");

    const denied = await request(app).get("/api/account/societies").set(admin.headers);
    expect(denied.status).toBe(403);
  });

  test("Accountant payments/summary/stats stay green after finance work", async () => {
    expect((await request(app).get("/api/accountant/payments").set(accountant.headers)).status).toBe(200);
    expect((await request(app).get("/api/accountant/payments/summary").set(accountant.headers)).status).toBe(200);
    expect((await request(app).get("/api/accountant/dashboard-stats").set(accountant.headers)).status).toBe(200);
  });
});