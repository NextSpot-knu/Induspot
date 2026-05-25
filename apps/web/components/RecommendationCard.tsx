'use client';

import { useState, useEffect, useRef } from 'react';
import { Bookmark, Sparkles, Star, Phone, MapPin, Clock, ChevronUp, ChevronDown } from 'lucide-react';

interface RecommendationCardProps {
  title: string;
  matchPercentage?: number;
  description: string;
  onAccept: () => void;
  onReject: () => void;
  onPutOff?: () => void;
  tttvScore?: number;
  preferencePercent?: number;
  expectedWait?: number;
  expectedTravel?: number;
  timeToService?: number;
  facilityType?: string;
  facility?: any;
}

export function RecommendationCard({
  title,
  matchPercentage,
  description,
  onAccept,
  onReject,
  onPutOff,
  tttvScore,
  preferencePercent,
  expectedWait,
  expectedTravel,
  timeToService,
  facilityType,
  facility,
}: RecommendationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [startY, setStartY] = useState<number | null>(null);
  
  const [placeInfo, setPlaceInfo] = useState<{
    address?: string;
    phone?: string;
    rating?: number;
    reviewCount?: number;
    url?: string;
  } | null>(null);

  // Load place details from Kakao Places API
  useEffect(() => {
    if (!title || typeof window === 'undefined' || !window.kakao || !window.kakao.maps) return;
    
    // Check if services library is loaded
    if (!window.kakao.maps.services) {
      console.warn("Kakao Places services library not loaded");
      setPlaceInfo({
        address: facility?.features?.address || '경기 안산시 단원구 산단로',
        phone: facility?.features?.phone || '031-123-4567',
        rating: 4.5,
        reviewCount: 28,
        url: `https://map.kakao.com/?q=${encodeURIComponent(title)}`
      });
      return;
    }

    try {
      const ps = new window.kakao.maps.services.Places();
      ps.keywordSearch(title, (data: any, status: any) => {
        if (status === window.kakao.maps.services.Status.OK && data.length > 0) {
          const place = data[0];
          // Stable mock rating and reviews based on place ID
          const seed = place.id ? parseInt(place.id) : 10;
          const mockRating = 4.0 + (seed % 10) / 10;
          const mockReviews = 10 + (seed % 90);
          
          setPlaceInfo({
            address: place.road_address_name || place.address_name,
            phone: place.phone || '전화번호 정보 없음',
            rating: parseFloat(mockRating.toFixed(1)),
            reviewCount: mockReviews,
            url: place.place_url
          });
        } else {
          // Fallback if no search match
          setPlaceInfo({
            address: facility?.features?.address || '경기 안산시 단원구 산단로',
            phone: facility?.features?.phone || '031-123-4567',
            rating: 4.3,
            reviewCount: 15,
            url: `https://map.kakao.com/?q=${encodeURIComponent(title)}`
          });
        }
      });
    } catch (e) {
      console.error("Kakao Places API search error:", e);
    }
  }, [title, facility]);

  // Drag Gesture Handlers
  const handleStart = (clientY: number) => {
    setStartY(clientY);
  };

  const handleMove = (clientY: number) => {
    if (startY === null) return;
    const diff = clientY - startY;
    
    if (isExpanded) {
      // Pulling down to close
      if (diff > 0) {
        setTranslateY(diff);
      }
    } else {
      // Pulling up to open
      if (diff < 0) {
        setTranslateY(diff);
      }
    }
  };

  const handleEnd = () => {
    if (startY === null) return;
    setStartY(null);
    
    if (isExpanded) {
      // If pulled down sufficiently, collapse
      if (translateY > 70) {
        setIsExpanded(false);
      }
    } else {
      // If pulled up sufficiently, expand
      if (translateY < -70) {
        setIsExpanded(true);
      }
    }
    setTranslateY(0);
  };

  const toggleExpand = () => {
    setIsExpanded(!isExpanded);
  };

  const hasTttvMetrics = tttvScore !== undefined;

  return (
    <div 
      className="w-full bg-[#111622]/95 backdrop-blur-2xl border border-white/10 rounded-3xl p-5 shadow-[0_10px_35px_rgba(0,0,0,0.5)] flex flex-col gap-3 select-none transition-all duration-300 relative overflow-hidden"
      style={{
        transform: `translateY(${translateY}px)`,
        transition: startY ? 'none' : 'transform 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
        touchAction: 'none'
      }}
      onTouchStart={(e) => handleStart(e.touches[0].clientY)}
      onTouchMove={(e) => handleMove(e.touches[0].clientY)}
      onTouchEnd={handleEnd}
      onMouseDown={(e) => handleStart(e.clientY)}
      onMouseMove={(e) => { if (startY !== null) handleMove(e.clientY); }}
      onMouseUp={handleEnd}
      onMouseLeave={handleEnd}
    >
      {/* Decorative upper border glow */}
      <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-blue-500/80 to-transparent" />

      {/* Swipe/Drag Handle Bar */}
      <div 
        className="w-16 h-1.5 bg-white/20 hover:bg-white/30 rounded-full mx-auto mb-1 cursor-pointer flex items-center justify-center transition-colors"
        onClick={toggleExpand}
      >
        <div className="sr-only">Drag handle</div>
      </div>

      {/* Top Header Row */}
      <div className="flex justify-between items-start gap-4">
        <div className="flex-1">
          <div className="flex items-center gap-1.5 text-blue-400 mb-1.5 text-xs font-semibold tracking-wider">
            <Sparkles size={14} className="animate-pulse" />
            <span>AI 추천 대안 경로</span>
          </div>
          <h3 className="text-xl font-bold text-white tracking-tight">{title}</h3>
          
          {!isExpanded && (
            <p className="text-gray-400 text-xs mt-1 truncate max-w-[240px]">
              {description}
            </p>
          )}
        </div>

        {/* Dynamic Badge (TTTV Score or match percentage) */}
        {hasTttvMetrics ? (
          <div 
            className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl border border-purple-500/30 bg-purple-500/10 cursor-pointer shadow-md"
            onClick={toggleExpand}
          >
            <span className="text-white font-black text-base">{tttvScore.toFixed(2)}</span>
            <span className="text-[9px] text-purple-300 font-bold uppercase">TTTV</span>
          </div>
        ) : (
          matchPercentage !== undefined && (
            <div className="flex flex-col items-center justify-center w-14 h-14 rounded-2xl border border-blue-500/30 bg-blue-500/10 shadow-md">
              <span className="text-white font-black text-sm">{matchPercentage}%</span>
              <span className="text-[9px] text-blue-300 font-semibold">Match</span>
            </div>
          )
        )}
      </div>

      {/* TTTV Metric Grid (Only if metrics are provided) */}
      {hasTttvMetrics && (
        <div className="flex flex-col gap-2 mt-1">
          {/* Main 3 Metrics */}
          <div className="grid grid-cols-3 gap-1 bg-white/5 rounded-2xl p-2.5 border border-white/5 text-[11px]">
            <div className="text-center">
              <span className="text-slate-400 block text-[9px] mb-0.5 font-medium">선호 일치율</span>
              <span className="font-extrabold text-sky-400">{preferencePercent}%</span>
            </div>
            <div className="text-center border-x border-white/10">
              <span className="text-slate-400 block text-[9px] mb-0.5 font-medium">예상 대기</span>
              <span className="font-extrabold text-amber-400">{expectedWait}분</span>
            </div>
            <div className="text-center">
              <span className="text-slate-400 block text-[9px] mb-0.5 font-medium">예상 이동</span>
              <span className="font-extrabold text-emerald-400">{expectedTravel}분</span>
            </div>
          </div>

          {/* Time to Service (Time cost sum) */}
          <div className="flex justify-between items-center bg-blue-500/10 border border-blue-500/20 rounded-2xl px-4 py-2 text-xs font-semibold shadow-inner">
            <span className="text-blue-300 font-medium">서비스 이용까지 (대기 + 이동)</span>
            <span className="text-white font-black text-sm">{timeToService}분</span>
          </div>
        </div>
      )}

      {/* Drag up / Expandable Details Section (Rating, Address, Phone, Hours) */}
      <div 
        className="overflow-hidden transition-all duration-300 ease-in-out"
        style={{ 
          maxHeight: isExpanded ? '280px' : '0px', 
          opacity: isExpanded ? 1 : 0,
          marginTop: isExpanded ? '4px' : '0px'
        }}
      >
        <div className="border-t border-white/10 pt-3.5 space-y-3 text-xs text-slate-300">
          
          {/* Rating */}
          <div className="flex items-center gap-2">
            <div className="flex items-center text-amber-400">
              <Star size={14} className="fill-amber-400 mr-0.5" />
              <span className="font-extrabold text-white">{placeInfo?.rating ?? 4.5}</span>
            </div>
            <span className="text-slate-500">|</span>
            <span className="text-slate-400">리뷰 {placeInfo?.reviewCount ?? 20}개</span>
            
            {placeInfo?.url && (
              <a 
                href={placeInfo.url} 
                target="_blank" 
                rel="noreferrer"
                className="ml-auto text-blue-400 hover:text-blue-300 underline font-bold tracking-tight"
              >
                상세 리뷰 보기 ↗
              </a>
            )}
          </div>

          {/* Address */}
          <div className="flex items-start gap-2">
            <MapPin size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-slate-400 block text-[9px] uppercase font-bold">주소</span>
              <span className="text-slate-200 leading-relaxed">{placeInfo?.address}</span>
            </div>
          </div>

          {/* Phone */}
          <div className="flex items-start gap-2">
            <Phone size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-slate-400 block text-[9px] uppercase font-bold">전화번호</span>
              <span className="text-slate-200">{placeInfo?.phone}</span>
            </div>
          </div>

          {/* Operating Hours */}
          <div className="flex items-start gap-2">
            <Clock size={14} className="text-slate-400 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-slate-400 block text-[9px] uppercase font-bold">운영 시간</span>
              <span className="text-slate-200">
                {facility?.operatingHours?.open || '09:00'} ~ {facility?.operatingHours?.close || '22:00'}
                {facility?.operatingHours?.weekday && ` (${facility.operatingHours.weekday})`}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Action Buttons: Reject, Put off, Accept Route */}
      <div className="flex gap-2 mt-1">
        <button
          onClick={onReject}
          className="flex-1 bg-white/5 hover:bg-rose-500/10 hover:text-rose-400 hover:border-rose-500/30 text-gray-300 font-bold py-3 rounded-2xl border border-white/10 transition-all text-xs focus:outline-none"
        >
          Reject
        </button>
        {onPutOff && (
          <button
            onClick={onPutOff}
            className="flex-1 bg-white/5 hover:bg-amber-500/10 hover:text-amber-400 hover:border-amber-500/30 text-gray-300 font-bold py-3 rounded-2xl border border-white/10 transition-all text-xs focus:outline-none"
          >
            Put off
          </button>
        )}
        <button
          onClick={onAccept}
          className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 rounded-2xl transition-all text-xs shadow-md shadow-blue-500/20 focus:outline-none"
        >
          Accept Route
        </button>
      </div>
    </div>
  );
}
