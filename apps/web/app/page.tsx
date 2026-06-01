'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

export default function LoadingPage() {
  const router = useRouter();
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Trigger fade-in animation shortly after mount
    const timer = setTimeout(() => {
      setIsVisible(true);
    }, 100);

    // Redirect to /setup after 3 seconds
    const redirectTimer = setTimeout(() => {
      router.push('/setup');
    }, 3000);

    return () => {
      clearTimeout(timer);
      clearTimeout(redirectTimer);
    };
  }, [router]);

  return (
    <div className="flex flex-col items-center justify-center min-h-[100dvh] relative overflow-hidden bg-[#0d1222]">
      {/* 
        사용자가 첨부한 원본 이미지를 띄우는 영역입니다. 
        public 폴더에 'splash.png' 이름으로 이미지를 넣으시면 바로 전체 화면으로 렌더링됩니다.
      */}
      <img 
        src="/splash.png" 
        alt="Splash Screen" 
        className="absolute inset-0 w-full h-full object-cover"
        style={{ zIndex: 0 }}
      />
    </div>
  );
}
