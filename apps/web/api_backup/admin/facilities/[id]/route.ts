import { NextResponse } from "next/server";
import { updateFacility, deleteFacility } from "@/lib/actions";

/**
 * PUT /api/admin/facilities/[id]
 * Body: { name?, type?, capacity?, operating_hours?, features? }
 * Response: { data: Facility }
 */
export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const body = await request.json();
    const updatedFacility = await updateFacility(id, body);
    return NextResponse.json({ data: updatedFacility });
  } catch (err: any) {
    console.error(`Facility PUT Error [id=${(await params).id}]:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "시설 정보를 수정하지 못했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/admin/facilities/[id]
 * Response: { success: true }
 */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const result = await deleteFacility(id);
    return NextResponse.json(result);
  } catch (err: any) {
    console.error(`Facility DELETE Error [id=${(await params).id}]:`, err);
    return NextResponse.json(
      {
        success: false,
        message: "시설을 삭제하지 못했습니다.",
        error: err.message
      },
      { status: 500 }
    );
  }
}
