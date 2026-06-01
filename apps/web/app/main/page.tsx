'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Home, Bookmark, User, Search, Mic, Utensils, ParkingCircle, Building2, Coffee, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';
import { createPublicClient } from '@/lib/supabase';
import { getMarkerSvg } from '@/lib/utils';

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
        
        // 새로고침마다 값이 흔들리지 않도록 인덱스 시드 기반 의사난수 사용(Math.random 제거)
        const seededRand = (n: number) => { const x = Math.sin(n * 12.9898) * 43758.5453; return x - Math.floor(x); };

        const dummyLoungesSub = Array.from({length: 5}).map((_, i) => ({
           id: `dummy-lounge-${i}`,
           name: `사내 휴게실 ${i+1}`,
           type: 'rest_area',
           capacity: 10,
           congestionLevel: seededRand(i + 1),
           currentCount: Math.floor(seededRand(i + 1) * 10),
           features: {
             massageChairs: { total: 3, inUse: Math.floor(seededRand(i + 11) * 4) },
             sleepCapsules: { total: 2, inUse: Math.floor(seededRand(i + 21) * 3) },
             playstation: { total: 1, inUse: Math.floor(seededRand(i + 31) * 2) }
           }
        }));

        const dummyLoungeGroup = {
           id: `dummy-lounge-group`,
           name: `사내 휴게실 모음`,
           type: 'rest_area',
           latitude: companyLat,
           longitude: companyLng,
           congestionLevel: dummyLoungesSub.reduce((acc, curr) => acc + curr.congestionLevel, 0) / 5,
           isGroup: true,
           subFacilities: dummyLoungesSub
        };
        
        const dummyMeetingsInsideSub = Array.from({length: 8}).map((_, i) => ({
           id: `dummy-meeting-in-${i}`,
           name: `사내 회의실 ${i+1}호`,
           type: 'meeting_room',
           capacity: 8,
           congestionLevel: seededRand(i + 41),
           currentCount: Math.floor(seededRand(i + 41) * 8),
           features: {
             remainingMinutes: Math.floor(seededRand(i + 51) * 60)
           }
        }));

        const dummyMeetingGroup = {
           id: `dummy-meeting-group`,
           name: `사내 회의실 모음`,
           type: 'meeting_room',
           latitude: companyLat,
           longitude: companyLng,
           congestionLevel: dummyMeetingsInsideSub.reduce((acc, curr) => acc + curr.congestionLevel, 0) / 8,
           isGroup: true,
           subFacilities: dummyMeetingsInsideSub
        };

        const dummyMeetingsOutside = Array.from({length: 2}).map((_, i) => ({
           id: `dummy-meeting-out-${i}`,
           name: `외부 공유오피스 회의실 ${['A','B'][i]}`,
           type: 'meeting_room',
           latitude: companyLat + (i === 0 ? 0.006 : -0.006) + (seededRand(i + 61) * 0.001),
           longitude: companyLng - 0.02 + (seededRand(i + 71) * 0.005),
           capacity: 12,
           congestionLevel: seededRand(i + 81),
           currentCount: Math.floor(seededRand(i + 81) * 12),
           features: {
             remainingMinutes: Math.floor(seededRand(i + 91) * 60)
           }
        }));

        // 실데이터에 해당 타입이 있으면 더미를 합치지 않는다(실시간 추천/지도 오염 방지).
        const hasRealRest = mapped.some((m: any) => m.type === 'rest_area');
        const hasRealMeeting = mapped.some((m: any) => m.type === 'meeting_room');
        const finalFacilities = [
          ...mapped,
          ...(hasRealRest ? [] : [dummyLoungeGroup]),
          ...(hasRealMeeting ? [] : [dummyMeetingGroup, ...dummyMeetingsOutside]),
        ];
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
      <div style="position: relative; width: 100px; height: 100px; pointer-events: none; filter: invert(100%) hue-rotate(180deg) brightness(120%) contrast(110%);">
        <!-- Glow -->
        <div style="position: absolute; top: 0; left: 0; right: 0; bottom: 0; border-radius: 50%; background: radial-gradient(circle, rgba(255,255,0,0.8) 0%, rgba(255,255,0,0.4) 40%, rgba(255,255,0,0) 80%); animation: pulse-user-marker 2.5s infinite cubic-bezier(0.2, 0, 0.2, 1);"></div>
        <!-- Border -->
        <div style="position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; margin-top: -14px; margin-left: -14px; background: #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(255,255,0,0.5);"></div>
        <!-- Core -->
        <div style="position: absolute; top: 50%; left: 50%; width: 20px; height: 20px; margin-top: -10px; margin-left: -10px; background: #ffff00; border-radius: 50%;"></div>
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

  const CATEGORY_VECTORS: Record<string, number[]> = {
    cafeteria: [1.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.0, 0.0],
    parking: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.1],
    meeting_room: [0.0, 0.0, 1.0, 0.0, 0.1, 0.0, 0.0, 0.2],
    rest_area: [0.0, 0.0, 0.0, 1.0, 0.0, 0.2, 0.0, 0.0]
  };

  const calculateHaversineDistance = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng / 2) * Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    return R * c;
  };

  const calculateTTTV = (facility: any) => {
    if (!facility) return { score: 0, preferencePercent: 0, expectedWait: 0, expectedTravel: 0, timeToService: 0 };
    
    // 1. Cosine similarity
    const userVec = [0, 0, 0, 0, 0, 0, 0, 0];
    let count = 0;
    const cats = preferredCategories.length > 0 ? preferredCategories : Object.keys(CATEGORY_VECTORS);
    cats.forEach(c => {
      if (CATEGORY_VECTORS[c]) {
        for (let i = 0; i < 8; i++) {
          userVec[i] += CATEGORY_VECTORS[c][i];
        }
        count++;
      }
    });
    const normalizedUserVec = count > 0 ? userVec.map(v => v / count) : [1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8), 1/Math.sqrt(8)];
    let userNorm = Math.sqrt(normalizedUserVec.reduce((sum, v) => sum + v*v, 0));
    const userVecFinal = normalizedUserVec.map(v => userNorm > 0 ? v / userNorm : v);

    let facVec = [...(CATEGORY_VECTORS[facility.type] || [0,0,0,0,0,0,0,0])];
    if (facility.features) {
      if (facility.features.has_ev_charger && facility.type === 'parking') {
        facVec[6] += 0.3;
      }
      if (facility.features.has_vegetarian && facility.type === 'cafeteria') {
        facVec[4] += 0.2;
      }
    }
    let facNorm = Math.sqrt(facVec.reduce((sum, v) => sum + v*v, 0));
    const facVecFinal = facVec.map(v => facNorm > 0 ? v / facNorm : v);

    let preferenceMatching = 0;
    for (let i = 0; i < 8; i++) {
      preferenceMatching += userVecFinal[i] * facVecFinal[i];
    }
    preferenceMatching = Math.max(0, Math.min(1, preferenceMatching));

    // 2. Expected Wait
    const defaultTimes: Record<string, number> = {
      cafeteria: 20,
      parking: 5,
      meeting_room: 10,
      rest_area: 10
    };
    const avgProcessTime = facility.features?.average_processing_time ?? defaultTimes[facility.type] ?? 15;
    const hour = mockHour !== null ? mockHour : new Date().getHours();
    let timeMultiplier = 1.0;
    if (hour >= 12 && hour < 14) timeMultiplier = 1.3;
    else if (hour === 7 || hour === 15) timeMultiplier = 1.2;

    const expectedWait = (facility.congestionLevel ?? 0) * avgProcessTime * timeMultiplier;

    // 3. Expected Travel
    const fLat = typeof facility.latitude === 'number' ? facility.latitude : userLocation.lat;
    const fLng = typeof facility.longitude === 'number' ? facility.longitude : userLocation.lng;
    const distanceM = calculateHaversineDistance(userLocation.lat, userLocation.lng, fLat, fLng);
    const expectedTravel = distanceM / 66.67;

    // 4. TTTV Score — 백엔드 score.py 스펙과 동일 매핑 (선호 0.45 : 시간비용 0.25 : 분산인센티브 0.30)
    //    값 집합은 동일하되 w2(시간비용)/w3(분산)을 백엔드와 일치시켜 프런트 미리보기 랭킹의 드리프트 제거.
    const w1 = 0.45, w2 = 0.25, w3 = 0.30;
    const timeCost = Math.min(1.0, (expectedWait + expectedTravel) / 60.0);
    const incentive = Math.max(0, 0.7 - (facility.congestionLevel ?? 0));
    const score = (w1 * preferenceMatching) - (w2 * timeCost) + (w3 * incentive);
    
    // 시간비용 감산 패널티로 인한 점수 하향 왜곡 방지를 위해 Min-Max 정규화 적용
    const normalized = (score + w2) / (w1 + w2 + w3);
    const finalScore = Math.max(0, Math.min(1, normalized));

    return {
      score: isNaN(finalScore) ? 0 : Math.round(finalScore * 100),
      preferencePercent: isNaN(preferenceMatching) ? 0 : Math.round(preferenceMatching * 100),
      expectedWait: isNaN(expectedWait) ? 0 : Math.round(expectedWait * 10) / 10,
      expectedTravel: isNaN(expectedTravel) ? 0 : Math.round(expectedTravel * 10) / 10,
      timeToService: isNaN(expectedWait + expectedTravel) ? 0 : Math.round((expectedWait + expectedTravel) * 10) / 10
    };
  };

  const compareFacilities = (a: any, b: any) => {
    if (b.tttv.score !== a.tttv.score) return b.tttv.score - a.tttv.score; // 1. 높은 점수
    if (a.tttv.timeToService !== b.tttv.timeToService) return a.tttv.timeToService - b.tttv.timeToService; // 2. 짧은 총 소요시간
    if (b.tttv.preferencePercent !== a.tttv.preferencePercent) return b.tttv.preferencePercent - a.tttv.preferencePercent; // 3. 높은 선호도
    if (a.tttv.expectedTravel !== b.tttv.expectedTravel) return a.tttv.expectedTravel - b.tttv.expectedTravel; // 4. 짧은 이동시간
    return (a.name || '').localeCompare(b.name || '', 'ko-KR'); // 5. 이름 가나다순
  };

  // Synchronize AI recommendations: always show the #1 scored candidate for the active filter.
  // Runs whenever facilities, filter, rejected/saved sets, location, or preferences change.
  useEffect(() => {
    try {
      if (facilities.length === 0) return;

      const filterMap: Record<string, string> = {
        '식당': 'cafeteria',
        '주차장': 'parking',
        '회의실': 'meeting_room',
        '휴게실': 'rest_area'
      };
      const targetType = filterMap[activeFilter];

      // Candidates: active filter type, not rejected, not saved/put-off
      let candidates = facilities.filter(
        f => f.type === targetType && !rejectedIds.has(f.id) && !savedIds.has(f.id)
      );

      // If all candidates are exhausted (e.g. during heavy testing), loop back to all available
      if (candidates.length === 0) {
        candidates = facilities.filter(f => f.type === targetType);
      }

      if (candidates.length > 0) {
        const scored = candidates.map(f => ({ ...f, tttv: calculateTTTV(f) }));
        scored.sort(compareFacilities);
        // Always show #1 automatically – guarantees card opens on page load and after any action
        setSelectedFacility(scored[0]);
        setIsCardHidden(false);
        if (mapInstanceRef.current) {
          mapInstanceRef.current.panTo(new window.kakao.maps.LatLng(scored[0].latitude, scored[0].longitude));
        }
      } else {
        setSelectedFacility(null);
      }
    } catch (err) {
      console.error("Error in recommendation synchronization effect:", err);
    }
  }, [facilities, activeFilter, rejectedIds, savedIds, userLocation, preferredCategories]);

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
      
      const restApiKey = process.env.NEXT_PUBLIC_KAKAO_REST_API_KEY;
      if (!restApiKey) {
        // 키 미설정 시 transcoord 호출을 건너뛰고 좌표 기반 길안내 URL로 바로 이동(키를 소스에 박지 않음)
        const destUrl = `https://map.kakao.com/?sName=${encodeURIComponent("현재 위치")}&eName=${encodeURIComponent(fac.name)}&sY=${userLocation.lat}&sX=${userLocation.lng}&eY=${fac.latitude}&eX=${fac.longitude}`;
        if (newWindow) newWindow.location.href = destUrl;
        return;
      }
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
    let nextCandidates = facilities.filter(f =>
      f.type === targetType && !rejectedIds.has(f.id) && !nextSavedIds.has(f.id)
    );
    
    // Loop back if all exhausted
    if (nextCandidates.length === 0) {
      nextCandidates = facilities.filter(f => f.type === targetType);
    }

    if (nextCandidates.length > 0) {
      const nextScored = nextCandidates.map(f => ({ ...f, tttv: calculateTTTV(f) }));
      nextScored.sort(compareFacilities);
      setSelectedFacility(nextScored[0]);
      setIsCardHidden(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo(new window.kakao.maps.LatLng(nextScored[0].latitude, nextScored[0].longitude));
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
      
      const tttv = calculateTTTV(fac);
      if (!bookmarks.some((b: any) => b.id === fac.id)) {
        bookmarks.push({
          id: fac.id,
          name: fac.name,
          category: fac.type === 'cafeteria' ? '식당' : fac.type === 'parking' ? '주차장' : fac.type === 'meeting_room' ? '회의실' : '휴게실',
          trafficStatus: fac.congestionLevel >= 0.75 ? 'orange' : fac.congestionLevel >= 0.50 ? 'yellow' : fac.congestionLevel >= 0.25 ? 'green' : 'blue',
          waitTime: `${tttv?.expectedWait || 0}분`,
          tttv: tttv,
          // 길찾기/주차 표시를 위해 좌표·타입·수용현황을 함께 저장(좌표 없는 더미는 undefined → saved 가 키워드검색 폴백)
          latitude: fac.latitude,
          longitude: fac.longitude,
          type: fac.type,
          capacity: fac.capacity,
          currentCount: fac.currentCount,
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
    let nextCandidates = facilities.filter(f =>
      f.type === targetType && !nextRejectedIds.has(f.id) && !savedIds.has(f.id)
    );
    
    // Loop back if all exhausted
    if (nextCandidates.length === 0) {
      nextCandidates = facilities.filter(f => f.type === targetType);
    }

    if (nextCandidates.length > 0) {
      const nextScored = nextCandidates.map(f => ({ ...f, tttv: calculateTTTV(f) }));
      nextScored.sort(compareFacilities);
      setSelectedFacility(nextScored[0]);
      setIsCardHidden(false);
      if (mapInstanceRef.current) {
        mapInstanceRef.current.panTo(new window.kakao.maps.LatLng(nextScored[0].latitude, nextScored[0].longitude));
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

  // initMap is now triggered by the Next.js Script's onReady

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
            centerLat = parseFloat(savedLat);
            centerLng = parseFloat(savedLng);
          }
          if (savedLevel) {
            level = parseInt(savedLevel, 10);
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

    const newMarkers = displayFacilities.map((f) => {
      const markerImage = new kakao.maps.MarkerImage(
        getMarkerSvg(f.type, f.congestionLevel, f.features),
        new kakao.maps.Size(18, 23),
        { offset: new kakao.maps.Point(9, 23) }
      );

      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(f.latitude, f.longitude),
        image: markerImage,
        title: f.name,
      });

      kakao.maps.event.addListener(marker, "click", () => {
        console.log("Marker clicked:", f.name);
        
        if (activeOverlayRef.current) {
          activeOverlayRef.current.setMap(null);
          activeOverlayRef.current = null;
        }

        if (f.isGroup) {
          const content = document.createElement('div');
          content.className = 'bg-[#111622]/95 backdrop-blur-xl border border-white/20 rounded-2xl p-2 shadow-2xl flex flex-col gap-1 min-w-[160px] max-h-[250px] overflow-y-auto pointer-events-auto';
          
          const titleEl = document.createElement('div');
          titleEl.className = 'text-[10px] text-blue-400 font-bold px-2 py-1 mb-1 border-b border-white/10 uppercase tracking-wider';
          titleEl.innerText = f.name;
          content.appendChild(titleEl);

          f.subFacilities.forEach((sub: any) => {
            const btn = document.createElement('button');
            btn.className = 'text-left text-white text-xs px-3 py-2.5 hover:bg-white/10 rounded-xl transition-colors font-semibold truncate cursor-pointer';
            btn.innerText = sub.name;
            btn.onclick = () => {
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
            zIndex: 50
          });
          
          overlay.setMap(mapInstanceRef.current);
          activeOverlayRef.current = overlay;
          mapInstanceRef.current.panTo(marker.getPosition());
        } else {
          setSelectedFacility(f);
          setIsCardHidden(false);
          mapInstanceRef.current.panTo(new kakao.maps.LatLng(f.latitude, f.longitude));
        }
      });

      marker.setMap(mapInstanceRef.current);
      return marker;
    });

    markersRef.current = newMarkers;
  }, [facilities, activeFilter, mapLoaded]);

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
      {/* Kakao Map API Script */}
      {appKey && (
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false&libraries=services,clusterer`}
          strategy="afterInteractive"
          onReady={initMap}
        />
      )}

      {/* Map Container */}
      <div 
        ref={mapContainerRef} 
        className="w-full h-full absolute inset-0 z-0"
        style={{ 
          filter: 'invert(90%) hue-rotate(180deg) brightness(80%) contrast(120%) grayscale(20%)' 
        }}
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
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('induspot_active_filter', filter.id);
                  }
                }}
                className={`flex items-center px-4 py-2 rounded-full transition-all fractal-glass ${
                  isActive 
                    ? 'bg-blue-600/30 border-blue-400 text-white shadow-[0_0_15px_rgba(59,130,246,0.3)] text-shadow-sm' 
                    : 'border-white/10 text-gray-400 hover:bg-white/10 hover:text-white'
                }`}
              >
                <Icon size={16} className={`mr-2 drop-shadow-md ${isActive ? 'text-blue-300' : 'text-gray-400'}`} />
                <span className={`text-sm font-medium ${isActive ? 'text-shadow-sm' : ''}`}>{filter.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Recommendation Card (Floating Bottom Sheet) */}
      {selectedFacility && !isCardHidden && (() => {
        try {
          const targetType = selectedFacility.type;
          const activeCandidates = facilities.filter(f => f.type === targetType && !rejectedIds.has(f.id));
          const activeScored = activeCandidates.map(f => ({
            ...f,
            tttv: calculateTTTV(f)
          })).sort(compareFacilities);
          
          const rankIndex = activeScored.findIndex(f => f.id === selectedFacility.id);
          const rank = rankIndex !== -1 ? rankIndex + 1 : undefined;
          const totalCandidates = activeScored.length;

          const tttv = selectedFacility.tttv || calculateTTTV(selectedFacility);
          return (
            <div className="absolute bottom-[90px] w-full z-20 px-4 transition-all duration-300">
              <RecommendationCard 
                title={selectedFacility.name}
                description={`실시간 혼잡도: ${selectedFacility.congestionLevel >= 0.7 ? '혼잡' : selectedFacility.congestionLevel >= 0.3 ? '보통' : '여유'} · 수용현황: ${selectedFacility.currentCount}/${selectedFacility.capacity}명`}
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
