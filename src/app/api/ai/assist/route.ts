import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { assist } from "@/server/ai";
import { prisma } from "@/lib/db";
import { sessionContactId, sessionEmployeeCode } from "@/server/auth";

/** POST { messages:[{role,content}], path } — staff or portal contact (decided by the signed session cookie). */
export async function POST(req: Request) {
  try {
    const { messages, path, fields } = await req.json();
    const locale = await getLocale();
    const staff = await sessionEmployeeCode();
    if (staff) return NextResponse.json(await assist(messages, { employeeCode: staff, locale, path, fields }));
    const contactId = await sessionContactId();
    if (contactId) {
      const c = await prisma.contact.findUnique({ where: { id: contactId } });
      if (c) return NextResponse.json(await assist(messages, { contactId, customerId: c.customerId, locale, path, fields }));
    }
    return NextResponse.json({ error: "not signed in" }, { status: 401 });
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
