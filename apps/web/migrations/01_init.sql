-- Enable UUID extension
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. 공용 인프라 테이블 (식당, 주차장, 회의실, 하역장 등)
CREATE TABLE IF NOT EXISTS public.infrastructures (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(255) NOT NULL,
    type VARCHAR(50) NOT NULL, -- 'restaurant', 'parking', 'meeting_room', 'loading_dock'
    location VARCHAR(255),
    latitude DOUBLE PRECISION,
    longitude DOUBLE PRECISION,
    capacity INT NOT NULL,
    congestion_threshold DOUBLE PRECISION DEFAULT 0.8, -- 혼잡 임계치 (예: 80%)
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 2. 실시간 혼잡도 로그 테이블
CREATE TABLE IF NOT EXISTS public.congestion_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    infrastructure_id UUID REFERENCES public.infrastructures(id) ON DELETE CASCADE,
    current_occupancy INT NOT NULL,
    congestion_rate DOUBLE PRECISION NOT NULL, -- current_occupancy / capacity
    status VARCHAR(50) NOT NULL, -- 'smooth', 'normal', 'crowded', 'critical'
    recorded_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 3. 예약 테이블 (회의실, 하역장 등 예약제 인프라용)
CREATE TABLE IF NOT EXISTS public.reservations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    infrastructure_id UUID REFERENCES public.infrastructures(id) ON DELETE CASCADE,
    user_id UUID NOT NULL, -- Supabase Auth의 User ID
    start_time TIMESTAMP WITH TIME ZONE NOT NULL,
    end_time TIMESTAMP WITH TIME ZONE NOT NULL,
    status VARCHAR(50) DEFAULT 'confirmed', -- 'confirmed', 'cancelled', 'completed'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 4. TTTV(Total Time to Value) 알고리즘 대안 추천 로그 테이블
CREATE TABLE IF NOT EXISTS public.tttv_recommendations (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID,
    requested_infra_id UUID REFERENCES public.infrastructures(id) ON DELETE SET NULL,
    recommended_infra_id UUID REFERENCES public.infrastructures(id) ON DELETE SET NULL,
    original_estimated_wait_time INT, -- 분 단위
    recommended_estimated_wait_time INT, -- 분 단위
    travel_time_saved INT, -- 분 단위
    status VARCHAR(50) DEFAULT 'offered', -- 'offered', 'accepted', 'rejected'
    created_at TIMESTAMP WITH TIME ZONE DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- 트리거 함수: updated_at 자동 업데이트
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_infrastructures_modtime
    BEFORE UPDATE ON public.infrastructures
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();
