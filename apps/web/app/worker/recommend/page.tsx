"use client";

import React, { useState, useEffect, useRef, Suspense } from "react";
import { useSearchParams, useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getRecommendations, submitFeedback, RecommendationResponse } from "@/lib/api-client";

// Extend global Window
declare global {
  interface Window {
    kakao: any;
  }
}

// MiniMap Component for Kakao Maps inside alternative cards
interface MiniMapProps {
  latitude: number;
  longitude: number;
  mapLoaded: boolean;
}

const MiniMap = React.memo(({ latitude, longitude, mapLoaded }: MiniMapProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const [isSimulation, setIsSimulation] = useState(false);

  useEffect(() => {
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAPS_APP_KEY;
    const isMock = !appKey || appKey.includes("mock") || appKey.includes("your-");

    if (isMock) {
      setIsSimulation(true);
      return;
    }

    if (!mapLoaded || !containerRef.current || !window.kakao) return;

    const kakao = window.kakao;
    const center = new kakao.maps.LatLng(latitude, longitude);

    const mapOptions = {
      center,
      level: 3,
      draggable: false,
      zoomable: false,
    };

    const map = new kakao.maps.Map(containerRef.current, mapOptions);
    mapRef.current = map;

    new kakao.maps.Marker({
      position: center,
      map: map,
    });
  }, [mapLoaded, latitude, longitude]);

  if (isSimulation) {
    return (
      <div className="w-full h-24 md:h-28 rounded-xl overflow-hidden border border-white/10 bg-[#070b19] flex flex-col items-center justify-center p-3 relative select-none">
        <div className="absolute inset-0 bg-[linear-gradient(to_right,#ffffff02_1px,transparent_1px),linear-gradient(to_bottom,#ffffff02_1px,transparent_1px)] bg-[size:16px_16px]" />
        
        {/* Radar concentric circles */}
        <div className="absolute w-24 h-24 rounded-full border border-sky-500/10 flex items-center justify-center">
          <div className="w-16 h-16 rounded-full border border-sky-500/10 flex items-center justify-center">
            <div className="w-8 h-8 rounded-full border border-sky-500/10" />
          </div>
        </div>

        {/* Scan line effect */}
        <div className="absolute w-12 h-0.5 bg-gradient-to-r from-sky-500/30 to-transparent origin-left rotate-45 top-1/2 left-1/2 animate-[spin_4s_linear_infinite]" />

        {/* Marker Dot */}
        <div className="absolute top-[40%] left-[60%] flex items-center justify-center">
          <span className="absolute inline-flex h-4 w-4 rounded-full bg-emerald-500/30 animate-ping" />
          <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400 border border-white" />
        </div>

        <div className="relative z-10 text-[9px] text-slate-500 font-mono text-center">
          <div>LOC: {latitude.toFixed(4)}N / {longitude.toFixed(4)}E</div>
          <div className="text-[8px] text-emerald-400 font-bold uppercase tracking-wide mt-1">Twin Node Active</div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="w-full h-24 md:h-28 rounded-xl overflow-hidden border border-white/10"
    />
  );
});
MiniMap.displayName = "MiniMap";

// Original Facility Interface
interface OriginalFacility {
  id: string;
  name: string;
  type: string;
  congestionLevel: number;
  features: Record<string, any>;
}

// Custom Toast Notification Component
interface ToastProps {
  message: string;
  onClose: () => void;
}

function Toast({ message, onClose }: ToastProps) {
  useEffect(() => {
    const timer = setTimeout(onClose, 3000);
    return () => clearTimeout(timer);
  }, [onClose]);

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 bg-slate-900/90 text-slate-100 border border-white/10 backdrop-blur-md px-5 py-3 rounded-2xl shadow-2xl flex items-center gap-2 text-xs font-bold animate-in fade-in slide-in-from-bottom-4 duration-300">
      <span>{message}</span>
    </div>
  );
}

