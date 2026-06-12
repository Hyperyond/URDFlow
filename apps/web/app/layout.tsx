import "./globals.css";
import { Chakra_Petch, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";

const display = Chakra_Petch({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-display",
});
const body = Hanken_Grotesk({
  subsets: ["latin"],
  variable: "--font-body",
});
const mono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-mono-jb",
});

export const metadata = {
  title: "URDFlow · Robot Data Workbench",
  description:
    "Browser-native workbench for robot-learning data: collect, annotate, QC, manage, train. Zero install, share a link.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html
      lang="zh-CN"
      suppressHydrationWarning
      className={`${display.variable} ${body.variable} ${mono.variable}`}
    >
      {/* suppressHydrationWarning: browser extensions (Grammarly, 沉浸式翻译, …) inject
          attributes on <html>/<body>, causing benign hydration mismatches. */}
      <body className="h-full bg-[#08090c] text-zinc-200 antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
