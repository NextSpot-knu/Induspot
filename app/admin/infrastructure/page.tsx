'use client';

import { useState } from 'react';
import { 
  Building2, Search, Bell, Utensils, ParkingCircle, Coffee, Filter, 
  ChevronRight, AlertTriangle, Users, Clock, Activity 
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

// --- Mock Data ---
interface Infrastructure {
  id: string;
  name: string;
  type: '식당' | '주차장' | '회의실' | '휴게실';
  status: 'green' | 'yellow' | 'red';
  capacity: string;
  expectedDemand: string;
}

const mockInfras: Infrastructure[] = [
  { id: '1', name: 'A구내식당', type: '식당', status: 'red', capacity: '250/300', expectedDemand: '매우 높음 (선호 메뉴 통계 반영)' },
  { id: '2', name: 'B주차장 C존', type: '주차장', status: 'yellow', capacity: '85/100', expectedDemand: '보통 (오후 시간대 진입 예측)' },
  { id: '3', name: '동관 휴게실', type: '휴게실', status: 'green', capacity: '12/50', expectedDemand: '낮음' },
  { id: '4', name: '메인 컨퍼런스 룸', type: '회의실', status: 'red', capacity: '예약 꽉 참', expectedDemand: '높음' },
  { id: '5', name: '야외 주차장 2', type: '주차장', status: 'green', capacity: '20/200', expectedDemand: '매우 낮음 (유휴 상태)' },
  { id: '6', name: 'C구내식당', type: '식당', status: 'green', capacity: '50/200', expectedDemand: '낮음' },
];

const mockDemandData = [
  { time: '11:00', demand: 20 },
  { time: '11:30', demand: 50 },
  { time: '12:00', demand: 95 },
  { time: '12:30', demand: 85 },
  { time: '13:00', demand: 40 },
  { time: '13:30', demand: 15 },
];

export default function InfrastructurePage() {
  const [activeFilter, setActiveFilter] = useState('전체');
  const [selectedInfra, setSelectedInfra] = useState<Infrastructure | null>(mockInfras[0]);

  const filteredInfras = activeFilter === '전체' 
    ? mockInfras 
    : mockInfras.filter(infra => infra.type === activeFilter);

  const getTypeIcon = (type: string) => {
    switch (type) {
      case '식당': return <Utensils size={18} />;
      case '주차장': return <ParkingCircle size={18} />;
      case '회의실': return <Building2 size={18} />;
      case '휴게실': return <Coffee size={18} />;
      default: return <Building2 size={18} />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'red': return 'bg-red-500';
      case 'yellow': return 'bg-amber-500';
      case 'green': return 'bg-emerald-500';
      default: return 'bg-gray-500';
    }
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <AdminSidebar />

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800">인프라 모니터링</h2>
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

        {/* Layout: Master-Detail */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Master List */}
          <div className="w-1/3 bg-white border-r border-slate-200 flex flex-col h-full">
            <div className="p-4 border-b border-slate-200">
              <div className="flex gap-2 overflow-x-auto no-scrollbar pb-2">
                {['전체', '식당', '주차장', '회의실', '휴게실'].map(filter => (
                  <button
                    key={filter}
                    onClick={() => setActiveFilter(filter)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                      activeFilter === filter 
                        ? 'bg-blue-600 text-white' 
                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                    }`}
                  >
                    {filter}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-3">
              {filteredInfras.map(infra => (
                <div 
                  key={infra.id}
                  onClick={() => setSelectedInfra(infra)}
                  className={`p-4 rounded-xl border cursor-pointer transition-all ${
                    selectedInfra?.id === infra.id 
                      ? 'border-blue-500 bg-blue-50 shadow-sm' 
                      : 'border-slate-200 bg-white hover:border-slate-300'
                  }`}
                >
                  <div className="flex justify-between items-start mb-2">
                    <div className="flex items-center gap-2">
                      <span className="p-1.5 rounded-lg bg-slate-100 text-slate-600">
                        {getTypeIcon(infra.type)}
                      </span>
                      <h3 className="font-bold text-slate-800">{infra.name}</h3>
                    </div>
                    <div className={`w-3 h-3 rounded-full ${getStatusColor(infra.status)} mt-1`} />
                  </div>
                  <div className="text-sm text-slate-500 flex justify-between mt-3">
                    <span>수용 현황: {infra.capacity}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Detail Panel */}
          <div className="flex-1 bg-slate-50 p-8 overflow-y-auto">
            {selectedInfra ? (
              <div className="max-w-3xl mx-auto flex flex-col gap-6 animate-fade-in">
                
                {/* Detail Header */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex justify-between items-start">
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <span className="px-2 py-0.5 rounded text-xs font-semibold bg-blue-100 text-blue-700">
                        {selectedInfra.type}
                      </span>
                      <span className="text-sm font-medium text-slate-500">ID: INF-{selectedInfra.id}</span>
                    </div>
                    <h2 className="text-3xl font-black text-slate-800">{selectedInfra.name}</h2>
                  </div>
                  <div className="flex flex-col items-end">
                    <div className="text-sm font-semibold text-slate-500 mb-1">현재 상태</div>
                    <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 border border-slate-200">
                      <div className={`w-3 h-3 rounded-full ${getStatusColor(selectedInfra.status)}`} />
                      <span className="text-sm font-bold text-slate-700">
                        {selectedInfra.status === 'red' ? '혼잡' : selectedInfra.status === 'yellow' ? '보통' : '여유'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* KPI Overview */}
                <div className="grid grid-cols-2 gap-6">
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                      <Users size={18} />
                      <span className="font-semibold text-sm">실시간 수용량</span>
                    </div>
                    <div className="text-2xl font-bold text-slate-800">{selectedInfra.capacity}</div>
                  </div>
                  <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm border-l-4 border-l-blue-500">
                    <div className="flex items-center gap-2 text-slate-500 mb-2">
                      <Activity size={18} />
                      <span className="font-semibold text-sm">예상 수요 (온보딩 데이터 기반)</span>
                    </div>
                    <div className="text-lg font-bold text-blue-700">{selectedInfra.expectedDemand}</div>
                    <p className="text-xs text-slate-400 mt-1">유저의 선호 메뉴 및 동선 데이터 분석 결과</p>
                  </div>
                </div>

                {/* Time Series Chart */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col h-[300px]">
                  <h3 className="text-lg font-bold text-slate-800 mb-4 flex items-center gap-2">
                    <Clock size={20} className="text-slate-500" />
                    시간대별 혼잡도 추이 (금일)
                  </h3>
                  <div className="flex-1 w-full">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={mockDemandData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                        <XAxis dataKey="time" axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                        <YAxis axisLine={false} tickLine={false} tick={{fill: '#64748b', fontSize: 12}} />
                        <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                        <Line type="monotone" dataKey="demand" stroke="#0ea5e9" strokeWidth={3} dot={{r: 4, strokeWidth: 2}} activeDot={{r: 6}} fill="url(#colorDemand)" />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>

                {/* Admin Actions */}
                <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col gap-4">
                  <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                    <AlertTriangle size={20} className="text-amber-500" />
                    관리자 액션
                  </h3>
                  <div className="flex gap-4">
                    <button className="flex-1 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-semibold py-3 rounded-xl transition-colors">
                      수동 상태 변경 (Override)
                    </button>
                    <button className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl transition-colors shadow-sm shadow-blue-500/30">
                      근처 유저에게 분산 안내 발송
                    </button>
                  </div>
                </div>

              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <Building2 size={48} className="mb-4 opacity-50" />
                <p>좌측 목록에서 인프라를 선택하여 상세 정보를 확인하세요.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
