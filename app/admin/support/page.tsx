'use client';

import { useState } from 'react';
import { 
  Search, Bell, MessageSquare, CheckCircle, Clock, FileText, Send 
} from 'lucide-react';
import { AdminSidebar } from '@/components/AdminSidebar';

interface Ticket {
  id: string;
  user: string;
  type: string;
  title: string;
  content: string;
  status: 'new' | 'in_progress' | 'resolved';
  time: string;
}

const mockTickets: Ticket[] = [
  { id: '101', user: 'Yun Seong', type: '인프라 불만', title: 'B주차장 차단기 오작동', content: '입구 차단기가 열리지 않아서 5분 넘게 대기했습니다. 확인 부탁드립니다.', status: 'new', time: '10분 전' },
  { id: '102', user: 'Kim Jiwon', type: '앱 버그', title: '메인 지도 로딩 지연', content: '아침 출근 시간에 지도가 너무 늦게 뜹니다. 앱 최적화가 필요해보입니다.', status: 'in_progress', time: '1시간 전' },
  { id: '103', user: 'Lee Sang', type: '기타 문의', title: '야간 휴게실 이용 시간 문의', content: '야간조 휴게실은 몇시까지 오픈하나요?', status: 'resolved', time: '어제' },
  { id: '104', user: 'Park Minsu', type: '데이터 수정', title: '선호 메뉴 변경이 안됩니다', content: '초기 설정에서 잘못 눌렀는데 마이페이지에서 수정이 안되네요.', status: 'new', time: '2시간 전' },
];

export default function SupportPage() {
  const [tickets, setTickets] = useState<Ticket[]>(mockTickets);
  const [selectedTicket, setSelectedTicket] = useState<Ticket | null>(mockTickets[0]);
  const [replyText, setReplyText] = useState('');

  const handleReply = () => {
    if (!selectedTicket || !replyText.trim()) return;

    // 답변 완료 상태로 변경 (Mocking)
    const updatedTickets = tickets.map(t => 
      t.id === selectedTicket.id ? { ...t, status: 'resolved' as const } : t
    );
    setTickets(updatedTickets);
    setSelectedTicket({ ...selectedTicket, status: 'resolved' });
    setReplyText('');
    alert('답변이 전송되었으며, 티켓 상태가 완료로 변경되었습니다.');
  };

  const getStatusBadge = (status: string) => {
    switch(status) {
      case 'new': return <span className="px-2 py-1 bg-red-100 text-red-700 text-xs font-bold rounded-md">NEW</span>;
      case 'in_progress': return <span className="px-2 py-1 bg-amber-100 text-amber-700 text-xs font-bold rounded-md">IN PROGRESS</span>;
      case 'resolved': return <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">RESOLVED</span>;
    }
  };

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
                <FileText size={16} /> Total: {tickets.length}
              </div>
              <div className="flex items-center gap-2 text-red-600 font-semibold text-sm">
                <MessageSquare size={16} /> New: {tickets.filter(t => t.status === 'new').length}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {tickets.map(ticket => (
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
              ))}
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
                        <span className="text-xs text-slate-400">Ticket #{selectedTicket.id}</span>
                      </div>
                      <h2 className="text-2xl font-bold text-slate-800">{selectedTicket.title}</h2>
                    </div>
                    <div className="text-right">
                      <div className="font-semibold text-slate-700">{selectedTicket.user}</div>
                      <div className="text-sm text-slate-400">{selectedTicket.time}</div>
                    </div>
                  </div>
                  <div className="p-4 bg-slate-50 rounded-xl text-slate-700 leading-relaxed">
                    {selectedTicket.content}
                  </div>
                </div>

                {/* Reply Section */}
                <div className="bg-white p-6 rounded-b-2xl border border-slate-200 shadow-sm flex-1 flex flex-col">
                  <h3 className="font-bold text-slate-800 mb-4">답변 작성</h3>
                  
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
                          답변을 전송하면 자동으로 상태가 <span className="font-bold text-emerald-600">RESOLVED</span>로 변경됩니다.
                        </div>
                        <button 
                          onClick={handleReply}
                          disabled={!replyText.trim()}
                          className="flex items-center gap-2 px-6 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 disabled:cursor-not-allowed text-white font-bold rounded-xl transition-colors shadow-sm"
                        >
                          <Send size={18} /> Send Reply
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
