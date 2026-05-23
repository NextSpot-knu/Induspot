'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Script from 'next/script';
import { Home, Bookmark, User, Search, Mic, Utensils, ParkingCircle, Building2, Coffee } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';

declare global {
  interface Window {
    kakao: any;
  }
}

export default function MainPage() {
  const mapRef = useRef<HTMLDivElement>(null);
  const [activeTab, setActiveTab] = useState('Home');
  const [activeFilter, setActiveFilter] = useState('주차장');

  const router = useRouter();

  // Initialize Kakao Map
  const initMap = () => {
    if (window.kakao && window.kakao.maps && mapRef.current) {
      window.kakao.maps.load(() => {
        const options = {
          center: new window.kakao.maps.LatLng(37.5665, 126.9780),
          level: 3,
        };
        const map = new window.kakao.maps.Map(mapRef.current, options);
      });
    }
  };

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
      <Script
        src={`//dapi.kakao.com/v2/maps/sdk.js?appkey=${process.env.NEXT_PUBLIC_KAKAO_MAP_KEY}&autoload=false`}
        strategy="afterInteractive"
        onLoad={initMap}
      />

      {/* Map Container */}
      <div 
        ref={mapRef} 
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
      <div className="absolute bottom-[90px] w-full z-20 px-4">
        <RecommendationCard 
          title="Central Cafe A"
          matchPercentage={98}
          description="Light traffic right now. 5 min walk."
          onAccept={() => {
            console.log('Accept Route clicked');
            // 안내 시작 로직
          }}
          onReject={() => {
            console.log('Reject clicked - Recommending new spot');
            // 다른 장소 추천 로직
          }}
        />
      </div>

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
