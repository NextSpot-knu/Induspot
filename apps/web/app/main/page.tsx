'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Home, Bookmark, User, Search, Mic, Utensils, ParkingCircle, Building2, Coffee, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';
import { createPublicClient } from '@/lib/supabase';
import { getMarkerSvg } from '@/lib/utils';
import { scoreFacility, compareTttv, rankFacilities, recToTttv, buildReason } from '@/lib/recommender';
import { recommendByType } from '@/lib/api-client';

const supabase = createPublicClient();

declare global {
  interface Window {
    kakao: any;
  }
}


export default function MainPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);
  const activeOverlayRef = useRef<any>(null);

  const [activeTab, setActiveTab] = useState('Home');
  const [activeFilter, setActiveFilter] = useState('주차장');
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<any>(null);
  // 그룹(모음) 마커 하이라이트 id — 카드 선택(selectedFacility)과 분리해 마커 확대/색상변경만 적용
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isCardHidden, setIsCardHidden] = useState(false);
  const [isMockLocationMinimized, setIsMockLocationMinimized] = useState(true);
  const [isMockTimeMinimized, setIsMockTimeMinimized] = useState(true);
  const [mockHour, setMockHour] = useState<number | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  const router = useRouter();

  const appKey = process.env.NEXT_PUBLIC_KAKAO_MAPS_APP_KEY || process.env.NEXT_PUBLIC_KAKAO_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY || "";

  // Load facilities from Supabase
  useEffect(() => {
    async function loadFacilities() {
      try {
        // Fetch facilities (limit 2000)
        const { data: facilitiesData, error: facError } = await supabase
          .from("facilities")
          .select("id, name, type, latitude, longitude, capacity, operating_hours, features")
          .limit(2000);

        if (facError) {
          console.warn("Failed to load facilities:", facError);
          return;
        }

        // Fetch only recent logs (limit 3000) to get the latest per facility
        const { data: logs, error: logsError } = await supabase
          .from("congestion_logs")
          .select("facility_id, congestion_level, current_count, timestamp")
          .order("timestamp", { ascending: false })
          .limit(3000);

        if (logsError) {
          console.warn("Failed to load congestion logs:", logsError);
        }

        const latestLogsMap: Record<string, any> = {};
        if (logs && logs.length > 0) {
          for (const log of logs) {
            if (!latestLogsMap[log.facility_id]) {
              latestLogsMap[log.facility_id] = log;
            }
          }
        }

        const mapped = facilitiesData.map((f: any) => {
          const latestLog = latestLogsMap[f.id];
          let baseCongestion = latestLog ? latestLog.congestion_level : 0.0;
          if (!latestLog) {
            let hash = 0;
            const str = f.id;
            for (let i = 0; i < str.length; i++) hash = Math.imul(31, hash) + str.charCodeAt(i);
            baseCongestion = Math.abs(hash % 100) / 100;
          }

          return {
            id: f.id,
            name: f.name,
            type: f.type,
            latitude: f.latitude,
            longitude: f.longitude,
            capacity: f.capacity,
            features: f.features,
            baseCongestion: baseCongestion,
            congestionLevel: baseCongestion,
            currentCount: latestLog ? latestLog.current_count : Math.floor(baseCongestion * (f.capacity || 100)),
            lastUpdated: latestLog ? latestLog.timestamp : new Date().toISOString(),
          };
        });

        // --- Mock Data Injection for Lounges and Meeting Rooms ---
        const companyLat = 36.109031;
        const companyLng = 128.388471;
        
        const dummyLoungesSub = Array.from({length: 5}).map((_, i) => {
           // 혼잡도 하나로 이용 인원·설비 이용수를 함께 결정(혼잡↑ → 이용↑ → 잔여↓, 서로 연관되게)
           const congestionLevel = Math.random();
           const currentCount = Math.round(congestionLevel * 10);
           return {
             id: `dummy-lounge-${i}`,
             name: `사내 휴게실 ${i+1}`,
             type: 'rest_area',
             latitude: companyLat,
             longitude: companyLng,
             capacity: 10,
             congestionLevel,
             currentCount,
             features: {
               massageChairs: { total: 3, inUse: Math.round(congestionLevel * 3) },
               sleepCapsules: { total: 2, inUse: Math.round(congestionLevel * 2) },
               playstation: { total: 1, inUse: Math.round(congestionLevel) }
             }
           };
        });

        const dummyLoungeGroup = {
           id: `dummy-lounge-group`,
           name: `사내 휴게실 모음`,
           type: 'rest_area',
           latitude: companyLat,
           longitude: companyLng,
           congestionLevel: dummyLoungesSub.reduce((acc, curr) => acc + curr.congestionLevel, 0) / 5,
           capacity: dummyLoungesSub.reduce((a, c) => a + c.capacity, 0),
           currentCount: dummyLoungesSub.reduce((a, c) => a + c.currentCount, 0),
           isGroup: true,
           subFacilities: dummyLoungesSub
        };
        
        const dummyMeetingsInsideSub = Array.from({length: 8}).map((_, i) => {
           // 혼잡도로 사용 여부·이용 인원·남은 시간(예상 대기)을 일관되게 결정
           const congestionLevel = Math.random();
           const occupied = congestionLevel >= 0.5; // 보통(>=0.5) 이상이면 사용중
           const currentCount = occupied ? Math.max(1, Math.round(congestionLevel * 8)) : 0;
           const remainingMinutes = occupied ? Math.max(5, Math.round(congestionLevel * 55)) : 0; // 혼잡↑ → 대기↑
           return {
             id: `dummy-meeting-in-${i}`,
             name: `사내 회의실 ${i+1}호`,
             type: 'meeting_room',
             latitude: companyLat,
             longitude: companyLng,
             capacity: 8,
             congestionLevel,
             currentCount,
             features: { remainingMinutes }
           };
        });

        const dummyMeetingGroup = {
           id: `dummy-meeting-group`,
           name: `사내 회의실 모음`,
           type: 'meeting_room',
           latitude: companyLat,
           longitude: companyLng,
           congestionLevel: dummyMeetingsInsideSub.reduce((acc, curr) => acc + curr.congestionLevel, 0) / 8,
           capacity: dummyMeetingsInsideSub.reduce((a, c) => a + c.capacity, 0),
           currentCount: dummyMeetingsInsideSub.reduce((a, c) => a + c.currentCount, 0),
           isGroup: true,
           subFacilities: dummyMeetingsInsideSub
        };

        const dummyMeetingsOutside = Array.from({length: 2}).map((_, i) => {
           const congestionLevel = Math.random();
           const occupied = congestionLevel >= 0.5; // 보통(>=0.5) 이상이면 사용중
           const currentCount = occupied ? Math.max(1, Math.round(congestionLevel * 12)) : 0;
           const remainingMinutes = occupied ? Math.max(5, Math.round(congestionLevel * 55)) : 0;
           return {
             id: `dummy-meeting-out-${i}`,
             name: `외부 공유오피스 회의실 ${['A','B'][i]}`,
             type: 'meeting_room',
             latitude: companyLat + (Math.random() > 0.5 ? 0.006 : -0.006) + (Math.random() * 0.001),
             longitude: companyLng - 0.02 + (Math.random() * 0.005),
             capacity: 12,
             congestionLevel,
             currentCount,
             features: { remainingMinutes }
           };
        });

        const finalFacilities = [...mapped, dummyLoungeGroup, dummyMeetingGroup, ...dummyMeetingsOutside];
        setFacilities(finalFacilities);
      } catch (err) {
        console.error("Error loading facilities:", err);
      }
    }

    loadFacilities();
  }, []);

  // Apply mock hour congestion scaling
  useEffect(() => {
    if (facilities.length === 0) return;
    
    setFacilities(prev => prev.map(f => {
      let currentCongestion = f.baseCongestion !== undefined ? f.baseCongestion : f.congestionLevel;
      if (mockHour !== null) {
        let hash2 = 0;
        for (let i = 0; i < f.id.length; i++) hash2 = Math.imul(31, hash2) + f.id.charCodeAt(f.id.length - 1 - i);
        const pop = Math.abs(hash2 % 100) / 100; // deterministic popularity (0.0~1.0)

        if (mockHour === 12.5) { // 점심 피크
          if (f.type === 'cafeteria') {
            currentCongestion = pop > 0.6 ? (0.7 + pop * 0.3) : (pop + 0.2);
          } else if (f.type === 'parking') {
            currentCongestion = pop > 0.8 ? (0.6 + pop * 0.4) : (pop * 0.8);
          } else {
            currentCongestion = pop * 0.5;
          }
        } else if (mockHour === 18.5) { // 저녁 피크
          if (f.type === 'parking') {
            currentCongestion = pop > 0.5 ? (0.6 + pop * 0.4) : (pop + 0.1);
          } else if (f.type === 'cafeteria') {
            currentCongestion = pop > 0.7 ? (0.6 + pop * 0.4) : (pop * 0.6);
          } else if (f.type === 'loading_dock') {
            currentCongestion = pop > 0.6 ? (0.5 + pop * 0.5) : (pop * 0.7);
          } else {
            currentCongestion = pop * 0.5;
          }
        }
      }
      return { ...f, congestionLevel: Math.min(1.0, currentCongestion) };
    }));
  }, [mockHour]);

  const [rejectedIds, setRejectedIds] = useState<Set<string>>(new Set());
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [userLocation, setUserLocation] = useState<{ lat: number; lng: number }>({ lat: 36.1198, lng: 128.3471 });
  const [preferredCategories, setPreferredCategories] = useState<string[]>([]);
  const [userId, setUserId] = useState<string | null>(null);

  // Load user profile & current location
  useEffect(() => {
    async function loadUser() {
      const { data: { session } } = await supabase.auth.getSession();
      if (session?.user) {
        setUserId(session.user.id);
        const { data: profile } = await supabase
          .from("users")
          .select("preferred_categories")
          .eq("id", session.user.id)
          .single();
        if (profile?.preferred_categories) {
          setPreferredCategories(profile.preferred_categories);
        }
      } else {
        setUserId("a2222222-2222-2222-2222-222222222222"); // Fallback mock user ID
      }
    }
    loadUser();

    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          let lat = position.coords.latitude;
          let lng = position.coords.longitude;

          // Check if coordinates are outside Gumi National Industrial Complex boundaries
          const isWithinGumi = lat >= 36.05 && lat <= 36.18 && lng >= 128.32 && lng <= 128.46;
          if (!isWithinGumi) {
            lat = 36.1198; // Gumi Complex Center (Han솥)
            lng = 128.3471;
            console.log("User is outside Gumi. Mocking location to Gumi Complex:", lat, lng);
          }

          setUserLocation({ lat, lng });
        },
        (error) => {
          console.warn("Geolocation failed, using default:", error);
        }
      );
    }
  }, []);

  // Synchronize User Location Marker on Map
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || !userLocation) return;
    const kakao = window.kakao;

    if (userMarkerRef.current) {
      userMarkerRef.current.setMap(null);
    }

    const content = `
      <style>
        @keyframes pulse-user-marker {
          0% { transform: scale(0.3); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      </style>
      <div class="user-loc-marker" style="position: relative; width: 100px; height: 100px; pointer-events: none; filter: none; -webkit-filter: none;">
        <!-- Glow (흰색 펄스) -->
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,255,0.7) 0%, rgba(255,255,255,0.35) 40%, rgba(255,255,255,0) 80%); animation: pulse-user-marker 2.5s infinite cubic-bezier(0.2, 0, 0.2, 1);"></div>
        <!-- White Border -->
        <div style="position: absolute; top: 50%; left: 50%; width: 30px; height: 30px; margin-top: -15px; margin-left: -15px; background: #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(0,0,0,0.45);"></div>
        <!-- Core (다른 마커 로고와 동일한 #ffffff 흰색) -->
        <div style="position: absolute; top: 50%; left: 50%; width: 18px; height: 18px; margin-top: -9px; margin-left: -9px; background: #ffffff; border-radius: 50%;"></div>
      </div>
    `;

    const userMarker = new kakao.maps.CustomOverlay({
      position: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      content: content,
      zIndex: 10
    });

    userMarker.setMap(mapInstanceRef.current);
    userMarkerRef.current = userMarker;
  }, [userLocation, mapLoaded]);

  // (selected facility ID sessionStorage sync removed – no longer used)


  // Load saved IDs, rejected IDs, and active filter from storage on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      try {
        const saved = localStorage.getItem('induspot_saved_facilities');
        if (saved) {
          const parsed = JSON.parse(saved);
          const ids = new Set<string>(parsed.map((item: any) => item.id));
          setSavedIds(ids);
        }
      } catch (e) {
        console.error("Failed to load saved IDs from localStorage:", e);
      }

      try {
        const rejected = sessionStorage.getItem('induspot_rejected_ids');
        if (rejected) {
          setRejectedIds(new Set(JSON.parse(rejected)));
        }
      } catch (e) {
        console.error("Failed to load rejected IDs from sessionStorage:", e);
      }

      try {
        const savedFilter = sessionStorage.getItem('induspot_active_filter');
        if (savedFilter) {
          setActiveFilter(savedFilter);
        }
      } catch (e) {
        console.error("Failed to load active filter from sessionStorage:", e);
      }
    }
  }, []);

  // 추천 점수·정렬·사유 로직은 lib/recommender(백엔드 TTTV 미러)로 분리.
  // CATEGORY_VECTORS·점수 계산·거리(haversine)는 모듈에 있고, 아래는 호출부 유지를 위한 얇은 위임 래퍼다.
  const calculateTTTV = (facility: any) =>
    scoreFacility(facility, { userLocation, preferredCategories, mockHour });

  const compareFacilities = compareTttv;

  // 모음(그룹)은 추천/카드 랭킹에서 내부 sub로 펼친다 — 그룹 자체는 카드로 띄우지 않고
  // 모음 안에서 '가장 최적의 개별 장소'를 추천한다(지도 마커는 그대로 모음으로 유지).
  const expandGroups = (list: any[]) =>
    list.flatMap((f: any) => (f.isGroup && Array.isArray(f.subFacilities)) ? f.subFacilities : [f]);

  // 선택 마커가 하단 카드에 가리지 않도록 지도 위쪽 가시영역으로 패닝(지도 중심을 마커보다 아래로 둔다).
  const panToVisible = (lat: number, lng: number) => {
    const map = mapInstanceRef.current;
    if (!map || typeof window === 'undefined' || !window.kakao) return;
    const latlng = new window.kakao.maps.LatLng(lat, lng);
    try {
      const proj = map.getProjection();
      const pt = proj.containerPointFromCoords(latlng);
      const h = mapContainerRef.current?.clientHeight || 0;
      const target = proj.coordsFromContainerPoint(
        new window.kakao.maps.Point(pt.x, pt.y + Math.round(h * 0.22))
      );
      map.panTo(target);
    } catch (e) {
      map.panTo(latlng);
    }
  };

  // AI 추천 동기화: 실 DB 시설은 백엔드(/recommendations/by-type) 랭킹 + Gemini 사유,
  // 합성 그룹·시간대 시뮬(mockHour) 등 데모는 lib/recommender 미러(사유 포함)로 처리해 합친 뒤 #1을 표시.
  // (백엔드는 합성 시설/mockHour 를 모르므로 데모는 분리해 클라 미러로 점수를 매긴다.)
  useEffect(() => {
    if (facilities.length === 0) return;

    const filterMap: Record<string, string> = {
      '식당': 'cafeteria',
      '주차장': 'parking',
      '회의실': 'meeting_room',
      '휴게실': 'rest_area'
    };
    const targetType = filterMap[activeFilter];

    let candidates = facilities.filter(
      f => f.type === targetType && !rejectedIds.has(f.id) && !savedIds.has(f.id)
    );
    if (candidates.length === 0) {
      candidates = facilities.filter(f => f.type === targetType);
    }
    if (candidates.length === 0) {
      setSelectedFacility(null);
      return;
    }

    const isDemo = (f: any) => f.isGroup || String(f.id).startsWith('dummy-');
    const realCands = candidates.filter(f => !isDemo(f));
    // 모음은 sub로 펼쳐 개별 장소를 랭킹(모음 자체는 카드로 안 띄움). 펼친 sub도 거절/저장 제외.
    const demoCands = expandGroups(candidates.filter(isDemo))
      .filter((f: any) => !rejectedIds.has(f.id) && !savedIds.has(f.id));
    const liveMode = mockHour === null; // 시간대 시뮬이 켜지면 데모(목업) 모드로 일관 처리
    const scoreOpts = { userLocation, preferredCategories, mockHour };

    let cancelled = false;
    (async () => {
      try {
        let realRanked: any[] = [];
        if (liveMode && realCands.length > 0) {
          try {
            const recs = await recommendByType(targetType, userLocation, [...rejectedIds, ...savedIds]);
            const byId = new Map(realCands.map(f => [f.id, f]));
            realRanked = recs
              .filter(r => byId.has(r.facility.id))
              .map(r => {
                const base = byId.get(r.facility.id);
                const tttv = recToTttv(r);
                return { ...base, tttv, reason: r.reason || buildReason(base, tttv) };
              });
          } catch (e) {
            console.warn("by-type 추천 실패 → 목업 미러로 폴백:", e);
            realRanked = [];
          }
        }
        // 백엔드 미가용/데모 모드: 실 후보도 클라 미러로 랭킹(동일 가중치 + 사유)
        if (realRanked.length === 0 && realCands.length > 0) {
          realRanked = rankFacilities(realCands, scoreOpts);
        }
        // 합성/데모 시설은 항상 클라 미러로 점수·사유 부여
        const demoRanked = rankFacilities(demoCands, scoreOpts);

        const all = [...realRanked, ...demoRanked].sort(compareTttv);
        if (cancelled) return;
        if (all.length === 0) {
          setSelectedFacility(null);
          return;
        }
        setSelectedFacility(all[0]);
        setIsCardHidden(false);
        if (mapInstanceRef.current && typeof all[0].latitude === 'number') {
          panToVisible(all[0].latitude, all[0].longitude);
        }
      } catch (err) {
        console.error("Error in recommendation synchronization effect:", err);
      }
    })();

    return () => { cancelled = true; };
  }, [facilities, activeFilter, rejectedIds, savedIds, userLocation, preferredCategories, mockHour]);

  // Action Button Handlers
  const handleAccept = (fac: any) => {
    if (!fac) return;

    let greeting = "즐거운 시간 되세요!";
    if (fac.type === "cafeteria") greeting = "맛있게 드세요!";
    else if (fac.type === "parking") greeting = "안전 주차 하세요!";
    else if (fac.type === "meeting_room") greeting = "성공적인 회의 되세요!";
    
    showToast(`${greeting} 다음 추천이 더 정확해집니다 🎯`);

    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    
    if (isMobile) {
      // 모바일 기기: 카카오맵 앱 전용 스킴 (즉시 자동차 길안내 시작)
      const destUrl = `kakaomap://route?sp=${userLocation.lat},${userLocation.lng}&ep=${fac.latitude},${fac.longitude}&by=CAR`;
      window.location.href = destUrl;
    } else {
      // PC 환경: 카카오맵 웹 스킴에서 자동 길찾기(자동차 기준)를 위해 WGS84 -> WCONGNAMUL 변환 API 호출
      const newWindow = window.open('', '_blank'); // 팝업 차단 방지를 위해 미리 띄움
      
      const restApiKey = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY || "8b9591c379e8cc301162469a713c4f4d";
      const headers = { 'Authorization': `KakaoAK ${restApiKey}` };
      
      const urlStart = `https://dapi.kakao.com/v2/local/geo/transcoord.json?x=${userLocation.lng}&y=${userLocation.lat}&input_coord=WGS84&output_coord=WCONGNAMUL`;
      const urlEnd = `https://dapi.kakao.com/v2/local/geo/transcoord.json?x=${fac.longitude}&y=${fac.latitude}&input_coord=WGS84&output_coord=WCONGNAMUL`;

      Promise.all([
        fetch(urlStart, { headers }).then(r => r.json()),
        fetch(urlEnd, { headers }).then(r => r.json())
      ]).then(([startData, endData]) => {
        if (startData.documents?.length > 0 && endData.documents?.length > 0) {
          const sX = startData.documents[0].x;
          const sY = startData.documents[0].y;
          const eX = endData.documents[0].x;
          const eY = endData.documents[0].y;
          // target=car 와 rt 파라미터를 사용하여 즉시 길안내 화면 렌더링
          const destUrl = `https://map.kakao.com/?map_type=TYPE_MAP&target=car&rt=${sX},${sY},${eX},${eY}&rt1=${encodeURIComponent("현재 위치")}&rt2=${encodeURIComponent(fac.name)}`;
          if (newWindow) newWindow.location.href = destUrl;
        } else {
          throw new Error("좌표 변환 실패");
        }
      }).catch(err => {
        console.error("PC 길안내 자동 시작 실패(좌표변환 에러):", err);
        // 실패 시 기존 텍스트 채우기 방식으로 폴백
        const destUrl = `https://map.kakao.com/?sName=${encodeURIComponent("현재 위치")}&eName=${encodeURIComponent(fac.name)}&sY=${userLocation.lat}&sX=${userLocation.lng}&eY=${fac.latitude}&eX=${fac.longitude}`;
        if (newWindow) newWindow.location.href = destUrl;
      });
    }
  };

  const handlePutOff = (fac: any) => {
    if (!fac) return;
    
    // Clear selection from sessionStorage immediately to prevent restoration logic from sticking to this item
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('induspot_selected_facility_id');
      } catch (e) {}
    }

    // ★ Compute next facility BEFORE state update to avoid async race condition
    const filterMap: Record<string, string> = {
      '식당': 'cafeteria', '주차장': 'parking', '회의실': 'meeting_room', '휴게실': 'rest_area'
    };
    const targetType = filterMap[activeFilter];
    // Next candidates: exclude already-saved (prev savedIds + current fac) and rejected
    const nextSavedIds = new Set(savedIds);
    nextSavedIds.add(fac.id);
    let nextCandidates = expandGroups(facilities.filter(f => f.type === targetType))
      .filter((f: any) => !rejectedIds.has(f.id) && !nextSavedIds.has(f.id));

    // Loop back if all exhausted
    if (nextCandidates.length === 0) {
      nextCandidates = expandGroups(facilities.filter(f => f.type === targetType));
    }

    if (nextCandidates.length > 0) {
      const nextScored = nextCandidates.map(f => ({ ...f, tttv: calculateTTTV(f) }));
      nextScored.sort(compareFacilities);
      setSelectedFacility(nextScored[0]);
      setIsCardHidden(false);
      if (mapInstanceRef.current) {
        panToVisible(nextScored[0].latitude, nextScored[0].longitude);
      }
    } else {
      setSelectedFacility(null);
    }
    // ★ Force card open so the next recommendation is visible
    setIsCardHidden(false);

    setSavedIds(prev => {
      const next = new Set(prev);
      next.add(fac.id);
      return next;
    });

    try {
      const existing = localStorage.getItem('induspot_saved_facilities');
      const bookmarks = existing ? JSON.parse(existing) : [];
      
      const tttv = fac.tttv || calculateTTTV(fac);
      if (!bookmarks.some((b: any) => b.id === fac.id)) {
        bookmarks.push({
          id: fac.id,
          name: fac.name,
          category: fac.type === 'cafeteria' ? '식당' : fac.type === 'parking' ? '주차장' : fac.type === 'meeting_room' ? '회의실' : '휴게실',
          trafficStatus: fac.congestionLevel >= 0.75 ? 'orange' : fac.congestionLevel >= 0.50 ? 'yellow' : fac.congestionLevel >= 0.25 ? 'green' : 'blue',
          waitTime: `${tttv?.expectedWait || 0}분`,
          tttv: tttv,
          reason: fac.reason || buildReason(fac, tttv)
        });
        localStorage.setItem('induspot_saved_facilities', JSON.stringify(bookmarks));
      }
    } catch (e) {
      console.error("Failed to save bookmark:", e);
    }

    showToast(`'${fac.name}'이(가) Saved 탭에 저장되었습니다! 다음 추천을 불러옵니다.`);
  };

  const handleReject = (fac: any) => {
    if (!fac) return;
    
    // Clear selection from sessionStorage immediately to prevent restoration logic from sticking to this item
    if (typeof window !== 'undefined') {
      try {
        sessionStorage.removeItem('induspot_selected_facility_id');
      } catch (e) {}
    }

    // ★ Compute next facility BEFORE state update to avoid async race condition
    const filterMap: Record<string, string> = {
      '식당': 'cafeteria', '주차장': 'parking', '회의실': 'meeting_room', '휴게실': 'rest_area'
    };
    const targetType = filterMap[activeFilter];
    // Next candidates: exclude already-rejected (prev rejectedIds + current fac) and saved
    const nextRejectedIds = new Set(rejectedIds);
    nextRejectedIds.add(fac.id);
    let nextCandidates = expandGroups(facilities.filter(f => f.type === targetType))
      .filter((f: any) => !nextRejectedIds.has(f.id) && !savedIds.has(f.id));

    // Loop back if all exhausted
    if (nextCandidates.length === 0) {
      nextCandidates = expandGroups(facilities.filter(f => f.type === targetType));
    }

    if (nextCandidates.length > 0) {
      const nextScored = nextCandidates.map(f => ({ ...f, tttv: calculateTTTV(f) }));
      nextScored.sort(compareFacilities);
      setSelectedFacility(nextScored[0]);
      setIsCardHidden(false);
      if (mapInstanceRef.current) {
        panToVisible(nextScored[0].latitude, nextScored[0].longitude);
      }
    } else {
      setSelectedFacility(null);
    }
    // ★ Force card open so the next recommendation is visible
    setIsCardHidden(false);

    setRejectedIds(prev => {
      const next = new Set(prev);
      next.add(fac.id);
      if (typeof window !== 'undefined') {
        try {
          sessionStorage.setItem('induspot_rejected_ids', JSON.stringify(Array.from(next)));
        } catch (e) {
          console.error("Failed to save rejected IDs to sessionStorage:", e);
        }
      }
      return next;
    });
    
    showToast(`'${fac.name}' 추천을 폐기했습니다. 다음 추천을 불러옵니다.`);
  };

  // Initialize map if Kakao Maps script is already loaded
  useEffect(() => {
    const initInterval = setInterval(() => {
      if (typeof window !== "undefined" && window.kakao && window.kakao.maps && mapContainerRef.current) {
        clearInterval(initInterval);
        initMap();
      }
    }, 200);

    return () => clearInterval(initInterval);
  }, []);

  // Initialize Kakao Map
  const initMap = () => {
    if (mapInstanceRef.current) return;
    if (window.kakao && window.kakao.maps && mapContainerRef.current) {
      window.kakao.maps.load(() => {
        let centerLat = 36.1198;
        let centerLng = 128.3471;
        let level = 4;

        if (typeof window !== 'undefined') {
          const savedLat = sessionStorage.getItem('induspot_map_center_lat');
          const savedLng = sessionStorage.getItem('induspot_map_center_lng');
          const savedLevel = sessionStorage.getItem('induspot_map_level');
          
          if (savedLat && savedLng) {
            const parsedLat = parseFloat(savedLat);
            const parsedLng = parseFloat(savedLng);
            if (!isNaN(parsedLat) && !isNaN(parsedLng)) {
              centerLat = parsedLat;
              centerLng = parsedLng;
            }
          }
          if (savedLevel) {
            const parsedLevel = parseInt(savedLevel, 10);
            if (!isNaN(parsedLevel)) {
              level = parsedLevel;
            }
          }
        }

        const options = {
          center: new window.kakao.maps.LatLng(centerLat, centerLng),
          level: level,
        };
        const map = new window.kakao.maps.Map(mapContainerRef.current, options);
        mapInstanceRef.current = map;
        setMapLoaded(true);

        // Save center and level on map idle
        window.kakao.maps.event.addListener(map, 'idle', () => {
          const center = map.getCenter();
          const lvl = map.getLevel();
          sessionStorage.setItem('induspot_map_center_lat', center.getLat().toString());
          sessionStorage.setItem('induspot_map_center_lng', center.getLng().toString());
          sessionStorage.setItem('induspot_map_level', lvl.toString());
        });

        // 빈 지도(마커 외) 클릭 시 그룹 팝업 닫기 + 그룹 하이라이트 해제 + 추천 카드 선택해제 — 일반 지도앱 UX
        window.kakao.maps.event.addListener(map, 'click', () => {
          if (activeOverlayRef.current) {
            activeOverlayRef.current.setMap(null);
            activeOverlayRef.current = null;
          }
          setActiveGroupId(null);
          setSelectedFacility(null);
        });
      });
    }
  };

  // Synchronize Markers (Filters & Facilities updates)
  useEffect(() => {
    if (!mapLoaded || !mapInstanceRef.current || facilities.length === 0) return;
    const kakao = window.kakao;

    // Clear old markers
    markersRef.current.forEach((m) => m.setMap(null));
    markersRef.current = [];

    // Map active filter label to DB type name
    const filterMap: Record<string, string> = {
      '식당': 'cafeteria',
      '주차장': 'parking',
      '회의실': 'meeting_room',
      '휴게실': 'rest_area'
    };
    const targetType = filterMap[activeFilter];

    const filtered = facilities.filter(f => f.type === targetType);

    // Optimize: Cap markers to top 100 highest TTTV score to prevent browser UI freezing
    const scoredFacilities = filtered.map(f => ({ ...f, tttv: calculateTTTV(f) }));
    scoredFacilities.sort(compareFacilities);
    const displayFacilities = scoredFacilities.slice(0, 100);

    // 마커 크기: 평소엔 작게, 선택 시엔 확대(뒤쪽 펄스/이펙트 없이 크기만 키움). 화면 폭에 따라 반응형.
    const isNarrow = typeof window !== 'undefined' && window.innerWidth < 640;
    const baseW = isNarrow ? 34 : 40;
    const baseH = isNarrow ? 44 : 51;
    const selW = isNarrow ? 48 : 58;
    const selH = isNarrow ? 62 : 74;

    const newMarkers = displayFacilities.map((f) => {
      // 사내 주차장은 정사각형 마커 → 정사각 크기 + 중앙 앵커(가로세로 비율 유지). 그 외 핀은 바닥(끝) 앵커.
      const isPriv = f.type === 'parking' && f.features && (f.features.is_private === true || f.features.is_public === false);
      // 그룹 마커는 activeGroupId 로, 개별 마커는 selectedFacility 로 선택 판정 → 둘 다 진한 색 + 확대
      const isSel = f.isGroup
        ? activeGroupId === f.id
        : (!!selectedFacility && f.id === selectedFacility.id);
      const w = isSel ? selW : baseW;
      const h = isSel ? selH : baseH;
      const markerImage = new kakao.maps.MarkerImage(
        getMarkerSvg(f.type, f.congestionLevel, f.features, isSel),
        isPriv ? new kakao.maps.Size(w, w) : new kakao.maps.Size(w, h),
        { offset: isPriv ? new kakao.maps.Point(w / 2, w / 2) : new kakao.maps.Point(w / 2, h) }
      );

      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(f.latitude, f.longitude),
        image: markerImage,
        title: f.name,
      });
      marker.setZIndex(isSel ? 100 : 1); // 선택된 마커를 위로

      kakao.maps.event.addListener(marker, "click", () => {
        console.log("Marker clicked:", f.name);
        
        if (activeOverlayRef.current) {
          activeOverlayRef.current.setMap(null);
          activeOverlayRef.current = null;
        }

        if (f.isGroup) {
          // 그룹 마커 자체를 하이라이트(확대+색) — 카드는 띄우지 않음(개별 선택 해제)
          setActiveGroupId(f.id);
          setSelectedFacility(null);
          const content = document.createElement('div');
          content.className = 'bg-[#111622]/95 backdrop-blur-xl border border-white/20 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 min-w-[180px] max-w-[280px] max-h-[260px] overflow-y-auto no-scrollbar pointer-events-auto';

          const titleEl = document.createElement('div');
          titleEl.className = 'text-[10px] text-blue-400 font-bold px-2 py-1 mb-1 border-b border-white/10 uppercase tracking-wider';
          titleEl.innerText = f.name;
          content.appendChild(titleEl);

          f.subFacilities.forEach((sub: any) => {
            const btn = document.createElement('button');
            btn.className = 'text-left text-white text-xs px-3 py-2.5 hover:bg-white/10 rounded-xl transition-colors font-semibold whitespace-normal break-keep leading-snug cursor-pointer';
            btn.innerText = sub.name;
            btn.onclick = () => {
              setActiveGroupId(null);
              setSelectedFacility(sub);
              setIsCardHidden(false);
              if (activeOverlayRef.current) {
                activeOverlayRef.current.setMap(null);
                activeOverlayRef.current = null;
              }
            };
            content.appendChild(btn);
          });

          const overlay = new window.kakao.maps.CustomOverlay({
            position: marker.getPosition(),
            content: content,
            yAnchor: 1.3,
            zIndex: 50,
            clickable: true // 팝업 내부 버튼 클릭이 지도로 새지 않게(목록 선택 시 하단 카드 표시)
          });
          
          overlay.setMap(mapInstanceRef.current);
          activeOverlayRef.current = overlay;
          mapInstanceRef.current.panTo(marker.getPosition());
        } else {
          setActiveGroupId(null);
          setSelectedFacility(f);
          setIsCardHidden(false);
          panToVisible(f.latitude, f.longitude);
        }
      });

      marker.setMap(mapInstanceRef.current);
      return marker;
    });

    markersRef.current = newMarkers;
    // selectedFacility 변경 시에도 재렌더해 선택 마커만 진한 색으로 갱신(기존 마커는 effect 시작부에서 정리)
  }, [facilities, activeFilter, mapLoaded, selectedFacility?.id, activeGroupId]);

  const filters = [
    { id: '식당', icon: Utensils },
    { id: '주차장', icon: ParkingCircle },
    { id: '회의실', icon: Building2 },
    { id: '휴게실', icon: Coffee },
  ];

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'Home') router.push('/main');
    if (tabId === 'Saved') router.push('/saved');
    if (tabId === 'MyPage') router.push('/mypage');
  };

  return (
    <div className="relative w-full h-screen overflow-hidden flex flex-col">

      {/* Map Container — 다크 필터는 globals.css 의 .map-dark-tiles 로 '타일 이미지(http)'에만 적용.
          마커/오버레이는 data: URI 이미지라 필터 제외 → 본래의 선명한 색으로 표시(필터 우회). */}
      <div
        ref={mapContainerRef}
        className="w-full h-full absolute inset-0 z-0 map-dark-tiles"
      />

      {/* Top Layer: Search & Filters */}
      <div className="absolute top-0 w-full z-20 pt-12 pb-4 px-4 bg-gradient-to-b from-black/80 to-transparent flex flex-col gap-4 pointer-events-none">
        
        {/* Search Bar */}
        <div className="flex items-center bg-[#131a28]/90 backdrop-blur-xl rounded-full px-4 py-3 border border-white/10 shadow-lg pointer-events-auto">
          <Search size={20} className="text-gray-400 mr-3" />
          <input 
            type="text" 
            placeholder="Search facilities, spots" 
            className="flex-1 bg-transparent text-white outline-none placeholder:text-gray-500 text-sm"
          />
          <Mic size={20} className="text-gray-400 ml-3" />
          <div className="w-8 h-8 rounded-full bg-blue-500/20 ml-4 flex items-center justify-center border border-blue-400/50">
            <User size={16} className="text-cyan-300" />
          </div>
        </div>

        {/* Filter Chips */}
        <div className="flex gap-3 overflow-x-auto no-scrollbar pointer-events-auto">
          {filters.map((filter) => {
            const Icon = filter.icon;
            const isActive = activeFilter === filter.id;
            return (
              <button
                key={filter.id}
                onClick={() => {
                  setActiveFilter(filter.id);
                  setIsCardHidden(false);
                  setActiveGroupId(null);
                  // 필터(섹션) 전환 시 열려있던 모둠 팝업도 닫기
                  if (activeOverlayRef.current) {
                    activeOverlayRef.current.setMap(null);
                    activeOverlayRef.current = null;
                  }
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('induspot_active_filter', filter.id);
                  }
                }}
                className={`flex shrink-0 items-center whitespace-nowrap rounded-full px-3 py-1.5 transition-all fractal-glass sm:px-4 sm:py-2 ${
                  isActive
                    ? 'bg-blue-600/30 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)] text-shadow-sm'
                    : 'border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={15} className={`mr-1.5 drop-shadow-md sm:mr-2 ${isActive ? 'text-blue-300' : 'text-gray-400'}`} />
                <span className={`text-[13px] font-medium sm:text-sm ${isActive ? 'text-shadow-sm' : ''}`}>{filter.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Recommendation Card (Floating Bottom Sheet) */}
      {selectedFacility && !isCardHidden && (() => {
        try {
          const targetType = selectedFacility.type;
          const activeCandidates = expandGroups(facilities.filter(f => f.type === targetType))
            .filter((f: any) => !rejectedIds.has(f.id));
          const activeScored = activeCandidates.map(f => ({
            ...f,
            tttv: calculateTTTV(f)
          })).sort(compareFacilities);
          
          const rankIndex = activeScored.findIndex(f => f.id === selectedFacility.id);
          const rank = rankIndex !== -1 ? rankIndex + 1 : undefined;
          const totalCandidates = activeScored.length;

          const tttv = selectedFacility.tttv || calculateTTTV(selectedFacility);
          // 사유: 자동 추천된 실 시설은 백엔드 Gemini 사유, 마커 직접 클릭/데모는 미러 사유로 폴백
          const reason = selectedFacility.reason || buildReason(selectedFacility, tttv);
          return (
            <div className="absolute bottom-[90px] w-full z-20 px-4 transition-all duration-300">
              <RecommendationCard
                title={selectedFacility.name}
                reason={reason}
                description={`실시간 혼잡도: ${selectedFacility.congestionLevel >= 0.75 ? '혼잡' : selectedFacility.congestionLevel >= 0.5 ? '보통' : selectedFacility.congestionLevel >= 0.25 ? '여유' : '한산'} · 수용현황: ${selectedFacility.currentCount}/${selectedFacility.capacity}명`}
                onAccept={() => handleAccept(selectedFacility)}
                onReject={() => handleReject(selectedFacility)}
                onPutOff={() => handlePutOff(selectedFacility)}
                onClose={() => setIsCardHidden(true)}
                tttvScore={tttv.score}
                preferencePercent={tttv.preferencePercent}
                expectedWait={tttv.expectedWait}
                expectedTravel={tttv.expectedTravel}
                timeToService={tttv.timeToService}
                facilityType={selectedFacility.type}
                facility={selectedFacility}
                rank={rank}
                totalCandidates={totalCandidates}
                mockHour={mockHour}
              />
            </div>
          );
        } catch (err) {
          console.error("Error rendering RecommendationCard IIFE:", err);
          return null;
        }
      })()}

      {/* Test Mock Sidebar (Right Side) */}
      <div className="absolute right-4 top-[170px] z-20 flex flex-col gap-3 pointer-events-auto">
        {/* Location Mock */}
        <div className="bg-[#111622]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg flex flex-col overflow-hidden transition-all duration-300">
          <div 
            className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors"
            onClick={() => setIsMockLocationMinimized(!isMockLocationMinimized)}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-cyan-400">📍</span>
              {!isMockLocationMinimized && (
                <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider">
                  위치 모킹
                </span>
              )}
            </div>
            {isMockLocationMinimized ? (
              <ChevronDown size={14} className="text-gray-400" />
            ) : (
              <ChevronUp size={14} className="text-gray-400 ml-2" />
            )}
          </div>
          
          {!isMockLocationMinimized && (
            <div className="px-3 pb-3 border-t border-white/5">
              <div className="grid grid-cols-2 gap-1.5 w-32 mt-2">
                {[
                  { id: 1, lat: 36.1220, lng: 128.3760 },
                  { id: 2, lat: 36.1193, lng: 128.3646 },
                  { id: 3, lat: 36.1100, lng: 128.3650 },
                  { id: 4, lat: 36.0920, lng: 128.3460 },
                  { id: 5, lat: 36.0857, lng: 128.3664 },
                  { id: 6, lat: 36.1080, lng: 128.3814 }
                ].map((loc) => {
                  const isCurrent = Math.abs(userLocation.lat - loc.lat) < 0.0001 && Math.abs(userLocation.lng - loc.lng) < 0.0001;
                  return (
                    <button
                      key={loc.id}
                      onClick={() => {
                        setUserLocation({ lat: loc.lat, lng: loc.lng });
                        if (mapInstanceRef.current) {
                          mapInstanceRef.current.setCenter(new window.kakao.maps.LatLng(loc.lat, loc.lng));
                        }
                        if (typeof window !== 'undefined') {
                          sessionStorage.removeItem('induspot_selected_facility_id');
                        }
                        showToast(`사용자 위치가 가상 ${loc.id}번 지점으로 설정되었습니다.`);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                        isCurrent
                          ? 'bg-blue-600 text-white border border-blue-400 shadow-md shadow-blue-500/25'
                          : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {loc.id}번
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Time Mock */}
        <div className="bg-[#111622]/90 backdrop-blur-xl border border-white/10 rounded-2xl shadow-lg flex flex-col overflow-hidden transition-all duration-300">
          <div 
            className="px-3 py-2 flex items-center justify-between cursor-pointer hover:bg-white/5 active:bg-white/10 transition-colors"
            onClick={() => setIsMockTimeMinimized(!isMockTimeMinimized)}
          >
            <div className="flex items-center gap-1.5">
              <span className="text-purple-400">🕒</span>
              {!isMockTimeMinimized && (
                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">
                  시간 모킹
                </span>
              )}
            </div>
            {isMockTimeMinimized ? (
              <ChevronDown size={14} className="text-gray-400" />
            ) : (
              <ChevronUp size={14} className="text-gray-400 ml-2" />
            )}
          </div>
          
          {!isMockTimeMinimized && (
            <div className="px-3 pb-3 border-t border-white/5">
              <div className="grid grid-cols-1 gap-1.5 w-32 mt-2">
                {[
                  { name: "현재 시간", value: null },
                  { name: "점심 피크", value: 12.5 },
                  { name: "저녁 피크", value: 18.5 }
                ].map((timeOption) => {
                  const isCurrent = mockHour === timeOption.value;
                  return (
                    <button
                      key={timeOption.name}
                      onClick={() => {
                        setMockHour(timeOption.value);
                        showToast(`가상 시간이 '${timeOption.name}'(으)로 설정되었습니다.`);
                      }}
                      className={`py-1.5 px-2 rounded-lg text-xs font-bold transition-all ${
                        isCurrent
                          ? 'bg-purple-600 text-white border border-purple-400 shadow-md shadow-purple-500/25'
                          : 'bg-white/5 border border-white/10 text-gray-300 hover:bg-white/10'
                      }`}
                    >
                      {timeOption.name}
                    </button>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Restore Card Trigger Button when hidden */}
      {selectedFacility && isCardHidden && (
        <div className="absolute bottom-[160px] right-4 z-20">
          <button
            onClick={() => setIsCardHidden(false)}
            className="flex items-center gap-2 px-4 py-3 bg-[#111622]/90 hover:bg-[#1b2336] text-white border border-blue-500/30 hover:border-blue-400 rounded-full font-bold text-xs shadow-lg shadow-blue-500/10 active:scale-95 transition-all pointer-events-auto"
          >
            <Sparkles size={14} className="text-cyan-400 animate-pulse" />
            <span>AI 추천 열기</span>
          </button>
        </div>
      )}

      {/* Bottom Navigation Bar */}
      <div className="absolute bottom-0 w-full z-30 bg-[#0b101e]/90 backdrop-blur-xl border-t border-white/10 px-6 py-4 pb-8 flex justify-around items-center">
        {[
          { id: 'Home', icon: Home, label: 'Home' },
          { id: 'Saved', icon: Bookmark, label: 'Saved' },
          { id: 'MyPage', icon: User, label: 'My Page' }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-[#104bce]' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              <div className={`p-2 rounded-xl mb-1 ${isActive ? 'bg-[#104bce]/10' : ''}`}>
                <Icon size={24} className={isActive ? 'text-[#104bce]' : 'text-gray-500'} />
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-[#104bce]' : ''}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-[350px] left-0 right-0 z-50 pointer-events-none flex justify-center px-4 animate-toast">
          <div className="bg-black/85 backdrop-blur-md text-white text-xs sm:text-sm px-5 py-3 rounded-full shadow-lg text-center font-medium break-keep max-w-[90vw]">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  );
}
