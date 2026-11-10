import { listRoute } from "@/lib/api/resources";
import { postDeal } from "@/lib/api/writes";

export const GET = listRoute("deals");
export const POST = postDeal;
