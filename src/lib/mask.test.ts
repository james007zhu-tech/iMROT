import { describe, expect, it } from "vitest";
import { maskEmail, maskName, maskPhone } from "./mask";

describe("contact masking", () => {
  it("keeps honorific and first letter", () => {
    expect(maskName("Khun Somchai")).toBe("Khun S****");
    expect(maskName("คุณสมชาย")).toBe("คุณส****");
    expect(maskName("Anan")).toBe("A****");
  });
  it("keeps first two and last two digits", () => {
    expect(maskPhone("081-234-5612")).toBe("08*-***-**12");
    expect(maskPhone("+66 88 660 6999")).toBe("+66 ** *** **99");
  });
  it("masks mailbox and domain", () => {
    expect(maskEmail("somchai@zcrubber.co.th")).toBe("s****@z***.co.th");
  });
});
