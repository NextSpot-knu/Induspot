import React from "react";

export default function HomePage() {
  // 모의 데이터 (인프라 현황)
  const mockInfraList = [
    {
      id: "1",
      name: "제1 공동식당",
      type: "식당",
      occupancy: "82%",
      status: "혼잡",
      statusColor: "text-red-400 bg-red-500/10 border-red-500/20",
      recommendation: "제2 공동식당 (혼잡도 35%, 도보 4분, 예상 대기 시간 12분 단축)",
    },
    {
      id: "2",
      name: "중앙 화물 하역장 B구역",
      type: "하역장",
      occupancy: "95%",
      status: "포화",
      statusColor: "text-rose-500 bg-rose-500/10 border-rose-500/20",
      recommendation: "남부 하역장 A구역 (혼잡도 20%, 차량 3분 이동, 즉시 하역 가능)",
    },
    {
      id: "3",
      name: "본관 3층 대회의실",
      type: "회의실",
      occupancy: "40%",
      status: "여유",
      statusColor: "text-emerald-400 bg-emerald-500/10 border-emerald-500/20",
      recommendation: null,
    },
    {
      id: "4",
      name: "지상 C구역 공동주차장",
      type: "주차장",
      occupancy: "65%",
      status: "보통",
      statusColor: "text-amber-400 bg-amber-500/10 border-amber-500/20",
      recommendation: null,
    },
  ];

  return (
    <main className="min-height-screen bg-[#0a0f1e] text-white p-6 md:p-12 relative overflow-hidden">
      {/* Background radial glow */}
      <div className="absolute top-[-20%] left-[-10%] w-[600px] h-[600px] rounded-full bg-blue-500/10 blur-[120px] pointer-events-none" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[600px] h-[600px] rounded-full bg-purple-500/10 blur-[120px] pointer-events-none" />

      <div className="max-w-7xl mx-auto space-y-8 relative z-10">
        {/* Header */}
        <header className="flex flex-col md:flex-row justify-between items-start md:items-center border-b border-white/10 pb-6 gap-4">
          <div>
            <h1 className="text-3xl md:text-4xl font-extrabold tracking-tight">
              <span className="gradient-text">InduSpot</span>
            </h1>
            <p className="text-sm text-slate-400 mt-1">
              스마트 산업단지 인프라 수요 분산 및 TTTV 추천 AI 플랫폼
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
            <span className="text-xs text-emerald-400 font-medium">FastAPI & Supabase Connected</span>
          </div>
        </header>

        {/* Dashboard Grid */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Real-time Monitor Section */}
          <section className="lg:col-span-2 space-y-4">
            <h2 className="text-xl font-semibold text-slate-200">실시간 공용 인프라 혼잡도</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {mockInfraList.map((infra) => (
                <div
                  key={infra.id}
                  className="glass-panel p-5 rounded-2xl transition-all duration-300 hover:scale-[1.02] hover:border-white/10"
                >
                  <div className="flex justify-between items-start">
                    <div>
                      <span className="text-xs font-semibold text-sky-400 uppercase tracking-wider">
                        {infra.type}
                      </span>
                      <h3 className="text-lg font-bold mt-1 text-slate-100">{infra.name}</h3>
                    </div>
                    <span
                      className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${infra.statusColor}`}
                    >
                      {infra.status} ({infra.occupancy})
                    </span>
                  </div>

                  {/* Congestion Bar */}
                  <div className="w-full bg-white/5 h-2 rounded-full mt-4 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        infra.status === "포화"
                          ? "bg-rose-500"
                          : infra.status === "혼잡"
                          ? "bg-red-400"
                          : infra.status === "보통"
                          ? "bg-amber-400"
                          : "bg-emerald-400"
                      }`}
                      style={{ width: infra.occupancy }}
                    />
                  </div>

                  {/* Recommendation Alert */}
                  {infra.recommendation && (
                    <div className="mt-4 p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl text-xs text-sky-300 flex items-start gap-2">
                      <span className="font-bold text-sky-400">⚡ TTTV 추천대안:</span>
                      <span>{infra.recommendation}</span>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </section>

          {/* AI Recommendation Panel */}
          <section className="glass-panel p-6 rounded-3xl space-y-6 flex flex-col justify-between">
            <div className="space-y-4">
              <h2 className="text-xl font-bold tracking-tight text-transparent bg-clip-text bg-gradient-to-r from-sky-400 to-purple-400">
                TTTV (Total Time to Value)
              </h2>
              <p className="text-xs text-slate-400 leading-relaxed">
                TTTV 알고리즘은 산업단지 근로자의 이동 시간 및 인프라 대기 시간을 실시간으로 분석하여,
                체증 발생 시 가치 획득 시간(Value Time)을 극대화할 수 있는 즉각적인 대안을 매칭합니다.
              </p>
              <div className="border-t border-white/5 pt-4 space-y-3">
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">현재 단지 전체 혼잡도</span>
                  <span className="font-semibold text-red-400">주의 (70.5%)</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">평균 절약 대기 시간</span>
                  <span className="font-semibold text-emerald-400">14.8 분</span>
                </div>
                <div className="flex justify-between text-xs">
                  <span className="text-slate-400">AI 추천 수락률</span>
                  <span className="font-semibold text-purple-400">88.4%</span>
                </div>
              </div>
            </div>

            <div className="pt-6 border-t border-white/5">
              <button
                id="btn-analysis"
                className="w-full py-3 bg-gradient-to-r from-sky-500 to-purple-600 rounded-xl font-semibold text-sm transition-all duration-300 hover:opacity-90 hover:shadow-lg hover:shadow-blue-500/20 active:scale-[0.98]"
              >
                인프라 최적 경로 분석 시작
              </button>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
}
