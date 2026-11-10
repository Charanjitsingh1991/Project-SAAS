import type { Metadata } from "next";
import { Bricolage_Grotesque, Geist, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geist = Geist({ variable: "--font-geist", subsets: ["latin"] });
const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"] });
const instrument = Instrument_Serif({
  variable: "--font-instrument",
  subsets: ["latin"],
  weight: "400",
  style: ["normal", "italic"],
});
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL("https://saasmodels.tech"),
  title: {
    default: "saasmodels.tech — HR, CRM, Finance & Operations in one platform",
    template: "%s · saasmodels.tech",
  },
  description:
    "saasmodels.tech brings HRM, CRM, accounting, inventory, payroll and projects into one connected workspace. Replace a dozen tools with one.",
  openGraph: { title: "saasmodels.tech", description: "Run the whole company from one tab.", url: "https://saasmodels.tech" },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${bricolage.variable} ${instrument.variable} ${jetbrains.variable} antialiased`}
    >
      <body className="grain min-h-dvh bg-paper text-ink">
        <div className="overflow-x-clip">{children}</div>
      </body>
    </html>
  );
}
