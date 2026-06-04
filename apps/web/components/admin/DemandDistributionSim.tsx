'use client';

import { useMemo, useState } from 'react';
import { Shuffle, TrendingDown, Layers } from 'lucide-react';

// 수요 분산 시뮬레이션 (전/후) — 발표 슬라이드 08 "분산 적용 전/후 대비" 의 데이터 기반 구현.
//
// 입력: 오늘 시설별 '피크 혼잡'(대시보드 computeFacilityPeaks 가 히트맵에서 도출). isRealData=실측 로그 기반 여부.
//   합성 가짜 추세선이 아니라 현재 쏠림 상태에서 출발한다.
// 모델(정직성): 사용자가 추천을 따라 '인근 한산 시설'로 이동하면 같은 종류 시설의 부하가 평균으로 수렴한다.
//   after_i = before_i + α·(평균 − before_i),  α = 추천 수용률 가정(0.6).
//   before_i∈[0,1]이면 after_i = 0.4·before_i + 0.6·평균 도 [0,1] 볼록결합 → Σafter = Σbefore (총량 보존).
//   수요를 '없애는' 게 아니라 '옮기는' 분산이라 총량 불변. 결과: 피크↓·유휴↑·쏠림폭↓. α 가정은 화면에 명시.

type Peak = { facility: string; facilityType: string; peak: number };

const TYPES = [
  { id: 'cafeteria', name: '식당' },
  { id: 'parking', name: '주차장' },
  { id: 'meeting_room', name: '회의실' },
  { id: 'rest_area', name: '휴게실' },
];
const ALPHA = 0.6; // 추천 수용률 가정(시뮬레이션 파라미터, 화면에 명시)
const MAX_ROWS = 10;

function signalColor(v: number): string {
  if (v >= 0.75) return '#f43f5e'; // 혼잡(빨강)
  if (v >= 0.5) return '#f59e0b';  // 보통(노랑)
  if (v >= 0.25) return '#10b981'; // 여유(초록)
  return '#3b82f6';                // 한산(파랑)
}

