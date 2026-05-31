'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Menu, Bell, Home, Bookmark, User, Compass, Star } from 'lucide-react';
import { RecommendationCard } from '@/components/RecommendationCard';

interface BookmarkData {
  id: string;
  name: string;
  category: string;
  trafficStatus: 'red' | 'yellow' | 'green';
  waitTime: string;
  latitude?: number;
  longitude?: number;
  tttv?: any;
}

export default function SavedPage() {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState('Saved');
  const [bookmarks, setBookmarks] = useState<BookmarkData[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedBookmark, setSelectedBookmark] = useState<BookmarkData | null>(null);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
  };

  useEffect(() => {
    if (toastMessage) {
      const timer = setTimeout(() => {
        setToastMessage(null);
      }, 3000);
      return () => clearTimeout(timer);
    }
  }, [toastMessage]);

  useEffect(() => {
    // API Fetch Mockup
    // ⚠️ 백엔드 데이터 하드코딩 금지 원칙 준수
    // 실제로는 fetch('/api/bookmarks') 등을 통해 데이터를 가져옴
    const fetchBookmarks = async () => {
      setIsLoading(true);
      try {
        const saved = localStorage.getItem('induspot_saved_facilities');
        if (saved) {
          const parsed = JSON.parse(saved);
          const compareBookmarks = (a: any, b: any) => {
            if (!a.tttv || !b.tttv) return (a.name || '').localeCompare(b.name || '', 'ko-KR');
            if (b.tttv.score !== a.tttv.score) return b.tttv.score - a.tttv.score;
            if (a.tttv.timeToService !== b.tttv.timeToService) return a.tttv.timeToService - b.tttv.timeToService;
            if (b.tttv.preferencePercent !== a.tttv.preferencePercent) return b.tttv.preferencePercent - a.tttv.preferencePercent;
            if (a.tttv.expectedTravel !== b.tttv.expectedTravel) return a.tttv.expectedTravel - b.tttv.expectedTravel;
            return (a.name || '').localeCompare(b.name || '', 'ko-KR');
          };
          parsed.sort(compareBookmarks);
          setBookmarks(parsed);
        } else {
          setBookmarks([]);
        }
      } catch (error) {
        console.error('Failed to fetch bookmarks', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchBookmarks();
  }, []);

  const handleTabClick = (tabId: string) => {
    setActiveTab(tabId);
    if (tabId === 'Home') router.push('/main');
    if (tabId === 'Saved') router.push('/saved');
    if (tabId === 'MyPage') router.push('/mypage');
  };

  const renderTrafficIndicator = (status: 'red' | 'yellow' | 'green') => {
    const colors = {
      red: 'bg-red-500 shadow-[0_0_8px_rgba(239,68,68,0.8)]',
      yellow: 'bg-yellow-500 shadow-[0_0_8px_rgba(234,179,8,0.8)]',
      green: 'bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.8)]'
    };
    return <div className={`w-3 h-3 rounded-full ${colors[status]}`} />;
  };

  return (
    <div className="relative w-full min-h-screen bg-[url('/bg.png')] bg-cover bg-center flex flex-col overflow-hidden">
      {/* Dark overlay for readability */}
      <div className="absolute inset-0 bg-[#0b101e]/70 z-0"></div>

      {/* Header */}
      <header className="flex justify-between items-center p-5 border-b border-white/10 z-10 relative">
        <button className="text-gray-400 hover:text-white transition-colors">
          <Menu size={24} />
        </button>
        <h1 className="text-xl font-bold text-white tracking-wide">InduSpot</h1>
        <button className="text-gray-400 hover:text-white transition-colors">
          <Bell size={24} />
        </button>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex flex-col relative z-10 p-6 overflow-y-auto pb-[120px]">
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center">
            <div className="w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
          </div>
        ) : bookmarks.length === 0 ? (
          // Empty State
          <div className="flex-1 flex items-center justify-center">
            <div className="bg-[#1a2333]/60 backdrop-blur-2xl border border-white/5 rounded-3xl p-8 flex flex-col items-center text-center w-full max-w-[320px] shadow-2xl">
              <div className="w-16 h-16 rounded-full bg-gradient-to-b from-[#3b4766] to-[#25304a] border border-white/10 flex items-center justify-center mb-6 shadow-inner">
                <Star className="text-blue-200 fill-blue-200/50" size={32} />
              </div>
              <h2 className="text-xl font-bold text-white mb-3">No saved locations yet</h2>
              <p className="text-gray-400 text-sm leading-relaxed mb-8 px-2">
                Locations you pin across the industrial complex will securely appear here.
              </p>
              <button 
                onClick={() => router.push('/main')}
                className="flex items-center gap-2 px-5 py-2.5 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-white text-sm font-semibold transition-all"
              >
                <Compass size={18} className="text-gray-300" />
                <span>Browse Map</span>
              </button>
            </div>
          </div>
        ) : (
          // List State
          <div className="flex flex-col gap-4">
            {bookmarks.map((bookmark, index) => (
              <button
                key={bookmark.id}
                onClick={() => setSelectedBookmark(bookmark)}
                className={`flex justify-between items-center p-4 rounded-2xl border backdrop-blur-md transition-all text-left relative overflow-hidden ${
                  selectedBookmark?.id === bookmark.id
                    ? 'bg-blue-600/20 border-blue-500'
                    : 'bg-white/5 border-white/10 hover:bg-white/10'
                }`}
              >
                {/* 랭크 표시 뱃지 */}
                <div className="absolute top-0 left-0 bg-blue-600/80 backdrop-blur-sm text-white text-[10px] font-bold px-2 py-1 rounded-br-lg z-10">
                  {index + 1}위
                </div>
                
                <div className="pl-4">
                  <div className="flex items-center gap-2 mb-1 mt-1">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-md bg-white/10 text-gray-300">
                      {bookmark.category}
                    </span>
                    {renderTrafficIndicator(bookmark.trafficStatus)}
                  </div>
                  <h3 className="text-lg font-bold text-white">{bookmark.name}</h3>
                </div>
                <div className="text-right">
                  <div className="text-sm font-medium text-gray-300 mb-1">Wait Time</div>
                  <div className="text-lg font-bold text-white">{bookmark.waitTime}</div>
                </div>
              </button>
            ))}
          </div>
        )}
      </main>

      {/* Selected Item Detail Bottom Sheet (RecommendationCard) */}
      {selectedBookmark && (
        <div className="absolute bottom-[90px] w-full z-20 px-4 animate-slide-up">
          <RecommendationCard 
            title={selectedBookmark.name}
            matchPercentage={100}
            description={`현재 혼잡도: ${selectedBookmark.trafficStatus === 'red' ? '혼잡' : selectedBookmark.trafficStatus === 'yellow' ? '보통' : '여유'}. 예상 대기 시간: ${selectedBookmark.waitTime}.`}
            onAccept={() => {
              const destUrl = selectedBookmark.latitude && selectedBookmark.longitude
                ? `https://map.kakao.com/link/to/${encodeURIComponent(selectedBookmark.name)},${selectedBookmark.latitude},${selectedBookmark.longitude}`
                : `https://map.kakao.com/?q=${encodeURIComponent(selectedBookmark.name)}`;
              window.open(destUrl, '_blank');
            }}
            onReject={() => {
              const updated = bookmarks.filter(b => b.id !== selectedBookmark.id);
              setBookmarks(updated);
              localStorage.setItem('induspot_saved_facilities', JSON.stringify(updated));
              setSelectedBookmark(null);
              showToast(`'${selectedBookmark.name}'이(가) 저장된 목록에서 삭제되었습니다.`);
            }}
          />
        </div>
      )}

      {/* Background Glow */}
      <div className="absolute top-1/4 left-1/4 w-[300px] h-[300px] bg-blue-500/10 rounded-full blur-[100px] pointer-events-none z-0"></div>

      {/* Bottom Navigation Bar */}
      <div className="absolute bottom-0 w-full z-30 bg-[#0b101e]/90 backdrop-blur-xl border-t border-white/10 px-6 py-4 pb-8 flex justify-around items-center">
        {[
          { id: 'Home', icon: Home, label: 'Home' },
          { id: 'Saved', icon: Bookmark, label: 'Saved' },
          { id: 'MyPage', icon: User, label: 'My Page' }
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => handleTabClick(tab.id)}
              className={`flex flex-col items-center justify-center transition-colors ${
                isActive ? 'text-[#104bce]' : 'text-gray-500 hover:text-gray-400'
              }`}
            >
              <div className={`p-2 rounded-xl mb-1 ${isActive ? 'bg-[#104bce]/10' : ''}`}>
                <Icon size={24} className={isActive ? 'text-[#104bce]' : 'text-gray-500'} />
              </div>
              <span className={`text-xs font-medium ${isActive ? 'text-[#104bce]' : ''}`}>
                {tab.label}
              </span>
            </button>
          );
        })}
      </div>

      {/* Toast Notification */}
      {toastMessage && (
        <div className="fixed bottom-[350px] left-1/2 -translate-x-1/2 z-50 pointer-events-none w-full max-w-sm px-4 animate-toast">
          <div className="bg-black/85 backdrop-blur-md text-white text-xs sm:text-sm px-5 py-3 rounded-full shadow-lg text-center font-medium break-keep">
            {toastMessage}
          </div>
        </div>
      )}
    </div>
  );
}
