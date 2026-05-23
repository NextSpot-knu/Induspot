import { NextResponse } from 'next/server';

export async function GET() {
  // 백엔드 명세서에 기재된 DashboardData 구조를 그대로 Mocking
  const mockData = {
    kpi: {
      avgCongestion: { value: 0.45, changePercent: -12.5 },
      acceptRate: { value: 0.725, total: 40, accepted: 29 },
      activeUsers: 128,
      anomalyCount: 3
    },
    heatmap: [
      { facility: "제1식당", hour: 11, value: 0.3 },
      { facility: "제1식당", hour: 12, value: 0.85 },
      { facility: "제1식당", hour: 13, value: 0.5 },
      { facility: "A주차장", hour: 8, value: 0.9 },
      { facility: "A주차장", hour: 9, value: 0.6 },
      { facility: "A주차장", hour: 18, value: 0.8 },
      { facility: "휴게실", hour: 13, value: 0.7 },
      { facility: "휴게실", hour: 14, value: 0.4 },
    ],
    distribution: [
      { date: "2026-05-18", beforeCongestion: 0.85, afterCongestion: 0.80, alternativeUsage: 0.10 },
      { date: "2026-05-19", beforeCongestion: 0.84, afterCongestion: 0.75, alternativeUsage: 0.20 },
      { date: "2026-05-20", beforeCongestion: 0.88, afterCongestion: 0.70, alternativeUsage: 0.35 },
      { date: "2026-05-21", beforeCongestion: 0.82, afterCongestion: 0.65, alternativeUsage: 0.40 },
      { date: "2026-05-22", beforeCongestion: 0.86, afterCongestion: 0.61, alternativeUsage: 0.42 }
    ],
    anomalies: [
      {
        id: "uuid-1",
        facilityId: "fac-1",
        facilityName: "제1체육관",
        timestamp: "2026-05-23T12:00:00.000Z",
        congestionLevel: 0.95,
        durationMinutes: 45
      },
      {
        id: "uuid-2",
        facilityId: "fac-2",
        facilityName: "B주차장",
        timestamp: "2026-05-23T08:30:00.000Z",
        congestionLevel: 0.92,
        durationMinutes: 20
      }
    ]
  };

  // 네트워크 지연 효과 (실제 서버 통신 흉내)
  await new Promise((resolve) => setTimeout(resolve, 500));

  return NextResponse.json(mockData);
}
