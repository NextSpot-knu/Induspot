'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Home, Bookmark, User } from 'lucide-react';
import { motion } from 'framer-motion';

export default function BottomNav() {
  const pathname = usePathname();
  const router = useRouter();

  // 루트 경로나 지원하지 않는 경로에서는 네비게이션 바 숨김 처리
  if (!pathname || pathname === '/' || pathname.includes('/admin') || pathname.includes('/setup')) return null;

  const tabs = [
    { id: 'Home', icon: Home, label: 'Home', path: '/main' },
    { id: 'Saved', icon: Bookmark, label: 'Saved', path: '/saved' },
    { id: 'MyPage', icon: User, label: 'My Page', path: '/mypage' }
  ];

  const getActiveTab = () => {
    if (pathname.includes('/saved')) return 'Saved';
    if (pathname.includes('/mypage')) return 'MyPage';
    return 'Home'; // default
  };

  const activeTab = getActiveTab();

  return (
    <div className="fixed bottom-0 w-full z-[100] bg-[#0b101e]/90 backdrop-blur-xl border-t border-white/10 px-6 py-4 pb-8 flex justify-around items-center">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const isActive = activeTab === tab.id;
        return (
          <button
            key={tab.id}
            onClick={() => router.push(tab.path)}
            className={`relative flex flex-col items-center justify-center transition-colors w-16 h-16 ${
              isActive ? 'text-[#104bce]' : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            {isActive && (
              <motion.div
                layoutId="bottom-nav-indicator"
                className="absolute inset-0 bg-[#104bce]/10 rounded-2xl"
                initial={false}
                transition={{
                  type: "spring",
                  stiffness: 500,
                  damping: 30
                }}
              />
            )}
            <div className="relative z-10 flex flex-col items-center justify-center">
              <div className="mb-1">
                <Icon size={24} className={isActive ? 'text-[#104bce]' : 'text-gray-500'} />
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-[#104bce]' : ''}`}>
                {tab.label}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
