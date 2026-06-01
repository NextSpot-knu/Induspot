'use client';

import React, { useState } from 'react';
import { Play } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function SimulatePeakButton() {
  const router = useRouter();
  const [isSimulating, setIsSimulating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleSimulate = async () => {
    setIsSimulating(true);
    setMessage(null);
    try {
      const res = await fetch('/api/admin/simulate-peak', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const data = await res.json();
      if (res.ok) {
        setMessage('24시간 모의 데이터 생성 완료! 대시보드를 새로고침합니다.');
        // Refresh page data to fetch the newly generated logs
        router.refresh();
        setTimeout(() => setMessage(null), 4000);
      } else {
        setMessage(`시뮬레이션 실패: ${data.detail || '알 수 없는 오류'}`);
        setTimeout(() => setMessage(null), 5000);
      }
    } catch (err) {
      console.error(err);
      setMessage('네트워크 오류가 발생했습니다.');
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
