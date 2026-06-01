'use client';

import { useState } from 'react';
import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

export function DashboardCharts({ distribution }: { distribution: any[] }) {
  // distribution = [ { date: string, beforeCongestion: number, afterCongestion: number, alternativeUsage: number } ]
  const [viewMode, setViewMode] = useState<'local' | 'looker'>('local');
  
  // Looker Studio 보고서 공유 URL (기본 템플릿/데모)
  const lookerStudioUrl = "https://lookerstudio.google.com/embed/reporting/3253f16c-63b1-432a-b6fe-5f3e800614ba/page/d1234";

  // recharts tooltip formatter to show percentage
  const formatPercent = (value: any) => `${(Number(value) * 100).toFixed(1)}%`;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm col-span-4 flex flex-col gap-4">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-bold text-slate-800">최근 30일 수요 분산 효과 분석</h3>
        
        {/* 시각화 모드 토글 (GCP 6계층 마이그레이션) */}
        <div className="flex bg-slate-100 p-1 rounded-lg border border-slate-200">
          <button
            onClick={() => setViewMode('local')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              viewMode === 'local'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            차트 뷰
          </button>
          <button
            onClick={() => setViewMode('looker')}
            className={`px-3 py-1 text-xs font-semibold rounded-md transition-all ${
              viewMode === 'looker'
                ? 'bg-white text-blue-600 shadow-sm'
                : 'text-slate-600 hover:text-slate-800'
            }`}
          >
            Looker Studio 뷰
          </button>
        </div>
      </div>

      {viewMode === 'local' ? (
        <div className="h-[300px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={distribution} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
              <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
              <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} domain={[0, 1]} tickFormatter={(val) => `${Math.round(val * 100)}%`} />
              <Tooltip formatter={formatPercent} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
              <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
              <Line name="도입 전 혼잡도" type="monotone" dataKey="beforeCongestion" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
              <Line name="도입 후 혼잡도" type="monotone" dataKey="afterCongestion" stroke="#3b82f6" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
              <Line name="대안 시설 활용률" type="monotone" dataKey="alternativeUsage" stroke="#10b981" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="h-[300px] w-full border border-slate-200 rounded-xl overflow-hidden shadow-inner">
          <iframe
            src={lookerStudioUrl}
            className="w-full h-full border-0"
            allowFullScreen
            sandbox="allow-storage-access-by-user-activation allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox"
          ></iframe>
        </div>
      )}
    </div>
  );
}

