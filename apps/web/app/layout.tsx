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
      <body style={{ margin: 0 }} suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
