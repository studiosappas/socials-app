import { SettingsNav } from "./settings-nav";

export default async function SettingsLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  return (
    <div className="flex flex-col gap-8 lg:flex-row lg:gap-16">
      <SettingsNav projectId={projectId} />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
