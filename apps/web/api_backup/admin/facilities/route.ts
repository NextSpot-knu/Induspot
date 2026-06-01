import { NextResponse } from "next/server";
import { fetchFacilities } from "@/lib/queries";
import { createFacility } from "@/lib/actions";

/**
 * GET /api/admin/facilities
 * Response: { data: Facility[] }
 */
export async function GET() {
  try {
    const facilities = await fetchFacilities();
    return NextResponse.json({ data: facilities });
  } catch (err: any) {
    console.error("Facilities GET Error:", err);
    return NextResponse.json(
      {
        success: false,
        message: "시설 목록을 불러오지 못했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}

/**
 * POST /api/admin/facilities
 * Body: { name, type, latitude, longitude, capacity, operating_hours, features }
 * Response: { data: Facility }
 */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const newFacility = await createFacility(body);
    return NextResponse.json({ data: newFacility });
  } catch (err: any) {
    console.error("Facilities POST Error:", err);
    return NextResponse.json(
      {
        success: false,
        message: "시설을 추가하지 못했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}
