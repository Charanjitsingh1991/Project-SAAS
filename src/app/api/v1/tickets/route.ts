import { listRoute } from "@/lib/api/resources";
import { postTicket } from "@/lib/api/writes";

export const GET = listRoute("tickets");
export const POST = postTicket;
