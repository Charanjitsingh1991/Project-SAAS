import { listRoute } from "@/lib/api/resources";
import { postContact } from "@/lib/api/writes";

export const GET = listRoute("contacts");
export const POST = postContact;
