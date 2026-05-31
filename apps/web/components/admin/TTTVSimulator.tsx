'use client';

import React, { useState, useMemo } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function TTTVSimulator() {
    // 슬라이더 조작용 가중치 상태 (기본값: 선호도 40, 시간 40, 인센티브 20)
    const [weights, setWeights] = useState({ pref: 40, time: 40, inc: 20 });

    // 1. 1000개의 모의 시설 데이터(Fact) 정적 생성 (최초 1회만 연산)
    const mockFacilities = useMemo(() => {
        return Array.from({ length: 1000 }, () => {
            // 선호도 (양봉 분포: 30% 확률로 취향 일치, 70% 확률로 불일치)
            const pref = Math.random() < 0.3 ? 0.8 + Math.random() * 0.2 : Math.random() * 0.2;
            // 시간비용 (비대칭 연속: 80%가 도보 15분 이내의 가까운 거리)
            const time = Math.random() < 0.8 ? 0.1 + Math.random() * 0.3 : 0.4 + Math.random() * 0.6;
            // 인센티브 (0점 스파이크: 60%는 혼잡해서 0점, 40%는 여유로워 가산점 획득)
            const inc = Math.random() < 0.6 ? 0 : 0.2 + Math.random() * 0.6;
            return { pref, time, inc };
        });
    }, []);

    // 2. 가중치 정규화 및 실시간 TTTV 스코어 재연산
    const { chartData, analysisText } = useMemo(() => {
        const totalW = weights.pref + weights.time + weights.inc;
        const wp = weights.pref / totalW;
        const wt = weights.time / totalW;
        const wi = weights.inc / totalW;

        const bins = Array.from({ length: 10 }, (_, i) => ({
            name: `${i * 10}점대`,
            count: 0,
        }));

        mockFacilities.forEach((f) => {
            // Raw Score 계산 (패널티 차감 방식)
            const raw = f.pref * wp - f.time * wt + f.inc * wi;
            // 0~100 스케일 정규화 (Min-Max Scaling 적용)
            const normalized = Math.max(0, Math.min(100, ((raw + wt) / (wp + wt + wi)) * 100));
            const binIndex = Math.min(Math.floor(normalized / 10), 9);
            bins[binIndex].count += 1;
        });

        // 3. 현재 가중치 상태에 따른 동적 분석 텍스트 도출
        let analysis = "현재 이상적인 다봉 분포가 형성되어 있습니다. 무관한 시설(저점)과 추천 시설(고점)이 뚜렷이 구분됩니다.";
        if (wp > 0.6) analysis = "선호도 가중치가 과도하게 높습니다. 거리가 멀어도 취향만 맞으면 추천되는 극단적 양극화(U자 분포)가 발생합니다.";
        if (wt > 0.6) analysis = "시간 비용 가중치가 지배적입니다. 취향이나 혼잡도를 무시하고 무조건 가까운 곳만 추천(저점 쏠림 현상)하게 됩니다.";
        if (wi > 0.5) analysis = "인센티브 가중치가 높아 원본 시설 혼잡도에 의존하는 경향이 짙어집니다. 0점대 장벽이 우측으로 무너집니다.";

        return { chartData: bins, analysisText: analysis };
    }, [weights, mockFacilities]);

    // 가중치 핸들러
    const handleWeightChange = (key: 'pref' | 'time' | 'inc', value: string) => {
        setWeights((prev) => ({ ...prev, [key]: Number(value) }));
    };

    const total = weights.pref + weights.time + weights.inc;

    return (
        <div className="w-full bg-white p-6 rounded-xl shadow-sm border border-gray-200">
            <div className="mb-6 border-b pb-4">
                <h2 className="text-xl font-bold text-gray-800">TTTV 알고리즘 파라미터 시뮬레이터</h2>
                <p className="text-sm text-gray-500 mt-1">슬라이더를 조작하여 가중치 변화에 따른 추천 점수(1,000개 모의 시설)의 군집화 현상을 실시간으로 검증하십시오.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                {/* 왼쪽: 컨트롤 패널 */}
                <div className="flex flex-col gap-6 lg:col-span-1 border-r pr-6">
                    <WeightSlider label="선호도 일치율 가중치" value={weights.pref} total={total} color="bg-blue-500" onChange={(v) => handleWeightChange('pref', v)} />
                    <WeightSlider label="시간 비용 패널티 가중치" value={weights.time} total={total} color="bg-red-500" onChange={(v) => handleWeightChange('time', v)} />
                    <WeightSlider label="혼잡 분산 인센티브 가중치" value={weights.inc} total={total} color="bg-green-500" onChange={(v) => handleWeightChange('inc', v)} />

                    <div className="mt-4 p-4 bg-gray-50 rounded-lg border border-gray-100">
                        <h4 className="text-xs font-bold text-gray-400 mb-1">실시간 분석 리포트</h4>
                        <p className="text-sm text-gray-700 font-medium leading-relaxed">{analysisText}</p>
                    </div>
                </div>

                {/* 오른쪽: 히스토그램 렌더링 */}
                <div className="lg:col-span-2 h-[400px]">
                    <ResponsiveContainer width="100%" height="100%">
                        <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                            <defs>
                                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                                    <stop offset="5%" stopColor="#4f46e5" stopOpacity={0.4} />
                                    <stop offset="95%" stopColor="#4f46e5" stopOpacity={0} />
                                </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                            <XAxis dataKey="name" tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                            <YAxis tick={{ fontSize: 12, fill: '#6b7280' }} tickLine={false} axisLine={false} />
                            <Tooltip contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            <Area type="monotone" dataKey="count" stroke="#4f46e5" strokeWidth={3} fillOpacity={1} fill="url(#colorCount)" animationDuration={300} />
                        </AreaChart>
                    </ResponsiveContainer>
                </div>
            </div>
        </div>
    );
}

// 하위 슬라이더 컴포넌트
function WeightSlider({ label, value, total, color, onChange }: { label: string, value: number, total: number, color: string, onChange: (val: string) => void }) {
    const percentage = Math.round((value / total) * 100) || 0;
    return (
        <div className="flex flex-col gap-2">
            <div className="flex justify-between items-end">
                <label className="text-sm font-semibold text-gray-700">{label}</label>
                <span className={`text-xs font-bold px-2 py-1 rounded text-white ${color}`}>{percentage}%</span>
            </div>
            <input
                type="range" min="0" max="100" value={value} onChange={(e) => onChange(e.target.value)}
                className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-indigo-600"
            />
        </div>
    );
}