"use client";

import type { ReactNode } from "react";

export function Sidebar({ children }: { children: ReactNode }) {
  return (
    <aside className="flex w-80 flex-col gap-6 overflow-y-auto border-r border-white/[0.06] bg-white/[0.02] p-4">
      {children}
    </aside>
  );
}
