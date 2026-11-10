import { listRoute } from "@/lib/api/resources";
import { postInvoice } from "@/lib/api/writes";

export const GET = listRoute("invoices");
export const POST = postInvoice;
