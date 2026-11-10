import { buildOpenApi } from "@/lib/api/openapi";

export function GET(req: Request) {
  return Response.json(buildOpenApi(new URL("/api/v1", req.url).toString()), {
    headers: { "cache-control": "public, max-age=300", "access-control-allow-origin": "*" },
  });
}
