import "./globals.css";

export const metadata = { title: "URDFlow" };

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      {/* suppressHydrationWarning: browser extensions (e.g. Grammarly) inject
          attributes on <body>, causing benign hydration mismatches. */}
      <body className="h-full bg-[#0a0b0d] text-zinc-200" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
