const { GuardAttendance, GuardShift, User } = require("../models");
const { runGuardAttendanceAutomation } = require("../jobs/guardAttendanceAutomation");

describe("Guard attendance automation auto punch-out", () => {
  let createdAttendanceId = null;

  afterEach(async () => {
    if (createdAttendanceId) {
      await GuardAttendance.destroy({ where: { id: createdAttendanceId } });
      createdAttendanceId = null;
    }
  });

  it("stores scheduled_end_at as punch_out time when auto punch-out triggers", async () => {
    const guard = await User.findOne({ where: { role: "GUARD" } });
    if (!guard) {
      console.warn("Skipping test: No guard user found");
      return;
    }

    const shift = await GuardShift.findOne({ where: { guard_id: guard.id } });
    if (!shift) {
      console.warn("Skipping test: No shift found for guard");
      return;
    }

    // Shift ended 15 minutes ago, punch in was 8 hours before shift end
    const scheduledEnd = new Date(Date.now() - 15 * 60 * 1000);
    const punchIn = new Date(scheduledEnd.getTime() - 8 * 60 * 60 * 1000);
    const shiftEndNotifiedAt = new Date(Date.now() - 15 * 60 * 1000);
    const autoPunchOutDueAt = new Date(Date.now() - 5 * 60 * 1000); // 5 mins in the past -> due for auto punch-out

    const attendance = await GuardAttendance.create({
      guard_id: guard.id,
      shift_id: shift.id,
      society_id: guard.society_id,
      attendance_date: "2026-10-28",
      punch_in: punchIn,
      scheduled_start_at: punchIn,
      scheduled_end_at: scheduledEnd,
      shift_end_notified_at: shiftEndNotifiedAt,
      auto_punch_out_due_at: autoPunchOutDueAt,
      status: "PUNCHED_IN",
      is_manual: false,
      punch_in_latitude: 19.076,
      punch_in_longitude: 72.8777,
      punch_in_distance: 5,
    });
    createdAttendanceId = attendance.id;

    // Run the automation tick
    await runGuardAttendanceAutomation();

    // Fetch the updated attendance record
    const updated = await GuardAttendance.findByPk(attendance.id);

    expect(updated.status).toBe("PUNCHED_OUT");
    expect(Boolean(updated.is_auto_punch_out)).toBe(true);
    expect(updated.punch_out_source).toBe("SYSTEM");

    // punch_out should equal scheduled_end_at (e.g. 4:00 PM), not trigger time (4:10 PM)
    expect(Math.floor(new Date(updated.punch_out).getTime() / 1000)).toBe(
      Math.floor(scheduledEnd.getTime() / 1000)
    );

    // worked_minutes should be calculated up to scheduled_end_at (8 hours = 480 mins)
    const expectedMinutes = Math.round((scheduledEnd.getTime() - punchIn.getTime()) / 60000);
    expect(updated.worked_minutes).toBe(expectedMinutes);

    // auto_punch_out_at should record the actual trigger time (~now)
    expect(updated.auto_punch_out_at).toBeDefined();
    expect(new Date(updated.auto_punch_out_at).getTime()).toBeGreaterThan(scheduledEnd.getTime());
  });
});
