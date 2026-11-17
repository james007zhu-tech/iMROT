import { redirect } from "next/navigation";
/** /statements — the list of 对账单 lives in the document centre (finance and the MD; others are refused by the gate). */
export default function Statements() { redirect("/documents?type=BL"); }
