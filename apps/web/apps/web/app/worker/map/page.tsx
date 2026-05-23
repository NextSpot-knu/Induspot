import React from "react";
import { getSupabaseServerClient } from "@/lib/supabase";
import CongestionMap from "@/components/map/CongestionMap";

export const revalidate = 0;

export interface FacilityWithCongestion {
  id: string;
  name: string;
  type: "cafeteria" | "parking" | "meeting_room" | "loading_dock";
  latitude: number;
  longitude: number;
  capacity: number;
  operatingHours: Record<string, any>;
  features: Record<string, any>;
  congestionLevel: number;
  currentCount: number;
  lastUpdated: string;
}

const MOCK_SEED_FACILITIES = [
  {
    id: "f1000000-0000-0000-0000-000000000001",
    name: "푸드스퀘어 한식관",
    type: "cafeteria",
    latitude: 37.3185,
    longitude: 126.8115,
    capacity: 150,
    operating_hours: { weekday: "11:00-20:00", weekend: "11:00-14:00" },
    features: { has_vegetarian: true, average_price: 7500, average_processing_time: 20 },
    congestion_logs: [{ congestion_level: 0.85, current_count: 127, timestamp: new Date().toISOString() }]
  },
  {
    id: "f1000000-0000-0000-0000-000000000002",
    name: "Indu 뷔페 식당",
    type: "cafeteria",
    latitude: 37.3202,
    longitude: 126.8141,
    capacity: 200,
    operating_hours: { weekday: "11:30-19:00", weekend: "closed" },
    features: { buffet_style: true, average_price: 8000, average_processing_time: 20 },
    congestion_logs: [{ congestion_level: 0.45, current_count: 90, timestamp: new Date().toISOString() }]
  },
  {
    id: "f1000000-0000-0000-0000-000000000003",
    name: "단지내 중식당 화성",
    type: "cafeteria",
    latitude: 37.3215,
    longitude: 126.8098,
    capacity: 80,
    operating_hours: { weekday: "11:00-21:00", weekend: "11:00-15:00" },
    features: { has_delivery: true, average_price: 9000, average_processing_time: 20 },
    congestion_logs: [{ congestion_level: 0.20, current_count: 16, timestamp: new Date().toISOString() }]
  },
  {
    id: "f1000000-0000-0000-0000-000000000004",
    name: "밀스밀 간편식 코너",
    type: "cafeteria",
    latitude: 37.3171,
    longitude: 126.8152,
    capacity: 50,
    operating_hours: { weekday: "08:00-22:00", weekend: "09:00-18:00" },
    features: { sandwich_bar: true, average_price: 5500, average_processing_time: 15 },
    congestion_logs: [{ congestion_level: 0.15, current_count: 7, timestamp: new Date().toISOString() }]
  },
  {
    id: "f1000000-0000-0000-0000-000000000005",
    name: "산단 남부 한식뷔페",
    type: "cafeteria",
    latitude: 37.3230,
    longitude: 126.8120,
    capacity: 180,
    operating_hours: { weekday: "11:00-18:30", weekend: "closed" },
    features: { buffet_style: true, average_price: 7000, average_processing_time: 20 },
    congestion_logs: [{ congestion_level: 0.75, current_count: 135, timestamp: new Date().toISOString() }]
  },
  {
    id: "f2000000-0000-0000-0000-000000000001",
    name: "중앙 주차타워 A동",
    type: "parking",
    latitude: 37.3195,
    longitude: 126.8130,
    capacity: 400,
    operating_hours: { "24_7": true },
    features: { has_ev_charger: true, indoor: true, average_processing_time: 5 },
    congestion_logs: [{ congestion_level: 0.90, current_count: 360, timestamp: new Date().toISOString() }]
  },
  {
    id: "f2000000-0000-0000-0000-000000000002",
    name: "지상 남부 주차장",
    type: "parking",
    latitude: 37.3242,
    longitude: 126.8105,
    capacity: 250,
    operating_hours: { "24_7": true },
    features: { has_ev_charger: false, indoor: false, average_processing_time: 5 },
    congestion_logs: [{ congestion_level: 0.35, current_count: 87, timestamp: new Date().toISOString() }]
  },
  {
    id: "f2000000-0000-0000-0000-000000000003",
    name: "서부 복합주차장 B",
    type: "parking",
    latitude: 37.3160,
    longitude: 126.8085,
    capacity: 300,
    operating_hours: { "24_7": true },
    features: { has_ev_charger: true, indoor: true, average_processing_time: 5 },
    congestion_logs: [{ congestion_level: 0.10, current_count: 30, timestamp: new Date().toISOString() }]
  },
  {
    id: "f3000000-0000-0000-0000-000000000001",
    name: "본관 1층 컨퍼런스룸 101",
    type: "meeting_room",
    latitude: 37.3190,
    longitude: 126.8125,
    capacity: 30,
    operating_hours: { weekday: "09:00-18:00", weekend: "closed" },
    features: { has_beam_projector: true, has_video_conf: true, average_processing_time: 10 },
    congestion_logs: [{ congestion_level: 0.50, current_count: 15, timestamp: new Date().toISOString() }]
  },
  {
    id: "f3000000-0000-0000-0000-000000000002",
    name: "혁신센터 스마트회의실 B",
    type: "meeting_room",
    latitude: 37.3208,
    longitude: 126.8155,
    capacity: 12,
    operating_hours: { weekday: "08:00-20:00", weekend: "09:00-18:00" },
    features: { has_beam_projector: true, whiteboard: true, average_processing_time: 10 },
    congestion_logs: [{ congestion_level: 0.80, current_count: 10, timestamp: new Date().toISOString() }]
  },
  {
    id: "f4000000-0000-0000-0000-000000000001",
    name: "북부 종합 물류하역장 D-1",
    type: "loading_dock",
    latitude: 37.3250,
    longitude: 126.8145,
    capacity: 10,
    operating_hours: { "24_7": true },
    features: { max_tonnage: 15, has_forklift: true, average_processing_time: 30 },
    congestion_logs: [{ congestion_level: 0.95, current_count: 9, timestamp: new Date().toISOString() }]
  },
  {
    id: "f4000000-0000-0000-0000-000000000002",
    name: "남부 컨테이너 하역장 E-2",
    type: "loading_dock",
    latitude: 37.3150,
    longitude: 126.8110,
    capacity: 6,
    operating_hours: { "24_7": true },
    features: { max_tonnage: 25, has_forklift: true, average_processing_time: 30 },
    congestion_logs: [{ congestion_level: 0.15, current_count: 1, timestamp: new Date().toISOString() }]
  }
];

