'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Home, Bookmark, User, Search, Mic, Utensils, ParkingCircle, Building2, Coffee } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';
import { createPublicClient } from '@/lib/supabase';

const supabase = createPublicClient();

declare global {
  interface Window {
    kakao: any;
  }
}

// Marker SVG Generator
const getMarkerSvg = (type: string, level: number) => {
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

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
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

  const [activeTab, setActiveTab] = useState('Home');
  const [activeFilter, setActiveFilter] = useState('주차장');
  const [facilities, setFacilities] = useState<any[]>([]);
  const [selectedFacility, setSelectedFacility] = useState<any>(null);
  const [mapLoaded, setMapLoaded] = useState(false);

  const router = useRouter();

  const appKey = process.env.NEXT_PUBLIC_KAKAO_API_KEY || process.env.NEXT_PUBLIC_KAKAO_MAP_KEY;

  // Load facilities from Supabase
  useEffect(() => {
    async function loadFacilities() {
      try {
        const { data: facilitiesData, error: fErr } = await supabase
          .from("facilities")
          .select("id, name, type, latitude, longitude, capacity, operating_hours, features");
        
        if (fErr || !facilitiesData) {
          console.warn("Failed to load facilities:", fErr);
          return;
        }

        const { data: logs } = await supabase
          .from("congestion_logs")
          .select("facility_id, congestion_level, current_count, timestamp")
          .order("timestamp", { ascending: false });

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
            congestionLevel: latestLog ? latestLog.congestion_level : 0.0,
            currentCount: latestLog ? latestLog.current_count : 0,
            lastUpdated: latestLog ? latestLog.timestamp : new Date().toISOString(),
          };
        });

        setFacilities(mapped);
        if (mapped.length > 0) {
          // Initialize with first parking spot or cafeteria
          const parkings = mapped.filter(x => x.type === 'parking');
          setSelectedFacility(parkings.length > 0 ? parkings[0] : mapped[0]);
        }
      } catch (err) {
        console.error("Error loading facilities:", err);
      }
    }

    loadFacilities();
  }, []);

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
        const options = {
          center: new window.kakao.maps.LatLng(37.3200, 126.8120), // Ansan Complex Center
          level: 4,
        };
        const map = new window.kakao.maps.Map(mapContainerRef.current, options);
        mapInstanceRef.current = map;
        setMapLoaded(true);
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
    
    // Automatically select the first facility of the active filter
    if (filtered.length > 0) {
      setSelectedFacility(filtered[0]);
    }

    const newMarkers = filtered.map((f) => {
      const markerImage = new kakao.maps.MarkerImage(
        getMarkerSvg(f.type, f.congestionLevel),
        new kakao.maps.Size(36, 46),
        { offset: new kakao.maps.Point(18, 46) }
      );

      const marker = new kakao.maps.Marker({
        position: new kakao.maps.LatLng(f.latitude, f.longitude),
        image: markerImage,
        title: f.name,
      });

      kakao.maps.event.addListener(marker, "click", () => {
        console.log("Marker clicked:", f.name);
        setSelectedFacility(f);
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
                onClick={() => setActiveFilter(filter.id)}
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
      {selectedFacility && (
        <div className="absolute bottom-[90px] w-full z-20 px-4">
          <RecommendationCard 
            title={selectedFacility.name}
            matchPercentage={Math.max(10, Math.min(100, Math.round((1 - selectedFacility.congestionLevel) * 100)))}
            description={`실시간 혼잡도: ${selectedFacility.congestionLevel >= 0.7 ? '혼잡 (이용 자제 권장)' : selectedFacility.congestionLevel >= 0.3 ? '보통' : '여유 (추천)'} · 수용현황: ${selectedFacility.currentCount}/${selectedFacility.capacity}`}
            onAccept={() => {
              console.log('Accept Route clicked for:', selectedFacility.name);
              // 안내 시작 로직
            }}
            onReject={() => {
              console.log('Reject clicked - Recommending new spot');
              // 다른 장소 추천 로직
            }}
          />
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
    </div>
  );
}
