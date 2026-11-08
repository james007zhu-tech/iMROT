import { describe, expect, it } from "vitest";
import { isClosedStatus, isThaiTaxId, parseDbd, parseDbdResponse } from "./dbd";

describe("DBD lookup parsing", () => {
  it("validates Thai tax ID checksum", () => {
    expect(isThaiTaxId("0205568072149")).toBe(true); // DCiT's own
    expect(isThaiTaxId("0205568072148")).toBe(false);
  });
  it("finds fields at any depth", () => {
    const r = parseDbd({ data: [{ "cd:OrganizationJuristicPerson": { "cd:OrganizationJuristicNameTH": "บริษัท ทดสอบ จำกัด", "cd:OrganizationJuristicNameEN": "TEST CO., LTD.", "cd:OrganizationJuristicRegisterCapital": "5,000,000", "cd:OrganizationJuristicRegisterDate": "20130618", "cd:OrganizationJuristicStatus": "ยังดำเนินกิจการอยู่", "cd:OrganizationJuristicAddress": { "cr:AddressType": { "cd:Address": "99/9", "cd:Road": "ถนนสุขุมวิท", "cd:City": { "cr:CitySubDivisionName": "มาบตาพุด" } } } } }] });
    expect(r.nameTh).toBe("บริษัท ทดสอบ จำกัด");
    expect(r.nameEn).toBe("TEST CO., LTD.");
    expect(r.registeredCapital).toBe(5000000);
    expect(r.addressTh).toContain("ถนนสุขุมวิท");
    expect(isClosedStatus(r.status)).toBe(false);
    expect(isClosedStatus("เลิกกิจการ")).toBe(true);
  });
  it("reads the DBD answer shape and treats 1004 as not found", () => {
    const ok = parseDbdResponse({ status: { code: "1000", description: "Success" }, data: [{ "cd:OrganizationJuristicPerson": {
      "cd:OrganizationJuristicID": "0105536000000", "cd:OrganizationJuristicNameTH": "บริษัท ทดสอบ จำกัด", "cd:OrganizationJuristicNameEN": "TEST CO., LTD.",
      "cd:OrganizationJuristicStatus": "ยังดำเนินกิจการอยู่", "cd:OrganizationJuristicRegisterDate": "19930115", "cd:OrganizationJuristicRegisterCapital": 5000000,
      "cd:OrganizationJuristicAddress": { "cr:AddressType": { "cd:AddressNo": "99/9", "cd:Moo": "4", "cd:Road": "สุขุมวิท", "cd:CitySubDivision": { "cr:CitySubDivisionTextTH": "มาบตาพุด" }, "cd:City": { "cr:CityTextTH": "เมืองระยอง" }, "cd:CountrySubDivision": { "cr:CountrySubDivisionTextTH": "ระยอง" } } } } }] });
    expect(ok?.nameTh).toBe("บริษัท ทดสอบ จำกัด");
    expect(ok?.foundedAt).toBe("1993-01-15");
    expect(ok?.addressTh).toBe("99/9 หมู่ 4 ถนนสุขุมวิท มาบตาพุด เมืองระยอง ระยอง");
    expect(isClosedStatus(ok?.status)).toBe(false);
    expect(parseDbdResponse({ status: { code: "1004", description: "No data available" }, data: [] })).toBeNull();
  });
});
