import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export async function POST() {
    try {
        const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
        const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || '';
        
        if (!supabaseUrl || !supabaseServiceKey) {
            return NextResponse.json({ detail: "Supabase credentials are not configured properly" }, { status: 500 });
        }

        const supabase = createClient(supabaseUrl, supabaseServiceKey);

        // 1. 기존 모의 데이터(오늘 데이터 포함 모든 로그) 초기화
        const { error: deleteError } = await supabase
            .from('congestion_logs')
            .delete()
            .neq('id', '00000000-0000-0000-0000-000000000000'); // Delete all rows

        if (deleteError) {
            console.error("Delete error", deleteError);
            return NextResponse.json({ detail: "기존 로그 삭제에 실패했습니다." }, { status: 500 });
        }

        // 2. Fetch all facilities
        const { data: facilities, error: fetchError } = await supabase
            .from('facilities')
            .select('id, name, type, capacity');

        if (fetchError || !facilities || facilities.length === 0) {
            return NextResponse.json({ detail: "시설 목록을 찾을 수 없습니다." }, { status: 404 });
        }

        // 3. Generate 24-hour cycle mock data
        const logs = [];
        
        // KST 기준 자정부터 23시까지 생성
        const now = new Date();
        const kstOffset = 9 * 60 * 60 * 1000;
        const nowKst = new Date(now.getTime() + kstOffset);
        
        // 오늘 KST 날짜의 0시 정각 구하기
        const kstStartOfDay = new Date(Date.UTC(nowKst.getUTCFullYear(), nowKst.getUTCMonth(), nowKst.getUTCDate(), 0, 0, 0));
        
        for (let hour = 0; hour < 24; hour++) {
            // 시간대별 기본 혼잡도 설정
            let baseCongestion = 0.2;
            if (hour >= 11 && hour <= 13) {
                baseCongestion = 0.8; // 점심 피크
            } else if (hour >= 17 && hour <= 19) {
                baseCongestion = 0.6; // 저녁 피크
            } else if (hour >= 8 && hour <= 10) {
                baseCongestion = 0.5; // 아침 시간
            } else if (hour >= 22 || hour < 7) {
                baseCongestion = 0.05; // 심야
            } else {
                baseCongestion = 0.3; // 그 외 시간
            }

            // 타임스탬프 계산 (UTC 기준으로 다시 역변환하여 저장)
            const targetKstTime = new Date(kstStartOfDay.getTime() + hour * 60 * 60 * 1000);
            const targetUtcTime = new Date(targetKstTime.getTime() - kstOffset);
            const timestampStr = targetUtcTime.toISOString();

            for (const f of facilities) {
                // 각 시설별로 약간의 랜덤성(Noise) 부여 (-0.15 ~ +0.15)
                const noise = (Math.random() * 0.3) - 0.15;
                let level = baseCongestion + noise;
                level = Math.max(0.01, Math.min(0.99, level)); // 0.01 ~ 0.99 사이로 클램프
                level = Math.round(level * 100) / 100;

                const current_count = Math.floor((f.capacity || 100) * level);
                const source = ['parking', 'loading_dock'].includes(f.type) ? "iot_sensor" : "cctv";

                logs.push({
                    facility_id: f.id,
                    congestion_level: level,
                    current_count: current_count,
                    source: source,
                    timestamp: timestampStr
                });
            }
        }

        // 4. Insert into DB in chunks (최대 1000개씩)
        const CHUNK_SIZE = 500;
        const insertPromises = [];
        for (let i = 0; i < logs.length; i += CHUNK_SIZE) {
            const chunk = logs.slice(i, i + CHUNK_SIZE);
            insertPromises.push(
                supabase.from('congestion_logs').insert(chunk)
            );
        }

        const results = await Promise.all(insertPromises);
        let insertedCount = 0;
        for (const res of results) {
            if (res.error) {
                console.error("Insert error for chunk", res.error);
            } else {
                // Since we don't return data to save bandwidth, we just count what we sent
                insertedCount += CHUNK_SIZE; // Approximate, but sufficient for success message
            }
        }
        
        // Adjust insertedCount to not exceed actual length
        insertedCount = Math.min(insertedCount, logs.length);

        return NextResponse.json({ 
            status: "success", 
            message: `24시간 풀사이클 혼잡도 로그 ${insertedCount}개가 성공적으로 생성되었습니다.` 
        }, { status: 200 });

    } catch (error: any) {
        console.error("simulate_peak_failed", error);
        return NextResponse.json({ detail: `데이터 생성 실패: ${error.message}` }, { status: 500 });
    }
}
