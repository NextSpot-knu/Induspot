'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Home, Bookmark, User, Search, Mic, Utensils, ParkingCircle, Building2, Coffee, Sparkles } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';
import { createPublicClient } from '@/lib/supabase';

const supabase = createPublicClient();

declare global {
  interface Window {
    kakao: any;
  }
}

// Marker SVG Generator
const getMarkerSvg = (type: string, level: number, features?: any) => {
  let color = "#10b981"; // green (여유)
  if (level >= 0.7) {
    color = "#ef4444"; // red (혼잡)
  } else if (level >= 0.3) {
    color = "#f59e0b"; // yellow (보통)
  }

  let emoji = "📍";
  if (type === "cafeteria") emoji = "🍴";
  else if (type === "parking") emoji = "🚗";
  else if (type === "meeting_room") emoji = "🤝";
  else if (type === "loading_dock") emoji = "🚚";

  const isPrivateParking = type === "parking" && features && (features.is_private === true || features.is_public === false);

  if (isPrivateParking) {
    emoji = "🏢"; // 사내 주차장 이모지
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="23" viewBox="0 0 36 46">
        <path fill="${color}" stroke="%23ffffff" stroke-width="2" d="M6 2h24a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4h-9l-3 12-3-12H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"/>
        <circle cx="18" cy="17" r="11" fill="%23ffffff"/>
        <text x="18" y="21" font-size="12" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="23" viewBox="0 0 36 46">
      <path fill="${color}" stroke="%23ffffff" stroke-width="2" d="M18 0C8.1 0 0 8.1 0 18c0 13.5 16.5 26.5 17.1 27.1a1.2 1.2 0 0 0 1.8 0c.6-.6 17.1-13.6 17.1-27.1C36 8.1 27.9 0 18 0z"/>
      <circle cx="18" cy="18" r="11" fill="%23ffffff"/>
      <text x="18" y="22" font-size="12" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};

export default function MainPage() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<any>(null);
  const markersRef = useRef<any[]>([]);
  const userMarkerRef = useRef<any>(null);

  const [activeTab, setActiveTab] = useState('Home');
  const [activeFilter, setActiveFilter] = useState('주차장');
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);
  const [isCardHidden, setIsCardHidden] = useState(false);
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
        // Fetch all facilities using pagination
        let facilitiesData: any[] = [];
        let fromFac = 0;
        const limit = 1000;
        while (true) {
          const { data, error } = await supabase
            .from("facilities")
            .select("id, name, type, latitude, longitude, capacity, operating_hours, features")
            .range(fromFac, fromFac + limit - 1);
          if (error) {
            console.warn("Failed to load facilities:", error);
            return;
          }
          if (!data || data.length === 0) break;
          facilitiesData = [...facilitiesData, ...data];
          if (data.length < limit) break;
          fromFac += limit;
        }

        // Fetch all logs using pagination
        let logs: any[] = [];
        let fromLogs = 0;
        while (true) {
          const { data, error } = await supabase
            .from("congestion_logs")
            .select("facility_id, congestion_level, current_count, timestamp")
            .order("timestamp", { ascending: false })
            .range(fromLogs, fromLogs + limit - 1);
          if (error) {
            console.warn("Failed to load congestion logs:", error);
            break;
          }
          if (!data || data.length === 0) break;
          logs = [...logs, ...data];
          if (data.length < limit) break;
          fromLogs += limit;
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
          return {
            id: f.id,
            name: f.name,
            type: f.type,
            latitude: f.latitude,
            longitude: f.longitude,
            capacity: f.capacity,
            features: f.features,
            congestionLevel: latestLog ? latestLog.congestion_level : 0.0,
            currentCount: latestLog ? latestLog.current_count : 0,
            lastUpdated: latestLog ? latestLog.timestamp : new Date().toISOString(),
          };
        });

        setFacilities(mapped);
      } catch (err) {
        console.error("Error loading facilities:", err);
      }
    }

    loadFacilities();
  }, []);

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

    const userSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="30" height="30" viewBox="0 0 30 30">
        <circle cx="15" cy="15" r="12" fill="%233b82f6" fill-opacity="0.25" stroke="%233b82f6" stroke-width="2"/>
        <circle cx="15" cy="15" r="6" fill="%233b82f6" stroke="%23ffffff" stroke-width="2"/>
      </svg>
    `;
    const userImage = new kakao.maps.MarkerImage(
      `data:image/svg+xml;charset=utf-8,${encodeURIComponent(userSvg.trim())}`,
      new kakao.maps.Size(30, 30),
      { offset: new kakao.maps.Point(15, 15) }
    );

    const userMarker = new kakao.maps.Marker({
      position: new kakao.maps.LatLng(userLocation.lat, userLocation.lng),
      image: userImage,
      zIndex: 10,
    });

    userMarker.setMap(mapInstanceRef.current);
    userMarkerRef.current = userMarker;
  }, [userLocation, mapLoaded]);

  // Save selected facility ID to sessionStorage
  useEffect(() => {
    if (typeof window !== 'undefined') {
      if (selectedFacility) {
        sessionStorage.setItem('induspot_selected_facility_id', selectedFacility.id);
      } else {
        sessionStorage.removeItem('induspot_selected_facility_id');
      }
    }
  }, [selectedFacility]);

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
    loading_dock: [0.0, 0.0, 0.0, 1.0, 0.0, 0.2, 0.0, 0.0]
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
      loading_dock: 30
    };
    const avgProcessTime = facility.features?.average_processing_time ?? defaultTimes[facility.type] ?? 15;
    const hour = new Date().getHours();
    let timeMultiplier = 1.0;
    if (hour >= 12 && hour < 14) timeMultiplier = 1.3;
    else if (hour === 7 || hour === 15) timeMultiplier = 1.2;

    const expectedWait = facility.congestionLevel * avgProcessTime * timeMultiplier;

    // 3. Expected Travel
    const distanceM = calculateHaversineDistance(userLocation.lat, userLocation.lng, facility.latitude, facility.longitude);
    const expectedTravel = distanceM / 66.67;

    // 4. TTTV Score (황금비: 0.45 : 0.25 : 0.30) 및 Min-Max 정규화 적용
    const w1 = 0.45, w2 = 0.25, w3 = 0.30;
    const timeCost = Math.min(1.0, (expectedWait + expectedTravel) / 60.0);
    const incentive = Math.max(0, 0.7 - facility.congestionLevel);
    const score = (w1 * preferenceMatching) - (w2 * timeCost) + (w3 * incentive);
    
    // 시간비용 감산 패널티로 인한 점수 하향 왜곡 방지를 위해 Min-Max 정규화 적용
    const normalized = (score + w2) / (w1 + w2 + w3);
    const finalScore = Math.max(0, Math.min(1, normalized));

    return {
      score: Math.round(finalScore * 100),
      preferencePercent: Math.round(preferenceMatching * 100),
      expectedWait: Math.round(expectedWait * 10) / 10,
      expectedTravel: Math.round(expectedTravel * 10) / 10,
      timeToService: Math.round((expectedWait + expectedTravel) * 10) / 10
    };
  };

  // Synchronize AI recommendations on map and set selected facility to the top recommended spot
  useEffect(() => {
    if (facilities.length === 0) return;

    const filterMap: Record<string, string> = {
      '식당': 'cafeteria',
      '주차장': 'parking',
      '회의실': 'meeting_room',
      '휴게실': 'loading_dock'
    };
    const targetType = filterMap[activeFilter];
    
    // Filter facilities of active type, excluding rejected and saved ones
    const candidates = facilities.filter(f => f.type === targetType && !rejectedIds.has(f.id) && !savedIds.has(f.id));
    
    if (candidates.length > 0) {
      // Calculate TTTV and sort
      const scored = candidates.map(f => ({
        ...f,
        tttv: calculateTTTV(f)
      }));
      scored.sort((a, b) => b.tttv.score - a.tttv.score);
      
      // Try to restore previous selection if it is still a valid candidate
      let restoredFacility = null;
      if (typeof window !== 'undefined') {
        const savedId = sessionStorage.getItem('induspot_selected_facility_id');
        if (savedId) {
          restoredFacility = scored.find(f => f.id === savedId);
        }
      }

      if (restoredFacility) {
        setSelectedFacility(restoredFacility);
      } else {
        setSelectedFacility(scored[0]);
      }
    } else {
      setSelectedFacility(null);
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
          trafficStatus: fac.congestionLevel >= 0.7 ? 'red' : fac.congestionLevel >= 0.3 ? 'yellow' : 'green',
          waitTime: `${tttv?.expectedWait || 0}분`
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
    
    setRejectedIds(prev => {
      const next = new Set(prev);
      next.add(fac.id);
      if (typeof window !== 'undefined') {
        sessionStorage.setItem('induspot_rejected_ids', JSON.stringify(Array.from(next)));
      }
      return next;
    });
    
    showToast(`'${fac.name}' 추천을 폐기했습니다. 다음 추천을 불러옵니다.`);
  };

  // Initialize map if Kakao Maps script is already loaded (e.g. after navigating back from MyPage)
  useEffect(() => {
    if (typeof window !== "undefined" && window.kakao && window.kakao.maps) {
      initMap();
    }
  }, []);

  // Initialize Kakao Map
  const initMap = () => {
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
      '휴게실': 'loading_dock'
    };
    const targetType = filterMap[activeFilter];

    const filtered = facilities.filter(f => f.type === targetType);

    const newMarkers = filtered.map((f) => {
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
        setSelectedFacility(f);
        setIsCardHidden(false);
        mapInstanceRef.current.panTo(new kakao.maps.LatLng(f.latitude, f.longitude));
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
    <div className="relative w-full h-screen overflow-hidden bg-black flex flex-col">
      {/* Kakao Map API Script */}
      {appKey && (
        <Script
          src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&autoload=false`}
          strategy="afterInteractive"
          onLoad={initMap}
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
                  if (typeof window !== 'undefined') {
                    sessionStorage.setItem('induspot_active_filter', filter.id);
                  }
                }}
                className={`flex items-center px-4 py-2 rounded-full border backdrop-blur-md whitespace-nowrap transition-all ${
                  isActive 
                    ? 'bg-blue-600/30 border-blue-400 text-white' 
                    : 'bg-[#131a28]/80 border-white/10 text-gray-400 hover:bg-white/10'
                }`}
              >
                <Icon size={16} className={`mr-2 ${isActive ? 'text-blue-300' : 'text-gray-400'}`} />
                <span className="text-sm font-medium">{filter.id}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* AI Recommendation Card (Floating Bottom Sheet) */}
      {selectedFacility && !isCardHidden && (() => {
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
            />
          </div>
        );
      })()}

      {/* Test Mock Locations Sidebar (Right Side) */}
      <div className="absolute right-4 top-[170px] z-20 flex flex-col gap-2 pointer-events-auto">
        <div className="bg-[#111622]/90 backdrop-blur-xl border border-white/10 rounded-2xl p-3 shadow-lg flex flex-col gap-2">
          <span className="text-[10px] text-cyan-400 font-bold uppercase tracking-wider text-center">
            📍 테스트 위치 모킹
          </span>
          <div className="grid grid-cols-2 gap-1.5 w-32">
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
        <div className="fixed bottom-[350px] left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full max-w-sm px-4 animate-toast">
          <div className="bg-black/85 backdrop-blur-md text-white text-xs sm:text-sm px-5 py-3 rounded-full shadow-lg text-center font-medium break-keep">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  );
}
