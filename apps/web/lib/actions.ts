"use server";

import { revalidatePath } from "next/cache";
import { createAdminClient } from "./supabase";
import { Facility } from "./types";

interface CreateFacilityInput {
  name: string;
  type: string;
  latitude: number;
  longitude: number;
  capacity: number;
  operating_hours?: Record<string, string>;
  features?: Record<string, unknown>;
}

interface UpdateFacilityInput {
  name?: string;
  type?: string;
  latitude?: number;
  longitude?: number;
  capacity?: number;
  operating_hours?: Record<string, string>;
  features?: Record<string, unknown>;
}

/**
 * 시설 추가 Server Action
 */
export async function createFacility(data: CreateFacilityInput): Promise<Facility> {
  const supabase = createAdminClient();
  
  const { data: newFacility, error } = await supabase
    .from("facilities")
    .insert([
      {
        name: data.name,
        type: data.type,
        latitude: data.latitude,
        longitude: data.longitude,
        capacity: data.capacity,
        operating_hours: data.operating_hours || {},
        features: data.features || {},
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      }
    ])
    .select()
    .single();

  if (error) {
    console.error("Failed to create facility:", error);
    throw new Error(error.message);
  }

  revalidatePath("/admin/dashboard");
  return newFacility as Facility;
}

/**
 * 시설 수정 Server Action
 */
export async function updateFacility(id: string, data: UpdateFacilityInput): Promise<Facility> {
  const supabase = createAdminClient();
  
  const { data: updatedFacility, error } = await supabase
    .from("facilities")
    .update({
      ...data,
      updated_at: new Date().toISOString()
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error(`Failed to update facility ${id}:`, error);
    throw new Error(error.message);
  }

  revalidatePath("/admin/dashboard");
  return updatedFacility as Facility;
}

/**
 * 시설 삭제 Server Action
 */
export async function deleteFacility(id: string): Promise<{ success: boolean }> {
  const supabase = createAdminClient();
  
  const { error } = await supabase
    .from("facilities")
    .delete()
    .eq("id", id);

  if (error) {
    console.error(`Failed to delete facility ${id}:`, error);
    throw new Error(error.message);
  }

  revalidatePath("/admin/dashboard");
  return { success: true };
}
