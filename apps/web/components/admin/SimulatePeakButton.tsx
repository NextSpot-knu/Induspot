'use client';

import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiClient } from '@/lib/api-client';

export function SimulatePeakButton() {
  const router = useRouter();
  const [isSimulating, setIsSimulating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSimulate = async () => {
    setIsSimulating(true);
    setMessage(null);
    try {
      // 정적 export 에서는 Next 라우트(/api/admin/simulate-peak)가 없으므로 백엔드(FastAPI)를 직접 호출.
      // apiClient 가 Supabase JWT 를 자동 첨부하고, 백엔드는 require_admin 으로 role 을 재검증한다.
      await apiClient.post('/api/v1/admin/simulate-peak');
      setMessage('24시간 모의 데이터 생성 완료! 대시보드를 새로고침합니다.');
      router.refresh();
      setTimeout(() => setMessage(null), 4000);
    } catch (err: any) {
      setMessage(`시뮬레이션 실패: ${err?.message || '알 수 없는 오류'}`);
      setTimeout(() => setMessage(null), 5000);
    } finally {
      setIsSimulating(false);
    }
  };

  return (
    <div className="flex items-center gap-4">
      {message && (
        <span className={`text-xs font-bold transition-all ${message.includes('완료') ? 'text-emerald-600 animate-pulse' : 'text-rose-600'}`}>
          {message}
        </span>
      )}
      <button
        onClick={handleSimulate}
        disabled={isSimulating}
        className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-semibold rounded-lg shadow-sm transition-colors text-sm cursor-pointer"
      >
        <Play size={16} fill="currentColor" />
        {isSimulating ? '모의 데이터 생성 중...' : '24시간 데이터 모의 발생'}
      </button>
    </div>
  );
}
