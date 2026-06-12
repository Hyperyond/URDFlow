import { StudioSidebar } from "../../components/StudioSidebar";

export default function StudioLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-screen overflow-hidden">
      <StudioSidebar />
      <main className="relative z-10 flex-1 overflow-y-auto">{children}</main>
    </div>
  );
}
