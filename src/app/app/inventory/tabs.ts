export type InventoryTab = "overview" | "products" | "purchase-orders" | "reorder" | "movements" | "stock-counts" | "vendors" | "warehouses";

export const INVENTORY_TABS = (active: InventoryTab) => [
  { href: "/app/inventory", label: "Overview", active: active === "overview" },
  { href: "/app/inventory/products", label: "Products", active: active === "products" },
  { href: "/app/inventory/purchase-orders", label: "Purchase orders", active: active === "purchase-orders" },
  { href: "/app/inventory/reorder", label: "Reorder", active: active === "reorder" },
  { href: "/app/inventory/movements", label: "Movements", active: active === "movements" },
  { href: "/app/inventory/stock-counts", label: "Stock counts", active: active === "stock-counts" },
  { href: "/app/inventory/vendors", label: "Vendors", active: active === "vendors" },
  { href: "/app/inventory/warehouses", label: "Warehouses", active: active === "warehouses" },
];
