import { AppFooter, AppHeader } from "@/components/app-header";

export default function AccountLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-1 flex-col">
      <AppHeader />
      <div className="mx-auto w-full max-w-2xl flex-1 p-6">{children}</div>
      <AppFooter />
    </div>
  );
}
