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
  title: "URDFlow · 机器人数据工作台",
  description: "浏览器里的机器人学习数据工作台:采集 · 标注 · 质检 · 管理 · 训练。零安装,链接即分享。",
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
