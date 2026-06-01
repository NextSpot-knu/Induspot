'use client';

import { useEffect, useState } from 'react';
import { 
  Search, Bell, Download, FileText, Calendar as CalendarIcon, 
  TrendingUp, BarChart2, PieChart as PieChartIcon
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { 
  BarChart, Bar, AreaChart, Area, XAxis, YAxis, CartesianGrid, 
  Tooltip, ResponsiveContainer, Legend
} from 'recharts';

// --- Mock Data ---
const weeklyUsageData = [
  { day: '월', 식당: 1200, 주차장: 800, 회의실: 400, 휴게실: 200 },
  { day: '화', 식당: 1350, 주차장: 850, 회의실: 450, 휴게실: 250 },
  { day: '수', 식당: 1400, 주차장: 900, 회의실: 500, 휴게실: 300 },
  { day: '목', 식당: 1300, 주차장: 880, 회의실: 480, 휴게실: 280 },
  { day: '금', 식당: 1100, 주차장: 750, 회의실: 350, 휴게실: 400 },
  { day: '토', 식당: 300, 주차장: 200, 회의실: 50, 휴게실: 100 },
  { day: '일', 식당: 250, 주차장: 150, 회의실: 20, 휴게실: 80 },
];

const aiAcceptanceTrend = [
  { date: '1주차', 수락: 65, 거절: 35 },
  { date: '2주차', 수락: 68, 거절: 32 },
  { date: '3주차', 수락: 72, 거절: 28 },
  { date: '4주차', 수락: 78, 거절: 22 },
];

const tableData = [
  { id: 1, category: '구내식당', totalUsers: '6,600명', growth: '+12%', status: '활발' },
  { id: 2, category: '주차장', totalUsers: '4,530대', growth: '+5%', status: '안정' },
  { id: 3, category: '회의실', totalUsers: '2,250건', growth: '-2%', status: '보통' },
  { id: 4, category: '휴게실', totalUsers: '1,610명', growth: '+25%', status: '급증' },
];

export default function ReportsPage() {
  // 데모용 기간 표시: 마운트 후 현재 월(KST) 범위를 동적 생성해 hydration mismatch 회피
  const [period, setPeriod] = useState('불러오는 중...');

  useEffect(() => {
    // UTC+9(KST) 오프셋을 적용한 '현재 시각' 기준으로 이번 달의 시작/끝 날짜 계산
    const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
    const nowKst = new Date(Date.now() + KST_OFFSET_MS);
    const year = nowKst.getUTCFullYear();
    const month = nowKst.getUTCMonth(); // 0-based
    const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
    const mm = String(month + 1).padStart(2, '0');
    const dd = String(lastDay).padStart(2, '0');
    setPeriod(`${year}-${mm}-01 ~ ${year}-${mm}-${dd}`);
  }, []);

  const handleExport = (type: string) => {
    alert(`[시연용] 프리미엄 요금제 기능입니다. 실제 서비스에서는 ${type} 파일 생성이 백그라운드에서 진행됩니다.`);
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <AdminSidebar />

      <main className="flex-1 flex flex-col h-full min-h-0 overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800">통계 리포트</h2>
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search..." 
                className="pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
            </div>
            <button className="relative text-slate-500 hover:text-slate-700">
              <Bell size={24} />
            </button>
          </div>
        </header>

        {/* Dashboard Content */}
        <div className="flex-1 min-h-0 p-8 overflow-y-auto pb-20 space-y-8">
          
          {/* Controllers & Actions */}
          <div className="flex justify-between items-center bg-white p-4 rounded-2xl border border-slate-200 shadow-sm flex-shrink-0">
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2 px-4 py-2 bg-slate-100 rounded-lg border border-slate-200 cursor-pointer hover:bg-slate-200 transition-colors">
                <CalendarIcon size={18} className="text-slate-500" />
                <span className="text-sm font-semibold text-slate-700">{period}</span>
              </div>
            </div>
            <div className="flex items-center gap-3">
              <button 
                onClick={() => handleExport('Excel')}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200 font-semibold rounded-lg transition-colors text-sm"
              >
                <FileText size={16} /> Excel 내보내기
              </button>
              <button 
                onClick={() => handleExport('PDF')}
                className="flex items-center gap-2 px-4 py-2 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 font-semibold rounded-lg transition-colors text-sm"
              >
                <Download size={16} /> PDF 다운로드
              </button>
            </div>
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-2 gap-6 min-h-[350px] flex-shrink-0">
            {/* Bar Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <div className="flex items-center gap-2 mb-6">
                <BarChart2 className="text-blue-500" size={20} />
                <h3 className="text-lg font-bold text-slate-800">주간 인프라별 누적 이용량</h3>
              </div>
              <div className="flex-1 w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={weeklyUsageData} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="day" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                    <Tooltip cursor={{fill: '#f8fafc'}} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                    <Bar dataKey="식당" stackId="a" fill="#3b82f6" radius={[0, 0, 4, 4]} />
                    <Bar dataKey="주차장" stackId="a" fill="#10b981" />
                    <Bar dataKey="회의실" stackId="a" fill="#8b5cf6" />
                    <Bar dataKey="휴게실" stackId="a" fill="#f59e0b" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Area Chart */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col">
              <div className="flex items-center gap-2 mb-6">
                <TrendingUp className="text-purple-500" size={20} />
                <h3 className="text-lg font-bold text-slate-800">AI 추천 알고리즘 수락 트렌드</h3>
              </div>
              <div className="flex-1 w-full h-[250px]">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={aiAcceptanceTrend} margin={{ top: 5, right: 0, bottom: 5, left: 0 }}>
                    <defs>
                      <linearGradient id="colorAccept" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0}/>
                      </linearGradient>
                      <linearGradient id="colorReject" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#cbd5e1" stopOpacity={0.8}/>
                        <stop offset="95%" stopColor="#cbd5e1" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                    <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                    <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                    <Legend iconType="circle" wrapperStyle={{ fontSize: '12px' }} />
                    <Area type="monotone" dataKey="수락" stroke="#8b5cf6" fillOpacity={1} fill="url(#colorAccept)" />
                    <Area type="monotone" dataKey="거절" stroke="#94a3b8" fillOpacity={1} fill="url(#colorReject)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          {/* Data Table */}
          <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex-shrink-0">
            <div className="p-6 border-b border-slate-200 flex items-center gap-2">
              <PieChartIcon className="text-slate-500" size={20} />
              <h3 className="text-lg font-bold text-slate-800">카테고리별 누적 요약 데이터</h3>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-50 text-slate-500 text-sm border-b border-slate-200">
                    <th className="p-4 font-semibold">카테고리</th>
                    <th className="p-4 font-semibold">총 이용 건수</th>
                    <th className="p-4 font-semibold">전월 대비 증감률</th>
                    <th className="p-4 font-semibold">상태</th>
                  </tr>
                </thead>
                <tbody className="text-sm">
                  {tableData.map((row) => (
                    <tr key={row.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                      <td className="p-4 font-bold text-slate-700">{row.category}</td>
                      <td className="p-4 text-slate-600">{row.totalUsers}</td>
                      <td className="p-4">
                        <span className={`font-bold ${row.growth.startsWith('+') ? 'text-emerald-600' : 'text-rose-600'}`}>
                          {row.growth}
                        </span>
                      </td>
                      <td className="p-4">
                        <span className={`px-2 py-1 rounded-md text-xs font-bold ${
                          row.status === '급증' ? 'bg-rose-100 text-rose-700' : 
                          row.status === '활발' ? 'bg-blue-100 text-blue-700' :
                          row.status === '보통' ? 'bg-amber-100 text-amber-700' :
                          'bg-slate-100 text-slate-700'
                        }`}>
                          {row.status}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
