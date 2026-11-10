import { listRoute } from "@/lib/api/resources";
import { postCompany } from "@/lib/api/writes";

export const GET = listRoute("companies");
export const POST = postCompany;
