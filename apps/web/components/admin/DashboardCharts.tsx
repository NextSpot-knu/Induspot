'use client';

import { 
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend 
} from 'recharts';

export function DashboardCharts({ distribution }: { distribution: any[] }) {
  // distribution = [ { date: string, beforeCongestion: number, afterCongestion: number, alternativeUsage: number } ]
  
  // recharts tooltip formatter to show percentage
  const formatPercent = (value: any) => `${(Number(value) * 100).toFixed(1)}%`;

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm col-span-2">
      <h3 className="text-lg font-bold text-slate-800 mb-6">최근 30일 수요 분산 효과 분석</h3>
      <div className="h-[300px] w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={distribution} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
            <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
            <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} domain={[0, 1]} tickFormatter={(val) => `${Math.round(val * 100)}%`} />
            <Tooltip formatter={formatPercent} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
            <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
            <Line name="원본 시설(도입 전)" type="monotone" dataKey="beforeCongestion" stroke="#94a3b8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
            <Line name="원본 시설(도입 후)" type="monotone" dataKey="afterCongestion" stroke="#3b82f6" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
            <Line name="대안 시설 활용률" type="monotone" dataKey="alternativeUsage" stroke="#10b981" strokeWidth={3} dot={{r: 4}} activeDot={{r: 6}} />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// 히트맵 차트는 CSS Grid를 이용한 커스텀 구현 (Recharts에 기본 Heatmap이 없으므로 직관적이고 커스텀 쉬운 Grid 사용)
export function DashboardHeatmap({ heatmapData }: { heatmapData: any[] }) {
  // heatmapData: [ { facility: string, hour: number, value: number } ]
  
  // 데이터 변환 로직 (시설별로 그룹핑)
  const facilities = Array.from(new Set(heatmapData.map(d => d.facility)));
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

  return (
    <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm col-span-2 overflow-x-auto">
      <h3 className="text-lg font-bold text-slate-800 mb-6">시설별 시간대 혼잡 히트맵</h3>
      <div className="min-w-[800px]">
        {/* X축 (시간) */}
        <div className="flex ml-24 mb-2">
          {hours.map(h => (
            <div key={h} className="flex-1 text-center text-xs text-slate-500 font-medium">
              {h}시
            </div>
          ))}
        </div>
        
        {/* 시설별 로우 */}
        <div className="flex flex-col gap-2">
          {facilities.map(fac => (
            <div key={fac} className="flex items-center">
              <div className="w-24 text-sm font-semibold text-slate-700 truncate pr-4 text-right">
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
  );
}