// The core content wrapper component that handles Search Params
function RecommendContent() {
  const searchParams = useSearchParams();
  const router = useRouter();

  // Query Params
  const facilityId = searchParams.get("facilityId") || "";
  const paramLat = searchParams.get("lat");
  const paramLng = searchParams.get("lng");

  // State
  const [userId, setUserId] = useState<string | null>(null);
  const [originalFacility, setOriginalFacility] = useState<OriginalFacility | null>(null);
  const [originalWaitTime, setOriginalWaitTime] = useState<string>("--");
  const [recommendations, setRecommendations] = useState<RecommendationResponse[]>([]);
  
  const [loadingOriginal, setLoadingOriginal] = useState(true);
  const [loadingRecommendations, setLoadingRecommendations] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [mapLoaded, setMapLoaded] = useState(false);

  // Onboarding Modal State (Cold Start)
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [selectedOnboardingCats, setSelectedOnboardingCats] = useState<string[]>([]);
  const [isOnboardingSubmitting, setIsOnboardingSubmitting] = useState(false);

  // Toast message state
  const [toast, setToast] = useState<string | null>(null);

  // Coordinates used for recommendations
  const [lat, setLat] = useState<number>(36.1198);
  const [lng, setLng] = useState<number>(128.3471);

  // Load User ID and Kakao Maps SDK
  useEffect(() => {
    // 1. Fetch User Session
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        setUserId(session.user.id);
      } else {
        console.warn("No active session found, falling back to mock user IT-WORKER-01.");
        setUserId("a2222222-2222-2222-2222-222222222222"); // Fallback mock worker ID from seeds
      }
    });

    // 2. Load Kakao Maps Script
    const appKey = process.env.NEXT_PUBLIC_KAKAO_MAPS_APP_KEY;
    if (appKey) {
      const scriptId = "kakao-maps-sdk-recommend";
      let script = document.getElementById(scriptId) as HTMLScriptElement;

      if (!script) {
        script = document.createElement("script");
        script.id = scriptId;
        script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`;
        script.async = true;
        script.onload = () => {
          if (window.kakao && window.kakao.maps) {
            window.kakao.maps.load(() => setMapLoaded(true));
          }
        };
        document.head.appendChild(script);
      } else if (window.kakao && window.kakao.maps) {
        window.kakao.maps.load(() => setMapLoaded(true));
      }
    }
  }, []);

  // Fetch coordinates from params or fall back to browser Geolocation
  useEffect(() => {
    if (paramLat && paramLng) {
      setLat(parseFloat(paramLat));
      setLng(parseFloat(paramLng));
    } else if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          setLat(pos.coords.latitude);
          setLng(pos.coords.longitude);
        },
        (err) => {
          console.warn("Geolocation fallback failed, using default Gumi center.", err);
        }
      );
    }
  }, [paramLat, paramLng]);

  // Fallback Mock Seed Data for Resilient Local Demos (Gumi Complex)
  const MOCK_SEED_FACILITIES = [
    {
      id: "64e1e4ba-6502-4c0c-bb91-f3527222861f",
      name: "구미산단 한솥도시락 본점",
      type: "cafeteria",
      latitude: 36.1198,
      longitude: 128.3471,
      capacity: 80,
      operating_hours: { weekday: "11:00-20:00", weekend: "11:00-14:00" },
      features: { has_vegetarian: false, average_price: 7500, average_processing_time: 20 },
      congestion_logs: [{ congestion_level: 0.13, current_count: 10, timestamp: new Date().toISOString() }]
    },
    {
      id: "16f9231c-d910-41b4-a8f7-862fb05d247d",
      name: "공단 김밥천국",
      type: "cafeteria",
      latitude: 36.1185,
      longitude: 128.3489,
      capacity: 60,
      operating_hours: { weekday: "11:00-20:00", weekend: "11:00-14:00" },
      features: { has_vegetarian: false, average_price: 7500, average_processing_time: 20 },
      congestion_logs: [{ congestion_level: 0.25, current_count: 15, timestamp: new Date().toISOString() }]
    },
    {
      id: "17ea5fc4-4810-4b1e-9853-852dffc809f6",
      name: "삼성전자 구미 정문 주차장",
      type: "parking",
      latitude: 36.1149,
      longitude: 128.3528,
      capacity: 800,
      operating_hours: { "24_7": true },
      features: { has_ev_charger: true, indoor: false, average_processing_time: 5 },
      congestion_logs: [{ congestion_level: 0.24, current_count: 192, timestamp: new Date().toISOString() }]
    },
    {
      id: "96769f68-3aba-4491-a7b9-000e330f8271",
      name: "공단동 공영주차장",
      type: "parking",
      latitude: 36.1201,
      longitude: 128.3493,
      capacity: 250,
      operating_hours: { "24_7": true },
      features: { has_ev_charger: true, indoor: false, average_processing_time: 5 },
      congestion_logs: [{ congestion_level: 0.12, current_count: 30, timestamp: new Date().toISOString() }]
    },
    {
      id: "e9e889c3-70c6-43c1-8930-c7183807e5ea",
      name: "구미상공회의소 컨퍼런스룸",
      type: "meeting_room",
      latitude: 36.1167,
      longitude: 128.3445,
      capacity: 120,
      operating_hours: { weekday: "09:00-18:00", weekend: "closed" },
      features: { has_beam_projector: true, has_video_conf: false, average_processing_time: 10 },
      congestion_logs: [{ congestion_level: 0.17, current_count: 20, timestamp: new Date().toISOString() }]
    },
    {
      id: "36b3342e-767a-4766-80fc-650546887e1c",
      name: "산단공 구미지사 회의실 A",
      type: "meeting_room",
      latitude: 36.1198,
      longitude: 128.3478,
      capacity: 30,
      operating_hours: { weekday: "09:00-18:00", weekend: "closed" },
      features: { has_beam_projector: true, has_video_conf: false, average_processing_time: 10 },
      congestion_logs: [{ congestion_level: 0.26, current_count: 7, timestamp: new Date().toISOString() }]
    },
    {
      id: "d7bdfff0-9422-4eda-8a80-3039497a24cd",
      name: "LG디스플레이 물류센터 1번",
      type: "loading_dock",
      latitude: 36.1256,
      longitude: 128.3645,
      capacity: 8,
      operating_hours: { "24_7": true },
      features: { max_tonnage: 15, has_forklift: true, average_processing_time: 30 },
      congestion_logs: [{ congestion_level: 0.13, current_count: 1, timestamp: new Date().toISOString() }]
    }
  ];

  // Load Original Facility Details
  useEffect(() => {
    if (!facilityId) return;

    async function fetchOriginalFacility() {
      setLoadingOriginal(true);
      try {
        const { data, error } = await supabase
          .from("facilities")
          .select(`
            id,
            name,
            type,
            features,
            congestion_logs (
              congestion_level,
              timestamp
            )
          `)
          .eq("id", facilityId)
          .order("timestamp", { foreignTable: "congestion_logs", ascending: false })
          .limit(1, { foreignTable: "congestion_logs" })
          .single();

        let originalData = data;
        if (error || !data) {
          console.warn("Using fallback local details for original facility.");
          originalData = MOCK_SEED_FACILITIES.find((f) => f.id === facilityId) || null;
        }

        if (originalData) {
          const latestLog = originalData.congestion_logs && originalData.congestion_logs[0];
          const level = latestLog ? latestLog.congestion_level : 0.0;

          setOriginalFacility({
            id: originalData.id,
            name: originalData.name,
            type: originalData.type,
            congestionLevel: level,
            features: originalData.features || {},
          });

          const defaultTimes: Record<string, number> = {
            cafeteria: 20,
            parking: 5,
            meeting_room: 10,
            loading_dock: 30,
          };
          const avgProcessTime = originalData.features?.average_processing_time ?? defaultTimes[originalData.type] ?? 15;
          const hour = new Date().getHours();
          let timeMultiplier = 1.0;
          if (hour >= 12 && hour < 14) timeMultiplier = 1.3;
          else if (hour === 7 || hour === 15) timeMultiplier = 1.2;

          const predicted = level * avgProcessTime * timeMultiplier;
          setOriginalWaitTime(predicted.toFixed(1));
        }
      } catch (err) {
        console.warn("Failed to fetch original facility, falling back:", err);
        const fallbackObj = MOCK_SEED_FACILITIES.find((f) => f.id === facilityId);
        if (fallbackObj) {
          setOriginalFacility({
            id: fallbackObj.id,
            name: fallbackObj.name,
            type: fallbackObj.type,
            congestionLevel: fallbackObj.congestion_logs[0].congestion_level,
            features: fallbackObj.features,
          });
          setOriginalWaitTime("17.5");
        }
      } finally {
        setLoadingOriginal(false);
      }
    }

    fetchOriginalFacility();
  }, [facilityId]);

  // Check Cold Start & Fetch Recommendations
  useEffect(() => {
    if (!userId || !facilityId) return;

    async function checkHistoryAndFetch() {
      setLoadingRecommendations(true);
      try {
        const { count, error } = await supabase
          .from("recommendations")
          .select("id", { count: "exact", head: true })
          .eq("user_id", userId);

        if (!error && count === 0) {
          setShowOnboarding(true);
          setLoadingRecommendations(false);
          return;
        }

        const recommendationsList = await getRecommendations(facilityId, { lat, lng });
        setRecommendations(recommendationsList);
      } catch (err) {
        console.warn("Error calling FastAPI, using demo fallback recommendations:", err);
        
        // Demo Fallback Recommendations
        const fallbacks: RecommendationResponse[] = MOCK_SEED_FACILITIES
          .filter(f => f.id !== facilityId && f.type === (originalFacility?.type || "cafeteria"))
          .slice(0, 3)
          .map((f, i) => ({
            recommendationId: `mock-rec-id-${i}`,
            facility: {
              id: f.id,
              name: f.name,
              type: f.type,
              latitude: f.latitude,
              longitude: f.longitude,
              capacity: f.capacity,
              operatingHours: f.operating_hours,
              features: f.features
            },
            tttvScore: 0.85 - (i * 0.1),
            breakdown: {
              preference: 0.9 - (i * 0.15),
              waitTime: 5 + (i * 3),
              travelTime: 2.5 + i,
              incentive: 0.2
            },
            distanceM: 120 + (i * 35)
          }));
        
        setRecommendations(fallbacks);
      } finally {
        setLoadingRecommendations(false);
      }
    }

    checkHistoryAndFetch();
  }, [userId, facilityId, lat, lng, originalFacility]);

  // Handle Onboarding Preferences Submission
  const handleOnboardingSubmit = async () => {
    if (selectedOnboardingCats.length < 3) {
      alert("선호하는 인프라 종류를 3개 이상 선택해 주세요!");
      return;
    }
    if (!userId || !facilityId) return;

    setIsOnboardingSubmitting(true);
    try {
      // 1. Update preferred categories in Postgres users table
      const { error } = await supabase
        .from("users")
        .update({ preferred_categories: selectedOnboardingCats })
        .eq("id", userId);

      if (error) {
        console.warn("Supabase user update skipped/failed (common in mock session):", error);
      }

      setShowOnboarding(false);
      setToast("선호 정보가 등록되었습니다! 맞춤 추천을 계산합니다.");

      // 2. Fetch recommendations (FastAPI will detect missing Pinecone vector,
      // load the updated DB categories, generate the average vector, upsert, and query).
      setLoadingRecommendations(true);
      const recommendationsList = await getRecommendations(facilityId, { lat, lng });
      setRecommendations(recommendationsList);
    } catch (err) {
      console.warn("Error during onboarding fetch fallback:", err);
      // Fallback: If FastAPI recommend API fails, load mock recommendations
      const fallbacks: RecommendationResponse[] = MOCK_SEED_FACILITIES
        .filter(f => f.id !== facilityId && f.type === (originalFacility?.type || "cafeteria"))
        .slice(0, 3)
        .map((f, i) => ({
          recommendationId: `mock-rec-id-${i}`,
          facility: {
            id: f.id,
            name: f.name,
            type: f.type,
            latitude: f.latitude,
            longitude: f.longitude,
            capacity: f.capacity,
            operatingHours: f.operating_hours,
            features: f.features
          },
          tttvScore: 0.85 - (i * 0.1),
          breakdown: {
            preference: 0.9 - (i * 0.15),
            waitTime: 5 + (i * 3),
            travelTime: 2.5 + i,
            incentive: 0.2
          },
          distanceM: 120 + (i * 35)
        }));
      setRecommendations(fallbacks);
      setShowOnboarding(false);
    } finally {
      setIsOnboardingSubmitting(false);
      setLoadingRecommendations(false);
    }
  };

  // CTA Click: Accept Alternative
  const handleAccept = async (rec: RecommendationResponse) => {
    // 팝업 차단 방지: 동기적 흐름 내에서 빈 창을 즉시 오픈
    const newWindow = window.open("about:blank", "_blank");
    
    try {
      setToast("선택 경로 수락 완료! 안내를 시작합니다.");
      
      // 1. Submit feedback accepted to FastAPI
      await submitFeedback(rec.recommendationId, "accepted");

      // 2. Prepare toast category-specific greeting
      let greeting = "즐거운 시간 되세요!";
      if (rec.facility.type === "cafeteria") greeting = "맛있게 드세요!";
      else if (rec.facility.type === "parking") greeting = "안전 주차 하세요!";
      else if (rec.facility.type === "loading_dock") greeting = "안전 조업 하세요!";

      setToast(`${greeting} 다음 추천이 더 정확해집니다 🎯`);

      // 3. Open Kakao Maps Directions in the pre-opened tab
      const destUrl = `https://map.kakao.com/link/to/${encodeURIComponent(rec.facility.name)},${rec.facility.latitude},${rec.facility.longitude}`;
      
      if (newWindow) {
        newWindow.location.href = destUrl;
      } else {
        // 새 창 열기에 실패한 경우 현재 창에서 이동
        window.location.href = destUrl;
      }
    } catch (err) {
      console.error("Error submitting accepted feedback:", err);
      // 에러 발생 시에도 빈 창이 덩그러니 남지 않도록 목적지로 보냄
      const destUrl = `https://map.kakao.com/link/to/${encodeURIComponent(rec.facility.name)},${rec.facility.latitude},${rec.facility.longitude}`;
      if (newWindow) {
        newWindow.location.href = destUrl;
      } else {
        window.location.href = destUrl;
      }
    }
  };

  // "다른 대안 보기" Click: Reject current top 3, fetch next 3
  const handleRejectAllAndRefresh = async () => {
    if (recommendations.length === 0 || !facilityId) return;
    setIsRefreshing(true);
    try {
      // 1. Call submitFeedback for all displayed recommendations as rejected
      await Promise.all(
        recommendations.map((rec) => submitFeedback(rec.recommendationId, "rejected"))
      );

      // 2. Fetch recommendations again to get the next best candidates
      const fresh = await getRecommendations(facilityId, { lat, lng });
      setRecommendations(fresh);
      setToast("선호도를 조정하여 새로운 대안을 추천했습니다 🔍");
    } catch (err) {
      console.error("Error during rejecting and refreshing:", err);
      setToast("새 추천 대안을 불러오는 도중 오류가 발생했습니다.");
    } finally {
      setIsRefreshing(false);
    }
  };

  const getTypeName = (type: string) => {
    switch (type) {
      case "cafeteria":
        return "식당";
      case "parking":
        return "주차장";
      case "meeting_room":
        return "회의실";
      case "loading_dock":
        return "하역장";
      default:
        return "공용시설";
    }
  };

  const getCongestionLabel = (level: number) => {
    if (level >= 0.7) return "혼잡";
    if (level >= 0.3) return "보통";
    return "여유";
  };

  const categoriesList = [
    { id: "cafeteria", label: "식당 🍴" },
    { id: "parking", label: "주차장 🚗" },
    { id: "meeting_room", label: "회의실 🤝" },
    { id: "loading_dock", label: "하역장 🚚" },
  ];

  return (
    <main className="min-h-screen bg-[#0a0f1e] text-white p-4 md:p-8 flex flex-col justify-between items-center relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

      <div className="w-full max-w-md md:max-w-2xl space-y-6 relative z-10 flex-1 py-4">
        {/* Header */}
        <header className="flex items-center justify-between border-b border-white/10 pb-4">
          <button
            onClick={() => router.push("/worker/map")}
            className="text-xs text-slate-400 hover:text-white flex items-center gap-1.5 transition-all duration-200"
          >
            ← 지도 보기
          </button>
          <span className="text-sm font-extrabold tracking-tight gradient-text">InduSpot 추천 AI</span>
          <div className="w-14"></div> {/* spacer */}
        </header>

        {/* 1. Original Facility Card */}
        <section>
          {loadingOriginal ? (
            <div className="glass-panel p-5 rounded-2xl border border-white/5 animate-pulse flex flex-col gap-3">
              <div className="h-4 bg-white/10 w-2/3 rounded-md" />
              <div className="h-3 bg-white/10 w-1/2 rounded-md" />
            </div>
          ) : originalFacility ? (
            <div className="glass-panel p-5 rounded-2xl border border-rose-500/20 bg-rose-500/5 shadow-[0_4px_24px_rgba(239,68,68,0.05)] relative overflow-hidden">
              <div className="absolute top-0 right-0 w-24 h-24 bg-rose-500/10 rounded-full blur-2xl pointer-events-none" />
              <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                <span className="text-[10px] text-rose-400 font-bold uppercase tracking-wider">우회 필요</span>
              </div>
              <h2 className="text-base md:text-lg font-bold text-slate-100 mt-2">
                지금 <span className="text-rose-400">{originalFacility.name}</span>은{" "}
                <span className="text-rose-400">혼잡</span>합니다.
              </h2>
              <p className="text-xs text-slate-400 mt-1 leading-relaxed">
                현재 대기 시간은 약 <span className="font-semibold text-rose-400">{originalWaitTime}분</span>으로
                예상됩니다. 아래의 최적화된 TTTV 대안 시설을 권장합니다.
              </p>
            </div>
          ) : (
            <div className="glass-panel p-5 rounded-2xl border border-white/5 text-center text-xs text-slate-400">
              시설 정보를 불러오지 못했습니다.
            </div>
          )}
        </section>

        {/* 2. Alternative Recommendation Cards List */}
        <section className="space-y-4">
          <h3 className="text-sm font-bold text-slate-300">FastAPI 실시간 최적화 경로 (최대 3개)</h3>

          {loadingRecommendations ? (
            // Skeleton Loader
            [1, 2, 3].map((idx) => (
              <div key={idx} className="glass-panel p-5 rounded-2xl border border-white/5 animate-pulse flex flex-col gap-3">
                <div className="flex justify-between items-center">
                  <div className="h-4 bg-white/10 w-1/3 rounded-md" />
                  <div className="h-4 bg-white/10 w-16 rounded-full" />
                </div>
                <div className="h-24 bg-white/5 rounded-xl w-full" />
                <div className="h-3 bg-white/10 w-2/3 rounded-md" />
                <div className="h-10 bg-white/10 w-full rounded-xl mt-1" />
              </div>
            ))
          ) : recommendations.length > 0 ? (
            recommendations.map((rec) => {
              const waitTime = rec.breakdown?.waitTime?.toFixed(1) || "--";
              const travelTime = (rec.distanceM / 80).toFixed(1); // 80m/min (approx. 4.8 km/h)
              const preferencePct = Math.round((rec.breakdown?.preference || 0) * 100);

              return (
                <div
                  key={rec.recommendationId}
                  className="glass-panel p-5 rounded-2xl border border-white/10 transition-all duration-300 hover:border-sky-500/30 hover:shadow-lg hover:shadow-sky-500/5 hover:scale-[1.01]"
                >
                  {/* Top info row */}
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-[10px] font-bold text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-md">
                        {getTypeName(rec.facility.type)}
                      </span>
                      <h4 className="text-base font-extrabold text-slate-100 mt-1.5">
                        {rec.facility.name}
                      </h4>
                    </div>
                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block">TTTV 지수</span>
                      <span className="text-sm font-extrabold text-purple-400">
                        {rec.tttvScore.toFixed(2)}점
                      </span>
                    </div>
                  </div>

                  {/* Minimap container */}
                  <div className="my-3">
                    <MiniMap
                      latitude={rec.facility.latitude}
                      longitude={rec.facility.longitude}
                      mapLoaded={mapLoaded}
                    />
                  </div>

                  {/* TTTV Breakdown Indicators */}
                  <div className="grid grid-cols-3 gap-2 py-2 border-t border-b border-white/5 my-3 text-[11px] text-slate-300">
                    <div className="text-center">
                      <span className="text-slate-500 block text-[9px] uppercase">선호 일치율</span>
                      <span className="font-bold text-sky-300">{preferencePct}%</span>
                    </div>
                    <div className="text-center border-l border-r border-white/5">
                      <span className="text-slate-500 block text-[9px] uppercase">예상 대기</span>
                      <span className="font-bold text-amber-400">{waitTime}분</span>
                    </div>
                    <div className="text-center">
                      <span className="text-slate-500 block text-[9px] uppercase">예상 도보</span>
                      <span className="font-bold text-emerald-400">{travelTime}분 ({Math.round(rec.distanceM)}m)</span>
                    </div>
                  </div>

                  {/* CTA button */}
                  <button
                    onClick={() => handleAccept(rec)}
                    className="w-full py-2.5 bg-gradient-to-r from-sky-500 to-purple-600 rounded-xl font-bold text-xs transition-all duration-300 hover:opacity-90 active:scale-[0.98] shadow-md shadow-blue-500/10"
                  >
                    여기로 갈래요
                  </button>
                </div>
              );
            })
          ) : (
            <div className="glass-panel p-8 rounded-2xl border border-white/5 text-center text-sm text-slate-400">
              주변 150m 이내에 추천 가능한 대안 시설이 없습니다.
            </div>
          )}
        </section>

        {/* 3. Refresh Action Button */}
        {recommendations.length > 0 && (
          <div className="pt-2">
            <button
              onClick={handleRejectAllAndRefresh}
              disabled={isRefreshing}
              className="w-full py-3 bg-white/5 hover:bg-white/10 border border-white/10 rounded-xl text-slate-300 hover:text-white font-semibold text-xs transition-all duration-300 flex items-center justify-center gap-2 disabled:opacity-50"
            >
              {isRefreshing ? (
                <>
                  <span className="w-3.5 h-3.5 border-2 border-slate-300 border-t-transparent rounded-full animate-spin" />
                  새로운 대안 로드 중...
                </>
              ) : (
                <>
                  🔄 다른 대안 보기
                </>
              )}
            </button>
          </div>
        )}
      </div>

      {/* Onboarding Overlay Modal (Cold Start) */}
      {showOnboarding && (
        <div className="fixed inset-0 z-50 bg-[#060814]/90 backdrop-blur-md flex items-center justify-center p-4">
          <div className="glass-panel max-w-sm w-full p-6 md:p-8 rounded-3xl border border-white/10 space-y-6 shadow-2xl relative">
            <div className="absolute top-0 right-0 w-32 h-32 bg-sky-500/10 rounded-full blur-3xl pointer-events-none" />
            <div className="space-y-2 text-center">
              <span className="text-xl">🎯</span>
              <h3 className="text-lg font-extrabold text-slate-100">맞춤형 추천 온보딩</h3>
              <p className="text-xs text-slate-400 leading-relaxed">
                InduSpot AI의 최적화된 TTTV 대안 경로 매칭을 제공받기 위해, 평소에 자주 방문하시는 시설 종류를 **3개 이상** 선택해 주세요.
              </p>
            </div>

            {/* Checkbox Grid */}
            <div className="grid grid-cols-2 gap-2">
              {categoriesList.map((cat) => {
                const isSelected = selectedOnboardingCats.includes(cat.id);
                return (
                  <button
                    key={cat.id}
                    onClick={() => {
                      if (isSelected) {
                        setSelectedOnboardingCats(selectedOnboardingCats.filter((id) => id !== cat.id));
                      } else {
                        setSelectedOnboardingCats([...selectedOnboardingCats, cat.id]);
                      }
                    }}
                    className={`p-3 rounded-2xl border text-xs font-semibold text-center transition-all duration-200 ${
                      isSelected
                        ? "bg-sky-500/10 border-sky-400 text-sky-300 shadow-md shadow-sky-500/5"
                        : "bg-white/5 border-white/10 text-slate-300 hover:border-white/20 hover:text-white"
                    }`}
                  >
                    {cat.label}
                  </button>
                );
              })}
            </div>

            {/* Submit onboarding Button */}
            <button
              onClick={handleOnboardingSubmit}
              disabled={selectedOnboardingCats.length < 3 || isOnboardingSubmitting}
              className="w-full py-3 bg-gradient-to-r from-sky-500 to-purple-600 rounded-xl font-bold text-xs transition-all duration-300 hover:opacity-90 active:scale-[0.98] shadow-lg shadow-blue-500/25 disabled:opacity-50"
            >
              {isOnboardingSubmitting ? "설정 저장 중..." : `선택 완료 (${selectedOnboardingCats.length}/3+)`}
            </button>
          </div>
        </div>
      )}

      {/* Toast Notification */}
      {toast && <Toast message={toast} onClose={() => setToast(null)} />}
    </main>
  );
}

// Suspense wrapped Page Export
export default function RecommendPage() {
  return (
    <Suspense
      fallback={
        <div className="min-h-screen bg-[#0a0f1e] text-white flex items-center justify-center">
          <div className="text-slate-400 text-sm animate-pulse">추천 연산 준비 중...</div>
        </div>
      }
    >
      <RecommendContent />
    </Suspense>
  );
}
