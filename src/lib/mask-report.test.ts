import { describe, expect, it } from "vitest";
import { maskNamesIn } from "../lib/mask";

describe("customer names on reports", () => {
  it("masks every occurrence in text and list fields", () => {
    const v = maskNamesIn({ SENDER: "Khun Somchai (truck)", PUNCH_LIST: "Khun Somchai to confirm", RESULT: ["ok", "seen by Khun Somchai"], DOC_NO: "IVTH26110301" }, ["Khun Somchai"]);
    expect(v.SENDER).toBe("Khun S**** (truck)");
    expect(v.PUNCH_LIST).toBe("Khun S**** to confirm");
    expect(v.RESULT).toEqual(["ok", "seen by Khun S****"]);
    expect(v.DOC_NO).toBe("IVTH26110301");
  });
});
