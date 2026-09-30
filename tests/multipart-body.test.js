const { normaliseMultipartBody, parseMultipartJsonField } = require("../utils/profilePicture");

describe("multipart body normalisation", () => {
  it("parses a stringified flat_assignments array back into an array", () => {
    const body = {
      name: "Asha",
      flat_assignments: '[{"flat_id":1,"resident_type":"OWNER","flat_type":null}]',
    };
    const out = normaliseMultipartBody(body);
    expect(Array.isArray(out.flat_assignments)).toBe(true);
    expect(out.flat_assignments[0].flat_id).toBe(1);
    expect(out.flat_assignments.some((a) => a.flat_id)).toBe(true);
  });

  it("parses a stringified emergency_contact object", () => {
    const out = normaliseMultipartBody({ emergency_contact: '{"name":"Ram","phone":"9876543210"}' });
    expect(typeof out.emergency_contact).toBe("object");
    expect(out.emergency_contact.name).toBe("Ram");
  });

  it("leaves a real array untouched (JSON path unchanged)", () => {
    const arr = [{ flat_id: 5 }];
    const out = normaliseMultipartBody({ flat_assignments: arr });
    expect(out.flat_assignments).toBe(arr);
  });

  it("leaves plain scalars untouched", () => {
    const out = normaliseMultipartBody({ name: "Ravi", phone: "9876543210", password: "Admin@123" });
    expect(out.name).toBe("Ravi");
    expect(out.phone).toBe("9876543210");
  });

  it("leaves a numeric string as a string (no coercion)", () => {
    const out = normaliseMultipartBody({ occupant_count: "3" });
    expect(out.occupant_count).toBe("3");
  });

  it("does not throw on malformed JSON", () => {
    expect(parseMultipartJsonField("{oops")).toBe("{oops");
  });

  it("handles null and undefined safely", () => {
    expect(normaliseMultipartBody(null)).toBe(null);
    expect(normaliseMultipartBody(undefined)).toBe(undefined);
  });
});
