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

        // 1. Fetch all facilities
        const { data: facilities, error: fetchError } = await supabase
            .from('facilities')
            .select('id, name, type, capacity');

        if (fetchError || !facilities || facilities.length === 0) {
            return NextResponse.json({ detail: "시설 목록을 찾을 수 없습니다." }, { status: 404 });
        }

        // 2. Shuffle and assign congestion
        const shuffled = [...facilities].sort(() => Math.random() - 0.5);
        const nowStr = new Date().toISOString();
        const logs = [];

        for (let i = 0; i < shuffled.length; i++) {
            const f = shuffled[i];
            let level = 0;

            if (i < 15) {
                // 여유 (0.05 ~ 0.28)
                level = Math.round((Math.random() * (0.28 - 0.05) + 0.05) * 100) / 100;
            } else if (i < 30) {
                // 보통 (0.35 ~ 0.65)
                level = Math.round((Math.random() * (0.65 - 0.35) + 0.35) * 100) / 100;
            } else {
                // 혼잡 (0.72 ~ 0.95)
                level = Math.round((Math.random() * (0.95 - 0.72) + 0.72) * 100) / 100;
            }

            const current_count = Math.floor((f.capacity || 100) * level);
            const source = ['parking', 'loading_dock'].includes(f.type) ? "iot_sensor" : "cctv";

            logs.push({
                facility_id: f.id,
                congestion_level: level,
                current_count: current_count,
                source: source,
                timestamp: nowStr
            });
        }

        // 3. Insert into DB (chunked by 10 just to be safe, or all at once since it's just ~40 rows)
        let insertedCount = 0;
        for (let i = 0; i < logs.length; i += 10) {
            const chunk = logs.slice(i, i + 10);
            const { error: insertError } = await supabase
                .from('congestion_logs')
                .insert(chunk);
            
            if (insertError) {
                console.error("Insert error for chunk", insertError);
            } else {
                insertedCount += chunk.length;
            }
        }

        return NextResponse.json({ 
            status: "success", 
            message: `모의 피크타임 혼잡 로그 ${insertedCount}개가 성공적으로 삽입되었습니다.` 
        }, { status: 200 });

    } catch (error: any) {
        console.error("simulate_peak_failed", error);
        return NextResponse.json({ detail: `피크타임 모의 생성 실패: ${error.message}` }, { status: 500 });
    }
}
