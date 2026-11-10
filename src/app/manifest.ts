import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "saasmodels.tech",
    short_name: "saasmodels",
    description: "HR, payroll, CRM, finance and operations in one workspace.",
    start_url: "/app/me",
    scope: "/",
    display: "standalone",
    background_color: "#f4f1ea",
    theme_color: "#141412",
    icons: [{ src: "/icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
