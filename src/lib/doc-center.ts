/**
 * 单据中心 (朱总 2026-11-10: "之前设计的表单都应该在很直观的地方找得到") — where each numbered document lives:
 * its list is /documents?type=XX, a row opens the document on its order, and "+ new" leads to the form:
 * either a page of its own, or the step of an order that is ready for it.
 */
export interface DocPlace {
  /** messages nav.<key> — the document's name in the menu */
  nav: string;
  /** where a document of this type opens; `order` = its QTTH, `no` = its own number */
  open: (no: string, order?: string | null) => string;
  /** a form that needs no order */
  newHref?: string;
  /** or: the step on an order, offered for orders in these statuses */
  step?: { path: string; statuses: string[]; modes?: string[] };
}

const onOrder = (tail = "") => (no: string, order?: string | null) => (order ? `/service-orders/${order}${tail}` : `/search?q=${no}`);

export const DOC_PLACES: Record<string, DocPlace> = {
  QT: { nav: "opportunities", open: (no) => `/service-orders/${no}`, newHref: "/service-orders/new" },
  ER: { nav: "receiving", open: (no, order) => (order ? `/service-orders/${order}` : `/search?q=${no}`), newHref: "/receiving/new", step: { path: "receive", statuses: ["RECEIVED", "ASSIGNED", "DIAGNOSING", "QUOTE_PENDING", "IN_PROGRESS"], modes: ["REPAIR", "PARTNER_REPAIR", "MAINTENANCE"] } },
  IN: { nav: "inspectionReports", open: onOrder(), newHref: "/inspections/new", step: { path: "inspect", statuses: ["RECEIVED", "ASSIGNED", "DIAGNOSING"], modes: ["REPAIR", "PARTNER_REPAIR", "MAINTENANCE"] } },
  RP: { nav: "repairReports", open: onOrder(), step: { path: "repair", statuses: ["IN_PROGRESS"], modes: ["REPAIR"] } },
  PM: { nav: "maintenanceReports", open: onOrder(), step: { path: "maintain", statuses: ["IN_PROGRESS"], modes: ["MAINTENANCE"] } },
  DN: { nav: "deliveryNotes", open: (no, order) => (order ? `/service-orders/${order}/deliver/${no}` : `/search?q=${no}`), step: { path: "deliver", statuses: ["IN_PROGRESS", "ACCEPTANCE_PENDING", "ACCEPTED", "DECLINED"] } },
  PR: { nav: "inquiries", open: (no) => `/purchasing/inquiries/${no}`, newHref: "/purchasing/inquiries/new" },
  PO: { nav: "purchaseOrders", open: (no) => `/purchasing/orders/${no}`, newHref: "/purchasing/orders/new" },
  IB: { nav: "stockIn", open: (no) => `/parts?movement=${no}`, newHref: "/parts/movement?direction=IN" },
  OB: { nav: "stockOut", open: (no) => `/parts?movement=${no}`, newHref: "/parts/movement?direction=OUT" },
  PF: { nav: "proforma", open: onOrder("/ship"), step: { path: "ship", statuses: ["IN_PROGRESS"], modes: ["INTERNATIONAL_TRADE"] } },
  IV: { nav: "billing", open: onOrder("/invoice"), step: { path: "invoice", statuses: ["ACCEPTED", "DECLINED"] } },
  TI: { nav: "taxInvoices", open: onOrder("/invoice"), step: { path: "invoice", statuses: ["ACCEPTED", "DECLINED"] } },
  RC: { nav: "receipts", open: onOrder("/payment"), step: { path: "payment", statuses: ["INVOICED"] } },
  PV: { nav: "paymentVouchers", open: () => "/finance/payables", newHref: "/finance/payables" },
  BL: { nav: "statements", open: (no) => `/statements/${no}` },
};

export const DOC_TYPES = Object.keys(DOC_PLACES);
