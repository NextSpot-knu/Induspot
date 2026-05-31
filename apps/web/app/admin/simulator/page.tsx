import React from 'react';
import TTTVSimulator from '@/components/admin/TTTVSimulator';
import Link from 'next/link';

export default function SimulatorPage() {
    return (
        <main className="min-h-screen bg-gray-50 p-8">
            <div className="max-w-7xl mx-auto space-y-6">
                {/* 상단 네비게이션 헤더 */}
                <div className="flex flex-col gap-2">
                    <Link
                        href="/admin"
                        className="text-sm font-semibold text-indigo-600 hover:text-indigo-800 transition-colors w-fit"
                    >
                        &larr; 관리자 메인 대시보드로 돌아가기
                    </Link>
                    <h1 className="text-3xl font-extrabold text-gray-900">TTTV 알고리즘 관제소</h1>
                    <p className="text-gray-500">추천 알고리즘(Preference, Time Cost, Incentive) 가중치 시뮬레이션 및 다봉 분포 분석</p>
                </div>

                {/* 시뮬레이터 컴포넌트 마운트 */}
                <TTTVSimulator />

            </div>
        </main>
    );
}