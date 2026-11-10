import { Nav } from "@/components/nav";
import { SmoothScroll } from "@/components/smooth-scroll";
import { Contact } from "@/components/sections/contact";
import { Converge } from "@/components/sections/converge";
import { Faq } from "@/components/sections/faq";
import { Footer } from "@/components/sections/footer";
import { Hero } from "@/components/sections/hero";
import { Platform } from "@/components/sections/platform";
import { Pricing } from "@/components/sections/pricing";
import { Stats } from "@/components/sections/stats";
import { Suite } from "@/components/sections/suite";
import { Testimonials } from "@/components/sections/testimonials";
import { Ticker } from "@/components/sections/ticker";

export default function Home() {
  return (
    <SmoothScroll>
      <Nav />
      <main>
        <Hero />
        <Ticker />
        <Converge />
        <Suite />
        <Platform />
        <Stats />
        <Testimonials />
        <Pricing />
        <Faq />
        <Contact />
      </main>
      <Footer />
    </SmoothScroll>
  );
}
