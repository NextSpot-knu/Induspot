'use client';

import { useState } from 'react';
import { 
  Search, Bell, Settings as SettingsIcon, Shield, Sliders, Save, Database, AlertCircle 
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';

export default function SettingsPage() {
  const [isMaintenance, setIsMaintenance] = useState(false);
  const [threshold, setThreshold] = useState(80);
  const [weight, setWeight] = useState(50);
  
  const handleSave = () => {
    alert('시스템 설정이 성공적으로 저장되었습니다. (Mocking)');
  };

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <AdminSidebar />

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800">시스템 설정</h2>
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search settings..." 
                className="pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
            </div>
            <button className="relative text-slate-500 hover:text-slate-700">
              <Bell size={24} />
            </button>
          </div>
        </header>

        {/* Settings Content */}
        <div className="flex-1 p-8 overflow-y-auto">
          <div className="max-w-4xl mx-auto flex flex-col gap-8 pb-20">
            
            {/* Header Area */}
            <div className="flex justify-between items-end">
              <div>
                <h3 className="text-2xl font-bold text-slate-800 mb-2">환경 설정</h3>
                <p className="text-slate-500">앱 서비스의 상태 및 AI 추천 알고리즘의 세부 파라미터를 조정합니다.</p>
              </div>
              <button 
                onClick={handleSave}
                className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-6 py-2.5 rounded-xl font-bold shadow-sm shadow-blue-500/20 transition-colors"
              >
                <Save size={18} /> 변경사항 저장
              </button>
            </div>

            {/* Section A: 일반 설정 */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
                <SettingsIcon size={20} className="text-slate-500" />
                <h4 className="font-bold text-slate-800">일반 설정 (General)</h4>
              </div>
              <div className="p-6 flex flex-col gap-6">
                
                {/* Maintenance Toggle */}
                <div className="flex items-center justify-between">
                  <div>
                    <h5 className="font-bold text-slate-800 mb-1">서비스 점검 모드</h5>
                    <p className="text-sm text-slate-500">점검 모드를 활성화하면 사용자들의 앱 접속이 제한되고 공지사항이 표시됩니다.</p>
                  </div>
                  <button 
                    onClick={() => setIsMaintenance(!isMaintenance)}
                    className={`w-14 h-7 rounded-full p-1 transition-colors ${isMaintenance ? 'bg-rose-500' : 'bg-slate-300'}`}
                  >
                    <div className={`w-5 h-5 bg-white rounded-full shadow-sm transform transition-transform ${isMaintenance ? 'translate-x-7' : 'translate-x-0'}`} />
                  </button>
                </div>

                {/* Notice Input */}
                <div>
                  <h5 className="font-bold text-slate-800 mb-2">앱 상단 고정 공지사항</h5>
                  <input 
                    type="text" 
                    defaultValue="현재 구내식당 메뉴 개편으로 인해 관련 데이터가 부정확할 수 있습니다."
                    className="w-full bg-slate-50 border border-slate-200 rounded-lg px-4 py-3 text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
            </section>

            {/* Section B: AI 추천 엔진 설정 */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden border-l-4 border-l-purple-500">
              <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Sliders size={20} className="text-purple-600" />
                  <h4 className="font-bold text-slate-800">AI 추천 알고리즘 설정</h4>
                </div>
                <span className="text-xs font-bold px-2 py-1 bg-purple-100 text-purple-700 rounded-md">
                  CORE CONFIG
                </span>
              </div>
              <div className="p-6 flex flex-col gap-8">
                
                {/* Threshold Slider */}
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <div>
                      <h5 className="font-bold text-slate-800 mb-1">혼잡도 임계값 (Congestion Threshold)</h5>
                      <p className="text-sm text-slate-500">인프라 수용량 대비 몇 %일 때 '혼잡(Red)' 상태로 판단할지 설정합니다.</p>
                    </div>
                    <span className="text-2xl font-black text-rose-600">{threshold}%</span>
                  </div>
                  <input 
                    type="range" 
                    min="50" max="100" 
                    value={threshold} 
                    onChange={(e) => setThreshold(Number(e.target.value))}
                    className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-rose-500"
                  />
                  <div className="flex justify-between text-xs text-slate-400 mt-2 font-medium">
                    <span>50% (매우 민감)</span>
                    <span>100% (둔감)</span>
                  </div>
                </div>

                {/* Weight Slider */}
                <div>
                  <div className="flex justify-between items-end mb-2">
                    <div>
                      <h5 className="font-bold text-slate-800 mb-1">콜드 스타트 방지 데이터 가중치</h5>
                      <p className="text-sm text-slate-500">추천 시 '실시간 빈자리'와 '유저 온보딩 선호도' 중 어느 쪽에 가중치를 둘지 설정합니다.</p>
                    </div>
                  </div>
                  <div className="relative pt-4">
                    <input 
                      type="range" 
                      min="0" max="100" 
                      value={weight} 
                      onChange={(e) => setWeight(Number(e.target.value))}
                      className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-purple-600"
                    />
                    <div className="flex justify-between text-xs font-bold mt-3">
                      <span className={weight < 50 ? 'text-purple-600' : 'text-slate-400'}>실시간 빈자리 우선</span>
                      <span className={weight === 50 ? 'text-purple-600' : 'text-slate-400'}>균형 50:50</span>
                      <span className={weight > 50 ? 'text-purple-600' : 'text-slate-400'}>개인 선호도 우선</span>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            {/* Section C: 데이터베이스 & 권한 */}
            <section className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
              <div className="p-5 border-b border-slate-200 bg-slate-50/50 flex items-center gap-2">
                <Database size={20} className="text-slate-500" />
                <h4 className="font-bold text-slate-800">데이터 동기화 및 관리</h4>
              </div>
              <div className="p-6">
                <div className="flex items-center justify-between p-4 bg-slate-50 border border-slate-200 rounded-xl">
                  <div className="flex items-center gap-3">
                    <AlertCircle size={20} className="text-amber-500" />
                    <div>
                      <h5 className="font-bold text-slate-800 text-sm">Redis 캐시 초기화</h5>
                      <p className="text-xs text-slate-500">지도 데이터 로딩이 느릴 때 수동으로 캐시를 비웁니다.</p>
                    </div>
                  </div>
                  <button className="px-4 py-2 bg-white border border-slate-300 hover:bg-slate-100 text-slate-700 text-sm font-semibold rounded-lg transition-colors">
                    캐시 삭제
                  </button>
                </div>
              </div>
            </section>

          </div>
        </div>
      </main>
    </div>
  );
}
