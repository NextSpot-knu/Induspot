'use client';

import { useState, useEffect } from 'react';
import { Settings, Plus, Edit2, Trash2 } from 'lucide-react';
import { createPublicClient } from '@/lib/supabase';

const supabase = createPublicClient();

interface FacilityData {
  id: string;
  name: string;
  type: string;
  capacity: number;
  operating_hours?: Record<string, string>;
}

export function FacilityTable() {
  const [facilities, setFacilities] = useState<FacilityData[]>([]);
  const [loading, setLoading] = useState(true);

  const fetchFacilities = async () => {
    try {
      const { data, error } = await supabase
        .from('facilities')
        .select('id, name, type, capacity, operating_hours')
        .order('name', { ascending: true });

      if (error) throw error;
      setFacilities(data || []);
    } catch (err) {
      console.error('Failed to fetch facilities in table:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchFacilities();
  }, []);

  const handleDelete = async (id: string, name: string) => {
    if (confirm(`정말로 이 시설(${name})을 삭제하시겠습니까?`)) {
      try {
        const { error } = await supabase
          .from('facilities')
          .delete()
          .eq('id', id);

        if (error) throw error;
        setFacilities(prev => prev.filter(f => f.id !== id));
      } catch (err) {
        console.error('Failed to delete facility:', err);
        alert('시설 삭제 중 오류가 발생했습니다.');
      }
    }
  };

  const getHoursText = (hours?: Record<string, string>) => {
    if (!hours) return '24시간';
    if (hours.weekday) return hours.weekday;
    if (hours.start && hours.end) return `${hours.start}-${hours.end}`;
    return '24시간';
  };

  return (
    <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden col-span-2">
      <div className="p-6 border-b border-slate-200 flex justify-between items-center bg-slate-50">
        <div className="flex items-center gap-2">
          <Settings className="text-slate-500" size={20} />
          <h3 className="text-lg font-bold text-slate-800">시설 관리 (CRUD)</h3>
        </div>
        <button 
          onClick={() => {
            const name = prompt('새로운 시설명을 입력하세요:');
            if (!name) return;
            const type = prompt('시설 유형을 입력하세요 (cafeteria, parking, meeting_room, loading_dock):', 'meeting_room');
            if (!type) return;
            const capacityStr = prompt('수용 인원(숫자)을 입력하세요:', '50');
            const capacity = parseInt(capacityStr || '50') || 50;
            
            supabase
              .from('facilities')
              .insert([{ name, type, capacity, latitude: 36.109031, longitude: 128.388471 }])
              .select()
              .then(({ data, error }) => {
                if (error) {
                  alert('시설 등록에 실패했습니다: ' + error.message);
                } else {
                  alert('시설이 성공적으로 등록되었습니다.');
                  fetchFacilities();
                }
              });
          }}
          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-bold transition-colors"
        >
          <Plus size={16} /> 신규 시설 등록
        </button>
      </div>
      <div className="overflow-x-auto">
        {loading ? (
          <div className="p-8 text-center text-slate-400">데이터 로딩 중...</div>
        ) : (
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
                  <td className="p-4 text-slate-600">{getHoursText(fac.operating_hours)}</td>
                  <td className="p-4">
                    <span className="px-2 py-1 bg-emerald-100 text-emerald-700 text-xs font-bold rounded-md">활성</span>
                  </td>
                  <td className="p-4 flex justify-end gap-2">
                    <button 
                      onClick={() => {
                        const newName = prompt('수정할 시설명을 입력하세요:', fac.name);
                        if (!newName) return;
                        const newCapStr = prompt('수정할 수용 인원을 입력하세요:', String(fac.capacity));
                        const newCapacity = parseInt(newCapStr || '50') || fac.capacity;

                        supabase
                          .from('facilities')
                          .update({ name: newName, capacity: newCapacity })
                          .eq('id', fac.id)
                          .then(({ error }) => {
                            if (error) {
                              alert('시설 정보 수정 실패: ' + error.message);
                            } else {
                              alert('시설 정보가 수정되었습니다.');
                              fetchFacilities();
                            }
                          });
                      }}
                      className="p-1.5 text-slate-400 hover:text-blue-600 transition-colors bg-white border border-slate-200 rounded-md"
                    >
                      <Edit2 size={16} />
                    </button>
                    <button 
                      onClick={() => handleDelete(fac.id, fac.name)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 transition-colors bg-white border border-slate-200 rounded-md"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                </tr>
              ))}
              {facilities.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center p-8 text-slate-400">등록된 시설이 없습니다.</td>
                </tr>
              )}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
