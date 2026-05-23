"use client";

import { useEffect, useRef, useState } from "react";

declare global {
  interface Window { kakao: any; }
}

export default function Home() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const [kakaoLoaded, setKakaoLoaded] = useState(false);

  useEffect(() => {
    // kakao가 이미 로드됐으면 바로 실행
    if (window.kakao?.maps) {
      setKakaoLoaded(true);
      return;
    }

    // 아직 로드 중이면 폴링으로 대기
    const interval = setInterval(() => {
      if (window.kakao?.maps) {
        setKakaoLoaded(true);
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!kakaoLoaded || !mapContainerRef.current) return;

    window.kakao.maps.load(() => {
      const options = {
        center: new window.kakao.maps.LatLng(35.1595, 129.0536),
        level: 3,
      };
      new window.kakao.maps.Map(mapContainerRef.current!, options);
    });
  }, [kakaoLoaded]);

  return (
    <main className="w-screen h-screen overflow-hidden bg-zinc-100">
      <div ref={mapContainerRef} className="w-full h-full" />
    </main>
  );
}