export default async function WorkerMapPage() {
  const supabase = getSupabaseServerClient();
  let facilitiesData: any[] = [];

  try {
    const { data: facilities, error } = await supabase
      .from("facilities")
      .select(`
        id,
        name,
        type,
        latitude,
        longitude,
        capacity,
        operating_hours,
        features,
        congestion_logs (
          congestion_level,
          current_count,
          timestamp
        )
      `)
      .order("timestamp", { foreignTable: "congestion_logs", ascending: false })
      .limit(1, { foreignTable: "congestion_logs" });

    if (error) {
      console.warn("Supabase query returned error, using fallback seed facilities:", error);
      facilitiesData = MOCK_SEED_FACILITIES;
    } else {
      facilitiesData = facilities && facilities.length > 0 ? facilities : MOCK_SEED_FACILITIES;
    }
  } catch (err) {
    console.warn("Failed to connect to Supabase, falling back to mock seed facilities:", err);
    facilitiesData = MOCK_SEED_FACILITIES;
  }

  const initialFacilities: FacilityWithCongestion[] = facilitiesData.map((f: any) => {
    const latestLog = f.congestion_logs && f.congestion_logs[0];
    return {
      id: f.id,
      name: f.name,
      type: f.type,
      latitude: f.latitude,
      longitude: f.longitude,
      capacity: f.capacity,
      operatingHours: f.operating_hours || {},
      features: f.features || {},
      congestionLevel: latestLog ? latestLog.congestion_level : 0.0,
      currentCount: latestLog ? latestLog.current_count : 0,
      lastUpdated: latestLog ? latestLog.timestamp : new Date().toISOString(),
    };
  });

  return (
    <div className="min-h-screen bg-[#0a0f1e] text-white">
      <CongestionMap initialFacilities={initialFacilities} />
    </div>
  );
}
