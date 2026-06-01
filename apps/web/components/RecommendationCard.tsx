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
  onClose?: () => void; // Added close/hide callback
  tttvScore?: number;
  preferencePercent?: number;
  expectedWait?: number;
  expectedTravel?: number;
  timeToService?: number;
  facilityType?: string;
  facility?: any;
  rank?: number;
  totalCandidates?: number;
}

export function RecommendationCard({
  title,
  matchPercentage,
  description,
  onAccept,
  onReject,
  onPutOff,
  onClose,
  tttvScore,
  preferencePercent,
  expectedWait,
  expectedTravel,
  timeToService,
  facilityType,
  facility,
  rank,
  totalCandidates,
}: RecommendationCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [translateY, setTranslateY] = useState(0);
  const [startY, setStartY] = useState<number | null>(null);
  
  const [currentTime, setCurrentTime] = useState<Date | null>(null);

  useEffect(() => {
    setCurrentTime(new Date());
    const interval = setInterval(() => {
      setCurrentTime(new Date());
    }, 60000);
    return () => clearInterval(interval);
  }, []);
  
  // Meeting room mock state
  const [showScheduleModal, setShowScheduleModal] = useState(false);
  const [showBookingModal, setShowBookingModal] = useState(false);
  const [bookingTime, setBookingTime] = useState('09:00');
  const [bookingName, setBookingName] = useState('');
  
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
      // Pulling up to open or pulling down to hide card
      setTranslateY(diff);
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
      // If pulled down in normal state, trigger close/hide
      if (translateY > 70) {
        if (onClose) {
          onClose();
        }
      }
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

  const travelMins = expectedTravel || 0;
  const waitMins = expectedWait || 0;
  
  const arrivalTime = currentTime ? new Date(currentTime.getTime() + travelMins * 60000) : null;
  const serviceTime = arrivalTime ? new Date(arrivalTime.getTime() + waitMins * 60000) : null;

  const formatTime = (date: Date | null) => {
    if (!date) return '';
    return date.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', hour12: false });
  };

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
      <div className="flex justify-between items-start gap-3">
        <div className="flex-1">
          <div className="flex items-center gap-2 mb-1.5">
            {rank ? (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-gradient-to-r from-blue-600 to-blue-400 text-white text-[10px] font-black rounded-lg shadow-sm shadow-blue-500/20">
                <Sparkles size={12} />
                추천 {rank}순위
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 px-2.5 py-1 bg-blue-500/20 text-blue-300 text-[10px] font-bold rounded-lg">
                <Sparkles size={12} />
                AI 추천
              </span>
            )}
            {totalCandidates && rank && (
              <span className="text-[10px] text-gray-400 font-medium">대안 {totalCandidates}개 중</span>
            )}
          </div>
          <h3 className="text-xl font-bold text-white tracking-tight leading-tight">{title}</h3>
          
          {/* Status Pills */}
          {!isExpanded && facility && facility.congestionLevel !== undefined && (
            <div className="flex flex-wrap items-center gap-1.5 mt-2">
              <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold border ${
                facility.congestionLevel >= 0.7 
                  ? 'bg-rose-500/10 border-rose-500/20 text-rose-400'
                  : facility.congestionLevel >= 0.3
                  ? 'bg-amber-500/10 border-amber-500/20 text-amber-400'
                  : 'bg-emerald-500/10 border-emerald-500/20 text-emerald-400'
              }`}>
                혼잡도: {facility.congestionLevel >= 0.7 ? '혼잡' : facility.congestionLevel >= 0.3 ? '보통' : '여유'}
              </span>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-medium bg-white/5 border border-white/10 text-slate-300">
                잔여: {Math.max(0, (facility.capacity || 0) - (facility.currentCount || 0))}자리 (총 {facility.capacity})
              </span>
            </div>
          )}
        </div>

        {/* Dynamic Badge (TTTV Score or match percentage) */}
        {hasTttvMetrics ? (
          <div 
            className="flex flex-col items-center justify-center min-w-[60px] h-[60px] rounded-2xl border border-purple-500/40 bg-gradient-to-b from-purple-500/20 to-purple-500/5 cursor-pointer shadow-lg shadow-purple-500/10"
            onClick={toggleExpand}
          >
            <span className="text-[9px] text-purple-300 font-bold uppercase mb-0.5">TTTV 점수</span>
            <span className="text-white font-black text-xl leading-none">{Math.round(tttvScore || 0)}<span className="text-[10px] font-normal text-purple-200 ml-0.5">점</span></span>
          </div>
        ) : (
          matchPercentage !== undefined && (
            <div className="flex flex-col items-center justify-center min-w-[60px] h-[60px] rounded-2xl border border-blue-500/30 bg-blue-500/10 shadow-md">
              <span className="text-white font-black text-lg">{matchPercentage}%</span>
              <span className="text-[9px] text-blue-300 font-semibold mt-0.5">Match</span>
            </div>
          )
        )}
      </div>

      {/* TTTV Metric Grid (Only if metrics are provided) */}
      {hasTttvMetrics && facilityType !== 'loading_dock' && (
        <div className="flex flex-col gap-2 mt-1">
          {facilityType === 'meeting_room' ? (
            <div className="grid grid-cols-2 gap-1 bg-white/5 rounded-2xl p-2.5 border border-white/5 text-[11px]">
              <div className="text-center">
                <span className="text-slate-400 block text-[9px] mb-0.5 font-medium">현재 이용현황</span>
                <span className="font-extrabold text-sky-400">
                  {facility?.congestionLevel >= 0.7 ? '사용중' : '비어있음'}
                </span>
              </div>
              <div className="text-center border-l border-white/10">
                <span className="text-slate-400 block text-[9px] mb-0.5 font-medium">남은 시간</span>
                <span className="font-extrabold text-amber-400">
                  {facility?.congestionLevel >= 0.7 ? `${facility?.features?.remainingMinutes || 15}분` : '-'}
                </span>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2">
                {/* Time Cost Column */}
                <div className="flex-1 bg-gradient-to-br from-blue-500/10 to-blue-500/5 border border-blue-500/20 rounded-2xl p-3 flex flex-col justify-center relative overflow-hidden">
                  <div className="absolute top-0 right-0 p-2 opacity-20">
                    <Clock size={24} className="text-blue-300" />
                  </div>
                  <span className="text-blue-300 text-[10px] font-semibold mb-1">총 소요 시간</span>
                  <div className="flex items-baseline gap-1 mb-1.5">
                    <span className="text-2xl font-black text-white">{timeToService}</span>
                    <span className="text-xs text-blue-200 font-medium">분</span>
                  </div>
                  <div className="flex items-center gap-2 text-[9px] text-blue-200/80 font-medium">
                    <span className="bg-blue-500/20 px-1.5 py-0.5 rounded text-blue-300">대기 {expectedWait}분</span>
                    <span className="text-blue-500/50">+</span>
                    <span className="bg-emerald-500/20 px-1.5 py-0.5 rounded text-emerald-400">이동 {expectedTravel}분</span>
                  </div>
                </div>

                {/* Preference Column */}
                <div className="w-[110px] bg-white/5 border border-white/10 rounded-2xl p-3 flex flex-col justify-center items-center text-center">
                  <span className="text-slate-400 text-[10px] font-semibold mb-1">취향 일치율</span>
                  <div className="flex items-baseline gap-0.5 mb-1">
                    <span className="text-xl font-black text-sky-400">{preferencePercent}</span>
                    <span className="text-xs text-sky-400/80 font-bold">%</span>
                  </div>
                  {facilityType === 'parking' ? (
                    <span className="text-[9px] text-slate-500 mt-0.5 line-clamp-2">주차공간 맞춤</span>
                  ) : (
                    <span className="text-[9px] text-slate-500 mt-0.5 line-clamp-2">사용자 패턴 기반</span>
                  )}
                </div>
              </div>

              {/* Timeline UI */}
              {currentTime && arrivalTime && serviceTime && (
                <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3 flex flex-col gap-3">
                  <div className="flex items-start justify-between relative mt-1">
                    {/* Connecting Line */}
                    <div className="absolute top-[3px] left-4 right-4 h-[2px] bg-white/10 z-0" />
                    
                    {/* Travel Duration Label */}
                    <div className="absolute top-[-10px] left-[25%] -translate-x-1/2 z-10">
                      <span className="text-[9px] font-medium text-emerald-400 bg-[#161c28] px-1.5 py-0.5 rounded border border-emerald-500/20">이동 {travelMins}분</span>
                    </div>
                    {/* Wait Duration Label */}
                    <div className="absolute top-[-10px] left-[75%] -translate-x-1/2 z-10">
                      <span className="text-[9px] font-medium text-amber-400 bg-[#161c28] px-1.5 py-0.5 rounded border border-amber-500/20">대기 {waitMins}분</span>
                    </div>
                    
                    {/* Current Time Step */}
                    <div className="flex flex-col items-center z-10 w-12">
                      <div className="w-2 h-2 rounded-full bg-blue-500 ring-4 ring-[#1a2133] mb-1.5" />
                      <span className="text-[10px] text-white font-bold">{formatTime(currentTime)}</span>
                      <span className="text-[9px] text-slate-400 mt-0.5">출발</span>
                    </div>
                    
                    {/* Arrival Time Step */}
                    <div className="flex flex-col items-center z-10 w-12">
                      <div className="w-2 h-2 rounded-full bg-emerald-400 ring-4 ring-[#1a2133] mb-1.5" />
                      <span className="text-[10px] text-white font-bold">{formatTime(arrivalTime)}</span>
                      <span className="text-[9px] text-slate-400 mt-0.5">도착</span>
                    </div>

                    {/* Service Start Step */}
                    <div className="flex flex-col items-center z-10 w-12">
                      <div className="w-2 h-2 rounded-full bg-amber-400 ring-4 ring-[#1a2133] mb-1.5" />
                      <span className="text-[10px] text-white font-bold">{formatTime(serviceTime)}</span>
                      <span className="text-[9px] text-slate-400 mt-0.5">{facilityType === 'cafeteria' ? '식사' : '이용'}</span>
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 휴게실 특화 UI (TTTV 미사용) */}
      {facilityType === 'loading_dock' && (
        <div className="flex flex-col gap-2 mt-1">
          <div className="flex justify-between items-center bg-white/5 rounded-2xl p-3 border border-white/10 text-xs">
            <span className="text-slate-300 font-medium">안마의자 이용현황</span>
            <span className="font-extrabold text-amber-400">
              {facility?.features?.massageChairs ? `${facility.features.massageChairs.inUse} / ${facility.features.massageChairs.total}` : '0 / 3'}
            </span>
          </div>
          <div className="flex justify-between items-center bg-white/5 rounded-2xl p-3 border border-white/10 text-xs">
            <span className="text-slate-300 font-medium">수면캡슐 이용현황</span>
            <span className="font-extrabold text-sky-400">
              {facility?.features?.sleepCapsules ? `${facility.features.sleepCapsules.inUse} / ${facility.features.sleepCapsules.total}` : '0 / 2'}
            </span>
          </div>
          <div className="flex justify-between items-center bg-white/5 rounded-2xl p-3 border border-white/10 text-xs">
            <span className="text-slate-300 font-medium">플레이스테이션 이용현황</span>
            <span className="font-extrabold text-purple-400">
              {facility?.features?.playstation ? `${facility.features.playstation.inUse} / ${facility.features.playstation.total}` : '0 / 1'}
            </span>
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

      {/* Action Buttons: Reject, Put off, Accept Route (or custom for meeting rooms) */}
      {facilityType === 'loading_dock' ? null : facilityType === 'meeting_room' ? (
        <div className="flex gap-2 mt-1">
          <button
            onClick={() => setShowScheduleModal(true)}
            className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 rounded-2xl border border-white/10 transition-all text-xs"
          >
            예약 현황
          </button>
          <button
            onClick={() => setShowBookingModal(true)}
            className="flex-1 bg-gradient-to-r from-blue-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 text-white font-bold py-3 rounded-2xl transition-all text-xs shadow-md shadow-blue-500/20"
          >
            예약하기
          </button>
        </div>
      ) : (
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
      )}

      {/* Meeting Room Schedule Modal (Mock) */}
      {showScheduleModal && (
        <div className="absolute inset-0 z-50 bg-[#111622]/95 backdrop-blur-xl flex flex-col p-5">
          <div className="flex justify-between items-center mb-4">
            <h4 className="text-white font-bold text-lg">오늘 예약 현황</h4>
            <button onClick={() => setShowScheduleModal(false)} className="text-gray-400 hover:text-white">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-2 pr-2 custom-scrollbar">
            {['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '12:00', '12:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30', '16:00', '16:30', '17:00'].map((time, idx) => {
              const isBooked = idx % 3 === 1 || idx % 4 === 2; // dummy logic
              return (
                <div key={time} className={`flex items-center justify-between p-3 rounded-xl border ${isBooked ? 'bg-white/5 border-white/10' : 'bg-blue-500/10 border-blue-500/20'}`}>
                  <span className="text-sm font-bold text-slate-300">{time} ~</span>
                  {isBooked ? (
                    <span className="text-xs text-slate-400">예약됨 (홍길동)</span>
                  ) : (
                    <span className="text-xs text-blue-400 font-bold">예약 가능</span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Meeting Room Booking Modal (Mock) */}
      {showBookingModal && (
        <div className="absolute inset-0 z-50 bg-[#111622]/95 backdrop-blur-xl flex flex-col p-5 justify-center">
          <div className="flex justify-between items-center mb-6">
            <h4 className="text-white font-bold text-lg">회의실 예약하기</h4>
            <button onClick={() => setShowBookingModal(false)} className="text-gray-400 hover:text-white">✕</button>
          </div>
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-slate-400 mb-1">예약 시간 (비어있는 시간대)</label>
              <select 
                className="w-full bg-black/50 border border-white/20 text-white rounded-xl p-3 outline-none"
                value={bookingTime}
                onChange={(e) => setBookingTime(e.target.value)}
              >
                <option value="09:00">09:00 ~ 09:30</option>
                <option value="11:00">11:00 ~ 11:30</option>
                <option value="13:30">13:30 ~ 14:00</option>
                <option value="15:00">15:00 ~ 15:30</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-slate-400 mb-1">예약자명</label>
              <input 
                type="text" 
                placeholder="이름을 입력하세요"
                className="w-full bg-black/50 border border-white/20 text-white rounded-xl p-3 outline-none"
                value={bookingName}
                onChange={(e) => setBookingName(e.target.value)}
              />
            </div>
            <button 
              onClick={() => {
                if (!bookingName) return alert('예약자명을 입력해주세요.');
                alert(`${bookingName}님, ${bookingTime} 예약이 완료되었습니다.`);
                setShowBookingModal(false);
                setBookingName('');
              }}
              className="w-full bg-blue-600 hover:bg-blue-500 text-white font-bold py-3 rounded-xl mt-4"
            >
              예약 완료
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
