import { MarketingNav } from "./_components/nav/marketing-nav";
import { LandingFooter } from "./_components/landing-footer";

export default function MarketingLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <MarketingNav />
      {children}
      <LandingFooter />
    </div>
  );
}
