'use client';

import { useState } from 'react';
import { Settings, Plus, Edit2, Trash2 } from 'lucide-react';

export function FacilityTable() {
  // 백엔드 명세서 기반 시설 목록 구조 (Mock Data)
  const [facilities, setFacilities] = useState([
    { id: '1', name: '제1식당', type: 'cafeteria', capacity: 250, hours: '11:30-13:30', active: true },
    { id: '2', name: '본관 대회의실', type: 'meeting_room', capacity: 60, hours: '09:00-22:00', active: true },
    { id: '3', name: 'A주차장', type: 'parking', capacity: 500, hours: '24시간', active: true },
    { id: '4', name: '동관 휴게라운지', type: 'rest_area', capacity: 30, hours: '09:00-18:00', active: false },
  ]);

  const handleDelete = (id: string) => {
    if (confirm('정말로 이 시설을 삭제하시겠습니까? (API DELETE 요청 시뮬레이션)')) {
      setFacilities(facilities.filter(f => f.id !== id));
    }
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden col-span-2">
      <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div className="flex items-center gap-2">
          <Settings className="text-slate-500" size={20} />
          <h3 className="text-lg font-bold text-slate-800">시설 관리 (CRUD)</h3>
        </div>
        <button 
          onClick={() => alert('시설 추가 모달 띄우기 (POST /api/admin/facilities)')}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          <Plus size={16} /> 신규 시설 등록
        </button>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-white text-slate-500 text-sm border-b border-slate-200">
              <th className="p-4 font-semibold">시설명</th>
              <th className="p-4 font-semibold">유형</th>
              <th className="p-4 font-semibold">수용 인원</th>
              <th className="p-4 font-semibold">운영 시간</th>
              <th className="p-4 font-semibold">상태</th>
              <th className="p-4 font-semibold text-right">관리</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {facilities.map((fac) => (
              <tr key={fac.id} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                <td className="p-4 font-bold text-slate-800">{fac.name}</td>
                <td className="p-4">
                  <span className="px-2 py-1 bg-slate-100 text-slate-600 rounded-md text-xs font-semibold uppercase">
                    {fac.type}
                  </span>
                </td>
                <td className="p-4 text-slate-600">{fac.capacity}명/대</td>
                <td className="p-4 text-slate-600">{fac.hours}</td>
                <td className="p-4">
                  {fac.active ? (
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">활성</span>
                  ) : (
                    <span className="px-2 py-1 bg-slate-200 text-slate-500 text-xs font-bold rounded-md">비활성</span>
                  )}
                </td>
                <td className="p-4 flex justify-end gap-2">
                  <button 
                    onClick={() => alert(`수정 (PUT /api/admin/facilities/${fac.id})`)}
                    className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors bg-white border border-slate-200 rounded-md"
                  >
                    <Edit2 size={16} />
                  </button>
                  <button 
                    onClick={() => handleDelete(fac.id)}
                    className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors bg-white border border-slate-200 rounded-md"
                  >
                    <Trash2 size={16} />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
