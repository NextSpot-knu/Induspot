'use client';

import { useState, useEffect } from 'react';
import { 
  Search, Bell, MessageSquare, CheckCircle, Clock, FileText, Send 
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';
import { createPublicClient } from '@/lib/supabase';

interface Ticket {
  id: string;
  user: string;
  type: string;
  title: string;
  content: string;
  status: 'new' | 'in_progress' | 'resolved';
  time: string;
}

function formatRelativeTime(dateString: string) {
  try {
    const now = new Date();
    const date = new Date(dateString);
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMins / 60);

    if (diffMins < 1) return '방금 전';
    if (diffMins < 60) return `${diffMins}분 전`;
    if (diffHours < 24) return `${diffHours}시간 전`;
    
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);
    if (yesterday.toDateString() === date.toDateString()) return '어제';

    return date.toLocaleDateString('ko-KR', { month: 'short', day: 'numeric' });
  } catch (e) {
    return '최근';
  }
}

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(null);
  const [replyText, setReplyText] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch inquiries from Supabase
  useEffect(() => {
    async function fetchTickets() {
      try {
        const supabase = createPublicClient();
        const { data, error } = await supabase
          .from('inquiries')
          .select('*')
          .order('created_at', { ascending: false });

        if (error) throw error;

        if (data) {
          const mappedTickets: Ticket[] = data.map((item: any) => ({
            id: item.id,
            user: item.user_name || '익명 사용자',
            type: item.type || '기타 문의',
            title: item.title || '제목 없음',
            content: item.content || '내용 없음',
            status: item.status || 'new',
            time: formatRelativeTime(item.created_at)
          }));
          setTickets(mappedTickets);
          if (mappedTickets.length > 0) {
            setSelectedTicket(mappedTickets[0]);
          }
        }
      } catch (err) {
        console.error('Failed to fetch support tickets:', err);
      } finally {
        setIsLoading(false);
      }
    }

    fetchTickets();
  }, []);

  const handleReply = async () => {
    if (!selectedTicket || !replyText.trim()) return;

    try {
      const supabase = createPublicClient();
      const { error } = await supabase
        .from('inquiries')
        .update({ status: 'resolved' })
        .eq('id', selectedTicket.id);

      if (error) throw error;

      // Update local state
      const updatedTickets = tickets.map(t => 
        t.id === selectedTicket.id ? { ...t, status: 'resolved' as const } : t
      );
      setTickets(updatedTickets);
      setSelectedTicket({ ...selectedTicket, status: 'resolved' });
      setReplyText('');
      alert('문의가 처리 완료(RESOLVED)로 표시되었습니다.');
    } catch (err) {
      console.error('Failed to reply and resolve ticket:', err);
      alert('답변 처리에 실패했습니다. 다시 시도해주세요.');
    }
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'new': return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-md">NEW</span>;
      case 'in_progress': return <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-md">IN PROGRESS</span>;
      case 'resolved': return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">RESOLVED</span>;
      default: return <span className="px-2 py-1 bg-gray-100 text-gray-700 text-xs font-bold rounded-md">NEW</span>;
    }
  };

  const filteredTickets = tickets.filter(t => 
    t.user.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.content.toLowerCase().includes(searchQuery.toLowerCase()) ||
    t.type.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-slate-50 text-slate-900 font-sans overflow-hidden">
      <AdminSidebar />

      <main className="flex-1 flex flex-col h-full overflow-hidden">
        {/* Top Header */}
        <header className="h-20 bg-white border-b border-slate-200 flex items-center justify-between px-8 flex-shrink-0">
          <h2 className="text-xl font-bold text-slate-800">문의 관리 (Help & Support)</h2>
          <div className="flex items-center gap-6">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
              <input 
                type="text" 
                placeholder="Search tickets..." 
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 pr-4 py-2 bg-slate-100 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 w-64"
              />
            </div>
            <button className="relative text-slate-500 hover:text-slate-700">
              <Bell size={24} />
            </button>
          </div>
        </header>

        {/* Inbox Layout */}
        <div className="flex-1 flex overflow-hidden">
          
          {/* Ticket List (Inbox) */}
          <div className="w-1/3 bg-white border-r border-slate-200 flex flex-col h-full">
            <div className="p-4 border-b border-slate-200 flex gap-4">
              <div className="flex items-center gap-2 text-slate-600 font-semibold text-sm">
                <FileText size={16} /> Total: {filteredTickets.length}
              </div>
              <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                <MessageSquare size={16} /> New: {filteredTickets.filter(t => t.status === 'new').length}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center p-8">
                  <div className="w-6 h-6 border-2 border-blue-500 border-t-transparent rounded-full animate-spin"></div>
                </div>
              ) : filteredTickets.length === 0 ? (
                <div className="text-center p-8 text-slate-400 text-sm">
                  검색된 문의가 없습니다.
                </div>
              ) : (
                filteredTickets.map(ticket => (
                  <div 
                    key={ticket.id}
                    onClick={() => setSelectedTicket(ticket)}
                    className={`p-4 border-b border-slate-100 cursor-pointer transition-colors ${
                      selectedTicket?.id === ticket.id 
                        ? 'bg-blue-50 border-l-4 border-l-blue-600' 
                        : 'hover:bg-slate-50 border-l-4 border-l-transparent'
                    }`}
                  >
                    <div className="flex justify-between items-start mb-1">
                      <span className="text-sm font-semibold text-slate-800">{ticket.user}</span>
                      <span className="text-xs text-slate-400">{ticket.time}</span>
                    </div>
                    <h4 className="font-bold text-slate-800 text-sm mb-2 truncate">{ticket.title}</h4>
                    <div className="flex justify-between items-center">
                      <span className="text-xs text-slate-500">{ticket.type}</span>
                      {getStatusBadge(ticket.status)}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Ticket Detail & Reply */}
          <div className="flex-1 bg-slate-50 flex flex-col overflow-hidden">
            {selectedTicket ? (
              <div className="flex flex-col h-full max-w-4xl mx-auto w-full p-8">
                
                {/* Detail Header */}
                <div className="bg-white p-6 rounded-t-2xl border border-slate-200 shadow-sm mb-4">
                  <div className="flex justify-between items-start mb-4">
                    <div>
                      <div className="flex items-center gap-2 mb-2">
                        {getStatusBadge(selectedTicket.status)}
                        <span className="text-xs font-semibold px-2 py-0.5 bg-slate-100 text-slate-600 rounded">
                          {selectedTicket.type}
                        </span>
                        <span className="text-[10px] text-slate-400">Ticket ID: {selectedTicket.id}</span>
                      </div>
                      <h2 className="text-2xl font-bold text-slate-800">{selectedTicket.title}</h2>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-700">{selectedTicket.user}</div>
                      <div className="text-sm text-slate-400">{selectedTicket.time}</div>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl text-slate-700 leading-relaxed break-all whitespace-pre-wrap">
                    {selectedTicket.content}
                  </div>
                </div>

                {/* Reply Section */}
                <div className="bg-white p-6 rounded-b-2xl border border-slate-200 shadow-sm flex-1 flex flex-col">
                  <h3 className="font-bold text-slate-800 mb-4">처리 완료로 표시</h3>
                  
                  {selectedTicket.status === 'resolved' ? (
                    <div className="flex-1 flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-xl border border-dashed border-slate-300">
                      <CheckCircle size={48} className="text-emerald-500 mb-4" />
                      <p className="font-medium">이미 처리가 완료된 문의입니다.</p>
                    </div>
                  ) : (
                    <>
                      <textarea 
                        className="flex-1 w-full bg-slate-50 border border-slate-200 rounded-xl p-4 resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 mb-4"
                        placeholder="여기에 답변을 작성하세요..."
                        value={replyText}
                        onChange={(e) => setReplyText(e.target.value)}
                      ></textarea>
                      <div className="flex justify-between items-center">
                        <div className="text-sm text-slate-500">
                          처리 완료로 표시하면 상태가 <span className="font-bold text-emerald-600">RESOLVED</span>로 변경됩니다.
                        </div>
                        <button 
                          onClick={handleReply}
                          disabled={!replyText.trim()}
                          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors shadow-sm"
                        >
                          <Send size={18} /> 처리 완료로 표시
                        </button>
                      </div>
                    </>
                  )}
                </div>

              </div>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-slate-400">
                <MessageSquare size={48} className="mb-4 opacity-50" />
                <p>좌측 목록에서 문의를 선택하여 확인하세요.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
