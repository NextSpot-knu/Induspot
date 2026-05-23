import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./global.css";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
  title: "InduSpot - 스마트 공단 인프라 수요 분산 AI 플랫폼",
  description: "실시간 혼잡도 분석 및 TTTV(Total Time to Value) 기반 최적의 대안 매칭 솔루션",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body id="induspot-root" className={inter.className}>
        {children}
      </body>
    </html>
  );
}