// 히트맵 차트는 CSS Grid를 이용한 커스텀 구현 (Recharts에 기본 Heatmap이 없으므로 직관적이고 커스텀 쉬운 Grid 사용)
export function DashboardHeatmap({ heatmapData }: { heatmapData: any[] }) {
  // heatmapData: [ { facility: string, facilityType: string, hour: number, value: number } ]
  
  const [selectedCategory, setSelectedCategory] = useState('cafeteria');
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 10;

  const categories = [
    { id: 'cafeteria', name: '식당' },
    { id: 'parking', name: '주차장' },
    { id: 'meeting_room', name: '회의실' },
    { id: 'rest_area', name: '휴게실' },
  ];

  // Selected category data
  const filteredData = heatmapData.filter(d => d.facilityType === selectedCategory);
  
  // Unique facilities in selected category
  const filteredFacilities = Array.from(new Set(filteredData.map(d => d.facility)));
  
  // Pagination
  const totalItems = filteredFacilities.length;
  const totalPages = Math.ceil(totalItems / itemsPerPage) || 1;
  const startIndex = (currentPage - 1) * itemsPerPage;
  const paginatedFacilities = filteredFacilities.slice(startIndex, startIndex + itemsPerPage);

  const hours = Array.from({length: 24}, (_, i) => (i + 10) % 24);
  
  const getHeatmapColor = (value: number) => {
    if (value === 0) return 'bg-slate-50'; // 데이터 없음
    if (value < 0.3) return 'bg-emerald-100';
    if (value < 0.6) return 'bg-emerald-400';
    if (value < 0.8) return 'bg-amber-400';
    return 'bg-rose-500';
  };

  const getHeatmapValue = (facility: string, hour: number) => {
    const item = heatmapData.find(d => d.facility === facility && d.hour === hour);
    return item ? item.value : 0;
  };

  const handleCategoryChange = (catId: string) => {
    setSelectedCategory(catId);
    setCurrentPage(1);
  };

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm col-span-4 flex flex-col justify-between overflow-x-auto min-h-[500px]">
      <div>
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
          <h3 className="text-lg font-bold text-slate-800">시설별 시간대 혼잡 히트맵</h3>
          
          {/* Category Filters */}
          <div className="flex gap-2">
            {categories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => handleCategoryChange(cat.id)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                  selectedCategory === cat.id
                    ? 'bg-blue-50 border-blue-200 text-blue-700 font-bold'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:bg-slate-100'
                }`}
              >
                {cat.name}
              </button>
            ))}
          </div>
        </div>

        <div className="min-w-[800px]">
          {/* X축 (시간) */}
          <div className="flex ml-36 mb-2">
            {hours.map(h => (
              <div key={h} className="flex-1 text-center text-xs text-slate-500 font-medium">
                {h}시
              </div>
            ))}
          </div>
          
          {/* 시설별 로우 */}
          <div className="flex flex-col gap-2 min-h-[160px]">
            {paginatedFacilities.map(fac => (
              <div key={fac} className="flex items-center">
                <div className="w-36 text-sm font-semibold text-slate-700 truncate pr-4 text-right">
                  {fac}
                </div>
                <div className="flex-1 flex gap-1">
                  {hours.map(h => {
                    const val = getHeatmapValue(fac, h);
                    return (
                      <div 
                        key={`${fac}-${h}`}
                        title={`${fac} ${h}시: ${(val * 100).toFixed(0)}%`}
                        className={`flex-1 h-8 rounded-sm transition-colors hover:ring-2 hover:ring-blue-500 cursor-pointer ${getHeatmapColor(val)}`}
                      ></div>
                    );
                  })}
                </div>
              </div>
            ))}
            {paginatedFacilities.length === 0 && (
              <div className="h-32 flex items-center justify-center text-slate-400 text-sm">
                해당 카테고리의 시설 데이터가 없습니다.
              </div>
            )}
          </div>

          {/* 범례 */}
          <div className="flex justify-end items-center gap-4 mt-6 text-xs text-slate-500">
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-sm bg-slate-50 border border-slate-200"></div>데이터 없음</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-sm bg-emerald-100"></div>여유 (0~30%)</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-sm bg-emerald-400"></div>보통 (30~60%)</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-sm bg-amber-400"></div>혼잡 (60~80%)</div>
            <div className="flex items-center gap-1"><div className="w-4 h-4 rounded-sm bg-rose-500"></div>매우 혼잡 (80%~)</div>
          </div>
        </div>
      </div>

      {/* Pagination Controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between border-t border-slate-100 pt-4 mt-6">
          <div className="text-xs text-slate-500 font-medium">
            총 {totalItems}개 중 {startIndex + 1}-{Math.min(startIndex + itemsPerPage, totalItems)}개 표시
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 10, 1))}
              disabled={currentPage === 1}
              title="10페이지 이전"
              className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsLeft size={16} />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              title="이전 페이지"
              className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronLeft size={16} />
            </button>
            <span className="text-xs text-slate-600 font-semibold px-2">
              {currentPage} / {totalPages}
            </span>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 1, totalPages))}
              disabled={currentPage === totalPages}
              title="다음 페이지"
              className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronRight size={16} />
            </button>
            <button
              onClick={() => setCurrentPage(prev => Math.min(prev + 10, totalPages))}
              disabled={currentPage === totalPages}
              title="10페이지 다음"
              className="p-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <ChevronsRight size={16} />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