export function DemandDistributionSim({ peaks, isRealData }: { peaks: Peak[]; isRealData?: boolean }) {
  const [type, setType] = useState('cafeteria');

  const { rows, metrics, hasData } = useMemo(() => {
    const list = (peaks || [])
      .filter((p) => p && p.facilityType === type && typeof p.peak === 'number' && p.peak >= 0)
      .map((p) => ({ facility: p.facility, peak: Math.min(1, p.peak) })); // 입력 도메인 [0,1] 보장(보존 불변식 유지)
    if (list.length < 2) return { rows: [] as any[], metrics: null as any, hasData: false };
    const avg = list.reduce((s, p) => s + p.peak, 0) / list.length;
    const rows = list
      .map((p) => ({
        facility: p.facility,
        before: p.peak,
        after: Math.max(0, Math.min(1, p.peak + ALPHA * (avg - p.peak))),
      }))
      .sort((a, b) => b.before - a.before);

    const befores = rows.map((r) => r.before);
    const afters = rows.map((r) => r.after);
    // 표시 정수 %를 한 번만 산출 — 헤드라인과 차이 배지가 같은 정수에서 유도되도록(독립 반올림 자기모순 방지).
    const pkB = Math.round(Math.max(...befores) * 100);
    const pkA = Math.round(Math.max(...afters) * 100);
    const spB = Math.round((Math.max(...befores) - Math.min(...befores)) * 100);
    const spA = Math.round((Math.max(...afters) - Math.min(...afters)) * 100);
    const overBefore = rows.filter((r) => r.before >= 0.75).length; // 과밀(≥75%) 시설 수
    const overAfter = rows.filter((r) => r.after >= 0.75).length;

    return { rows, hasData: true, metrics: { pkB, pkA, spB, spA, overBefore, overAfter, count: rows.length } };
  }, [peaks, type]);

  const shown = rows.slice(0, MAX_ROWS);
  const dPeak = metrics ? metrics.pkB - metrics.pkA : 0;       // 항상 ≥0 (max_after ≤ max_before)
  const dSpread = metrics ? metrics.spB - metrics.spA : 0;     // 항상 ≥0 (평균 수렴)

  return (
    <div className="bg-slate-900 p-6 rounded-2xl border border-slate-800 shadow-sm col-span-4 flex flex-col gap-5">
      {/* 헤더 + 가정 배지 + 종류 탭 */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-2 flex-wrap">
          <Shuffle className="text-blue-400" size={20} />
          <h3 className="text-lg font-bold text-slate-100">수요 분산 시뮬레이션 — 추천 수용 시 도달 가능한 균형</h3>
          <span className="px-2 py-0.5 text-[10px] font-bold rounded-full bg-amber-500/15 text-amber-300 border border-amber-500/25">
            가정 시뮬레이션 · 수용률 {Math.round(ALPHA * 100)}%
          </span>
          <span className={`px-2 py-0.5 text-[10px] font-semibold rounded-full border ${isRealData ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/25' : 'bg-slate-700/40 text-slate-400 border-slate-600/40'}`}>
            {isRealData ? '실측 피크 기반' : '데모 합성 데이터'}
          </span>
        </div>
        <div className="flex gap-2">
          {TYPES.map((t) => (
            <button
              key={t.id}
              onClick={() => setType(t.id)}
              className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-all ${
                type === t.id
                  ? 'bg-blue-500/10 border-blue-500/30 text-blue-300 font-bold'
                  : 'bg-slate-800 border-slate-700 text-slate-300 hover:bg-slate-700'
              }`}
            >
              {t.name}
            </button>
          ))}
        </div>
      </div>

      {!hasData || !metrics ? (
        <div className="h-40 flex items-center justify-center text-slate-500 text-sm">
          해당 종류는 비교할 시설이 2개 이상 필요합니다.
        </div>
      ) : (
        <>
          {/* 효과 요약 카드 (전 → 후, 가정 시뮬레이션) */}
          <div className="grid grid-cols-3 gap-4">
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold mb-2">
                <TrendingDown size={14} className="text-emerald-400" /> 최고 혼잡(피크)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">{metrics.pkB}%</span>
                <span className="text-slate-500">→</span>
                <span className="text-2xl font-black text-blue-400">{metrics.pkA}%</span>
              </div>
              <div className={`text-[11px] font-semibold mt-1 ${dPeak > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                {dPeak > 0 ? `~${dPeak}%p 완화 (가정)` : '변화 미미'}
              </div>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold mb-2">
                <Layers size={14} className="text-sky-400" /> 쏠림 폭(최고−최저)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">{metrics.spB}%</span>
                <span className="text-slate-500">→</span>
                <span className="text-2xl font-black text-blue-400">{metrics.spA}%</span>
              </div>
              <div className={`text-[11px] font-semibold mt-1 ${dSpread > 0 ? 'text-emerald-300' : 'text-slate-500'}`}>
                {dSpread > 0 ? `과밀·유휴 격차 ~${dSpread}%p 축소 (가정)` : '변화 미미'}
              </div>
            </div>
            <div className="bg-slate-950/40 border border-white/5 rounded-xl p-4">
              <div className="flex items-center gap-1.5 text-slate-400 text-xs font-semibold mb-2">
                <span className="w-3 h-3 rounded-sm bg-rose-500 inline-block" /> 과밀 시설(≥75%)
              </div>
              <div className="flex items-baseline gap-2">
                <span className="text-2xl font-black text-rose-400">{metrics.overBefore}곳</span>
                <span className="text-slate-500">→</span>
                <span className="text-2xl font-black text-blue-400">{metrics.overAfter}곳</span>
              </div>
              <div className="text-[11px] text-slate-400 mt-1">총 {metrics.count}곳 중</div>
            </div>
          </div>

          {/* 시설별 전/후 막대 (현재 쏠림 → 분산) */}
          <div className="flex flex-col gap-2.5 mt-1">
            <div className="flex items-center justify-between text-[11px] text-slate-500 px-1">
              <span>시설별 피크 혼잡 — <span className="text-slate-400">위:현재(전)</span> / <span className="text-blue-300">아래:분산 후(가정)</span></span>
              <span>혼잡도</span>
            </div>
            {shown.map((r) => (
              <div key={r.facility} className="flex items-center gap-3">
                <div className="w-32 text-xs font-semibold text-slate-200 truncate text-right pr-1" title={r.facility}>
                  {r.facility}
                </div>
                <div className="flex-1 flex flex-col gap-1">
                  {/* 전 */}
                  <div className="h-3.5 bg-slate-950/50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, r.before * 100)}%`, backgroundColor: signalColor(r.before), opacity: 0.85 }} />
                  </div>
                  {/* 후 */}
                  <div className="h-3.5 bg-slate-950/50 rounded-full overflow-hidden">
                    <div className="h-full rounded-full transition-all" style={{ width: `${Math.max(2, r.after * 100)}%`, backgroundColor: signalColor(r.after) }} />
                  </div>
                </div>
                <div className="w-24 text-[11px] font-mono text-right flex items-center justify-end gap-1">
                  <span className="text-rose-300/80">{Math.round(r.before * 100)}%</span>
                  <span className="text-slate-600">→</span>
                  <span className="text-blue-300 font-bold">{Math.round(r.after * 100)}%</span>
                </div>
              </div>
            ))}
            {rows.length > MAX_ROWS && (
              <div className="text-[11px] text-slate-500 text-center pt-1">
                혼잡 상위 {MAX_ROWS}곳 표시 · 전체 {metrics.count}곳 (요약 수치는 전체 기준)
              </div>
            )}
          </div>

          {/* 정직성 명시 */}
          <p className="text-[11px] text-slate-500 leading-relaxed border-t border-slate-800 pt-3">
            {isRealData
              ? <>오늘 <b className="text-slate-400">시설별 피크 혼잡(실측 로그)</b>에서 출발해, </>
              : <>오늘 로그가 충분치 않아 <b className="text-slate-400">데모용 합성 피크</b>에서 출발해, </>}
            사용자가 추천을 따라 인근 한산 시설로 이동한다고 <b className="text-slate-400">가정(수용률 {Math.round(ALPHA * 100)}%)</b>했을 때 도달하는 균형 상태입니다.
            수요는 사라지지 않고 <b className="text-slate-400">옮겨질 뿐</b>이라 총량은 보존됩니다(전·후 합 동일). 실제 효과는 수용률에 따라 달라지는 추정치입니다.
          </p>
        </>
      )}
    </div>
  );
}
