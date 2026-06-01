import { NextResponse } from "next/server";
import {
  fetchKPI,
  fetchHeatmapData,
  fetchDistributionEffect,
  fetchAnomalyAlerts
} from "@/lib/queries";

export const dynamic = "force-static";

/**
 * GET /api/admin/dashboard
 * Response: { kpi, heatmap, distribution, anomalies }
 */
export async function GET() {
  try {
    // 성능 최적화를 위해 병렬 호출 처리
    const [kpi, heatmap, distribution, anomalies] = await Promise.all([
      fetchKPI(),
      fetchHeatmapData(),
      fetchDistributionEffect(),
      fetchAnomalyAlerts()
    ]);

    return NextResponse.json({
      kpi,
      heatmap,
      distribution,
      anomalies
    });
  } catch (err: any) {
    console.error("Dashboard API Error:", err);
    return NextResponse.json(
      {
        success: false,
        message: "대시보드 데이터를 조회하는 도중 오류가 발생했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}
