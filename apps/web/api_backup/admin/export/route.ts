import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase";
import { getKstDateRange } from "@/lib/queries";

/**
 * GET /api/admin/export?period=daily|weekly|monthly
 * Response: Content-Type: text/csv (파일 다운로드)
 */
export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const period = searchParams.get("period") || "daily";

    let startDate: string;
    const today = getKstDateRange(0);

    switch (period) {
      case "weekly":
        startDate = getKstDateRange(-6).start; // 최근 7일
        break;
      case "monthly":
        startDate = getKstDateRange(-29).start; // 최근 30일
        break;
      case "daily":
      default:
        startDate = today.start; // 오늘
        break;
    }

    const supabase = createAdminClient();

    // 혼잡도 데이터 조회
    const { data: logs, error } = await supabase
      .from("congestion_logs")
      .select("timestamp, current_count, congestion_level, source, facility:facilities(name, capacity)")
      .gte("timestamp", startDate)
      .lte("timestamp", today.end)
      .order("timestamp", { ascending: false });

    if (error) {
      throw error;
    }

    // CSV 생성 (Excel 한글 깨짐 방지를 위해 UTF-8 BOM 추가)
    const headers = ["시설명", "시간 (KST)", "현재인원", "혼잡도", "수용인원", "데이터출처"];
    const csvRows = [headers.join(",")];

    if (logs) {
      for (const log of logs) {
        const facilityName = log.facility
          ? (Array.isArray(log.facility) ? log.facility[0]?.name : (log.facility as any).name)
          : "알 수 없음";
        
        const capacity = log.facility
          ? (Array.isArray(log.facility) ? log.facility[0]?.capacity : (log.facility as any).capacity)
          : 0;

        // KST 시간 포맷 변경 (YYYY-MM-DD HH:mm:ss)
        const logDate = new Date(log.timestamp);
        const kstDate = new Date(logDate.getTime() + (9 * 60 * 60 * 1000));
        const kstTimeStr = kstDate.toISOString().replace("T", " ").substring(0, 19);

        const row = [
          `"${facilityName.replace(/"/g, '""')}"`,
          `"${kstTimeStr}"`,
          log.current_count,
          log.congestion_level,
          capacity,
          `"${log.source.replace(/"/g, '""')}"`
        ];
        csvRows.join(",");
        csvRows.push(row.join(","));
      }
    }

    // UTF-8 BOM (\uFEFF)
    const csvContent = "\uFEFF" + csvRows.join("\n");
    const filename = `congestion_${period}_${new Date().toISOString().split("T")[0]}.csv`;

    return new Response(csvContent, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`
      }
    });

  } catch (err: any) {
    console.error("Export CSV Error:", err);
    return NextResponse.json(
      {
        success: false,
        message: "CSV 파일을 생성하는 도중 오류가 발생했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}
