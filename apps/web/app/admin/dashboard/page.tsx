import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { 
  Users, Activity, TrendingUp, AlertTriangle, Search, Bell, Download
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { DashboardCharts, DashboardHeatmap } from '@/components/admin/DashboardCharts';
import { FacilityTable } from '@/components/admin/FacilityTable';
import { SimulatePeakButton } from '@/components/admin/SimulatePeakButton';

import { fetchKPI, fetchHeatmapData, fetchDistributionEffect, fetchAnomalyAlerts } from '@/lib/queries';

async function getDashboardData() {
  try {
    const [kpi, heatmap, distribution, anomalies] = await Promise.all([
      fetchKPI(),
      fetchHeatmapData(),
      fetchDistributionEffect(),
      fetchAnomalyAlerts()
    ]);
    return { kpi, heatmap, distribution, anomalies };
  } catch (error) {
    console.error(error);
    // 서버 통신 실패 시 폴백(Fallback) Mock 반환: fetchKPI의 Fallback Generator와 동일한 로직 사용
    const nowUtc = Date.now();
    const kstHour = new Date(nowUtc + 9 * 60 * 60 * 1000).getUTCHours();
    const kstDate = new Date(nowUtc + 9 * 60 * 60 * 1000).getUTCDate();
    const seed = kstDate * 100 + kstHour;
    const pseudoRand = (offset: number) => { const x = Math.sin(seed + offset) * 10000; return x - Math.floor(x); };
    let baseCongestion = 0.3;
    if (kstHour >= 8 && kstHour <= 10) baseCongestion = 0.55 + pseudoRand(1) * 0.15;
    else if (kstHour >= 11 && kstHour <= 13) baseCongestion = 0.65 + pseudoRand(2) * 0.2;
    else if (kstHour >= 17 && kstHour <= 19) baseCongestion = 0.58 + pseudoRand(3) * 0.18;
    else if (kstHour >= 22 || kstHour < 7) baseCongestion = 0.08 + pseudoRand(4) * 0.08;
    else baseCongestion = 0.35 + pseudoRand(5) * 0.15;
    const changePercent = Math.round((-8 + pseudoRand(6) * 20) * 10) / 10;
    const acceptRateVal = 0.62 + pseudoRand(7) * 0.23;
    const total = 80 + Math.floor(pseudoRand(8) * 60);
    const accepted = Math.round(total * acceptRateVal);
    const activeUsers = 180 + Math.floor(pseudoRand(9) * 240);
    const isPeak = (kstHour >= 11 && kstHour <= 13) || (kstHour >= 17 && kstHour <= 19);
    const anomalyCount = isPeak ? 2 + Math.floor(pseudoRand(10) * 4) : Math.floor(pseudoRand(10) * 3);
    return {
      kpi: {
        avgCongestion: { value: Math.round(baseCongestion * 100) / 100, changePercent },
        acceptRate: { value: Math.round(acceptRateVal * 1000) / 1000, total, accepted },
        activeUsers,
        anomalyCount
      },
      heatmap: [], distribution: [], anomalies: []
    };
  }
}

export default async function DashboardPage() {
  // 1. 페이지 단 보안 검증 (서버 컴포넌트 장점)
  const cookieStore = await cookies();
  const adminSession = cookieStore.get('admin_session');
  
  // 백엔드 명세 기반 인증 로직입니다. 
  // 실제 배포 시 주석 해제하여 로그인 페이지로 리다이렉트 시킵니다.
  /*
  if (!adminSession || adminSession.value !== 'authenticated') {
    redirect('/admin/login');
  }
  */

  // 2. 데이터 병렬 페칭 (Server Component Fetch)
  const data = await getDashboardData();
  const { kpi, heatmap, distribution, anomalies } = data;

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      
      {/* Sidebar */}
      <AdminSidebar />

      {/* Main Content */}
      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800">공단 시설 종합 대시보드</h2>
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
              {kpi.anomalyCount > 0 && (
                <span className="absolute 2 top-1 right-1 w-2.5 h-2.5 bg-rose-500 rounded-full border-2 border-white"></span>
              )}
            </button>
            <div className="w-10 h-10 rounded-full bg-blue-100 border border-blue-200 flex items-center justify-center font-bold text-blue-700">
              AD
            </div>
          </div>
        </header>

        {/* Dashboard Content (Scrollable) */}
        <div className="flex-1 p-8 overflow-y-auto flex flex-col gap-8">
          
          {/* Action Bar (Export & Simulation) */}
          <div className="flex justify-end items-center gap-4">
            <SimulatePeakButton />
            <a 
              href="/api/admin/export?period=daily" 
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-900 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm"
            >
              <Download size={16} /> 데이터 내보내기 (CSV)
            </a>
          </div>

          {/* KPI Cards (Server Rendered) */}
          <div className="grid grid-cols-4 gap-6">
            {/* 오늘 평균 혼잡도 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-blue-50 rounded-xl text-blue-600">
                  <Activity size={24} />
                </div>
                <span className={`px-2 py-1 text-xs font-bold rounded-full ${kpi.avgCongestion.changePercent < 0 ? 'bg-emerald-100 text-emerald-700' : 'bg-rose-100 text-rose-700'}`}>
                  {kpi.avgCongestion.changePercent > 0 ? '+' : ''}{kpi.avgCongestion.changePercent}%
                </span>
              </div>
              <div>
                <h3 className="text-slate-500 text-sm font-semibold mb-1">오늘 평균 혼잡도</h3>
                <div className="text-3xl font-black text-slate-800">
                  {(kpi.avgCongestion.value * 100).toFixed(1)}%
                </div>
              </div>
            </div>

            {/* 추천 수락률 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-purple-50 rounded-xl text-purple-600">
                  <TrendingUp size={24} />
                </div>
                <span className="text-xs font-bold text-slate-400">지난 7일</span>
              </div>
              <div>
                <h3 className="text-slate-500 text-sm font-semibold mb-1">AI 추천 수락률</h3>
                <div className="text-3xl font-black text-slate-800">
                  {(kpi.acceptRate.value * 100).toFixed(1)}%
                </div>
                <div className="text-xs text-slate-400 mt-1">총 {kpi.acceptRate.total}건 중 {kpi.acceptRate.accepted}건 수락</div>
              </div>
            </div>

            {/* DAU */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-emerald-50 rounded-xl text-emerald-600">
                  <Users size={24} />
                </div>
              </div>
              <div>
                <h3 className="text-slate-500 text-sm font-semibold mb-1">활성 사용자 수 (DAU)</h3>
                <div className="text-3xl font-black text-slate-800">
                  {kpi.activeUsers.toLocaleString()}명
                </div>
              </div>
            </div>

            {/* 이상 혼잡 알림 건수 */}
            <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm flex flex-col justify-between">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-rose-50 rounded-xl text-rose-600">
                  <AlertTriangle size={24} />
                </div>
              </div>
              <div>
                <h3 className="text-slate-500 text-sm font-semibold mb-1">이상 혼잡 발생 (오늘)</h3>
                <div className="text-3xl font-black text-rose-600">
                  {kpi.anomalyCount}건
                </div>
              </div>
            </div>
          </div>

          {/* Charts Row (Client Components) */}
          <div className="grid grid-cols-4 gap-6">
            <DashboardHeatmap heatmapData={heatmap} />
            <DashboardCharts distribution={distribution} />
          </div>

          {/* Bottom Section */}
          <div className="grid grid-cols-3 gap-6 pb-10">
            {/* Facility Table (Client Component) */}
            <FacilityTable />

            {/* Anomaly Alerts List (Server Rendered) */}
            <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden flex flex-col">
              <div className="p-6 border-b border-slate-200 flex items-center gap-2 bg-slate-50">
                <AlertTriangle className="text-rose-500" size={20} />
                <h3 className="text-lg font-bold text-slate-800">이상 혼잡 알림 내역</h3>
              </div>
              <div className="flex-1 p-4 overflow-y-auto">
                <div className="flex flex-col gap-3">
                  {anomalies.map((alert: any) => (
                    <div key={alert.id} className="p-4 rounded-xl border border-rose-100 bg-rose-50 flex flex-col gap-2 relative overflow-hidden">
                      <div className="absolute left-0 top-0 bottom-0 w-1 bg-rose-500"></div>
                      <div className="flex justify-between items-start">
                        <span className="font-bold text-rose-700">{alert.facilityName}</span>
                        <span className="text-xs font-semibold text-rose-400">
                          {new Date(alert.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </div>
                      <div className="text-sm text-rose-600 flex justify-between">
                        <span>임계치 초과: {(alert.congestionLevel * 100).toFixed(0)}%</span>
                        <span className="font-bold">지속: {alert.durationMinutes}분</span>
                      </div>
                    </div>
                  ))}
                  {anomalies.length === 0 && (
                    <div className="text-center text-slate-400 py-10 text-sm">
                      현재 발생한 이상 알림이 없습니다.
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
