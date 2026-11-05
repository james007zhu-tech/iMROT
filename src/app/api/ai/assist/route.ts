import { NextResponse } from "next/server";
import { getLocale } from "next-intl/server";
import { assist } from "@/server/ai";
import { sessionScope } from "@/server/api-auth";

/** POST { messages:[{role,content}], path } — staff or portal contact (decided by the signed session cookie). */
export async function POST(req: Request) {
  try {
    const { messages, path, fields } = await req.json();
    const locale = await getLocale();
    const scope = await sessionScope();
    if (!scope) return NextResponse.json({ error: "not signed in" }, { status: 401 });
    return NextResponse.json(await assist(messages, scope.kind === "staff"
      ? { employeeCode: scope.employeeCode, locale, path, fields }
      : { contactId: scope.contactId, customerId: scope.customerId, locale, path, fields }));
  } catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 400 }); }
}
