-- =========================================================================
-- 1. 사용자 시드 데이터 (auth.users & public.users)
-- =========================================================================

-- auth.users 모킹 데이터 삽입 (기존에 없을 시에만)
INSERT INTO auth.users (id, email) VALUES
('a1111111-1111-1111-1111-111111111111', 'admin@indutech.com'),
('a2222222-2222-2222-2222-222222222222', 'worker1@indutech.com'),
('a3333333-3333-3333-3333-333333333333', 'worker2@indutech.com'),
('a4444444-4444-4444-4444-444444444444', 'admin@spotlogis.com'),
('a5555555-5555-5555-5555-555555555555', 'worker3@spotlogis.com')
ON CONFLICT (id) DO NOTHING;

-- public.users 데이터 삽입
INSERT INTO public.users (id, employee_id, company_name, preferred_categories, work_shift, role) VALUES
('a1111111-1111-1111-1111-111111111111', 'IT-ADMIN-01', 'InduTech', '["cafeteria", "meeting_room"]'::jsonb, 'morning', 'admin'),
('a2222222-2222-2222-2222-222222222222', 'IT-WORKER-01', 'InduTech', '["cafeteria", "parking"]'::jsonb, 'morning', 'worker'),
('a3333333-3333-3333-3333-333333333333', 'IT-WORKER-02', 'InduTech', '["parking", "meeting_room"]'::jsonb, 'afternoon', 'worker'),
('a4444444-4444-4444-4444-444444444444', 'SL-ADMIN-01', 'SpotLogis', '["loading_dock"]'::jsonb, 'morning', 'admin'),
('a5555555-5555-5555-5555-555555555555', 'SL-WORKER-01', 'SpotLogis', '["loading_dock", "cafeteria"]'::jsonb, 'night', 'worker')
ON CONFLICT (id) DO NOTHING;


-- =========================================================================
-- 2. 공용 인프라 POI 시드 데이터 (facilities)
-- =========================================================================

INSERT INTO public.facilities (id, name, type, latitude, longitude, capacity, operating_hours, features) VALUES
-- 식당 (cafeteria) - 5개
('f1000000-0000-0000-0000-000000000001', '푸드스퀘어 한식관', 'cafeteria', 37.3185, 126.8115, 150, 
 '{"weekday": "11:00-20:00", "weekend": "11:00-14:00"}'::jsonb, '{"has_vegetarian": true, "average_price": 7500}'::jsonb),
('f1000000-0000-0000-0000-000000000002', 'Indu 뷔페 식당', 'cafeteria', 37.3202, 126.8141, 200, 
 '{"weekday": "11:30-19:00", "weekend": "closed"}'::jsonb, '{"buffet_style": true, "average_price": 8000}'::jsonb),
('f1000000-0000-0000-0000-000000000003', '단지내 중식당 화성', 'cafeteria', 37.3215, 126.8098, 80, 
 '{"weekday": "11:00-21:00", "weekend": "11:00-15:00"}'::jsonb, '{"has_delivery": true, "average_price": 9000}'::jsonb),
('f1000000-0000-0000-0000-000000000004', '밀스밀 간편식 코너', 'cafeteria', 37.3171, 126.8152, 50, 
 '{"weekday": "08:00-22:00", "weekend": "09:00-18:00"}'::jsonb, '{"sandwich_bar": true, "average_price": 5500}'::jsonb),
('f1000000-0000-0000-0000-000000000005', '산단 남부 한식뷔페', 'cafeteria', 37.3230, 126.8120, 180, 
 '{"weekday": "11:00-18:30", "weekend": "closed"}'::jsonb, '{"buffet_style": true, "average_price": 7000}'::jsonb),

-- 주차장 (parking) - 3개
('f2000000-0000-0000-0000-000000000001', '중앙 주차타워 A동', 'parking', 37.3195, 126.8130, 400, 
 '{"24_7": true}'::jsonb, '{"has_ev_charger": true, "indoor": true}'::jsonb),
('f2000000-0000-0000-0000-000000000002', '지상 남부 주차장', 'parking', 37.3242, 126.8105, 250, 
 '{"24_7": true}'::jsonb, '{"has_ev_charger": false, "indoor": false}'::jsonb),
('f2000000-0000-0000-0000-000000000003', '서부 복합주차장 B', 'parking', 37.3160, 126.8085, 300, 
 '{"24_7": true}'::jsonb, '{"has_ev_charger": true, "indoor": true}'::jsonb),

-- 회의실 (meeting_room) - 4개
('f3000000-0000-0000-0000-000000000001', '본관 1층 컨퍼런스룸 101', 'meeting_room', 37.3190, 126.8125, 30, 
 '{"weekday": "09:00-18:00", "weekend": "closed"}'::jsonb, '{"has_beam_projector": true, "has_video_conf": true}'::jsonb),
('f3000000-0000-0000-0000-000000000002', '혁신센터 스마트회의실 B', 'meeting_room', 37.3208, 126.8155, 12, 
 '{"weekday": "08:00-20:00", "weekend": "09:00-18:00"}'::jsonb, '{"has_beam_projector": true, "whiteboard": true}'::jsonb),
('f3000000-0000-0000-0000-000000000003', '지원동 소회의실 203', 'meeting_room', 37.3175, 126.8102, 8, 
 '{"weekday": "09:00-18:00", "weekend": "closed"}'::jsonb, '{"whiteboard": true}'::jsonb),
('f3000000-0000-0000-0000-000000000004', '테크노타워 다목적홀 C', 'meeting_room', 37.3225, 126.8138, 60, 
 '{"weekday": "09:00-22:00", "weekend": "09:00-18:00"}'::jsonb, '{"has_beam_projector": true, "has_audio_system": true}'::jsonb),

-- 하역장 (loading_dock) - 2개
('f4000000-0000-0000-0000-000000000001', '북부 종합 물류하역장 D-1', 'loading_dock', 37.3250, 126.8145, 10, 
 '{"24_7": true}'::jsonb, '{"max_tonnage": 15, "has_forklift": true}'::jsonb),
('f4000000-0000-0000-0000-000000000002', '남부 컨테이너 하역장 E-2', 'loading_dock', 37.3150, 126.8110, 6, 
 '{"24_7": true}'::jsonb, '{"max_tonnage": 25, "has_forklift": true}'::jsonb)
ON CONFLICT (id) DO NOTHING;


-- =========================================================================
-- 3. 7일치 혼잡도 이력 데이터 생성 (congestion_logs)
-- =========================================================================

-- generate_series를 이용하여 각 시설별로 지난 7일(168시간)간의 시간대별 패턴을 생성해 적재합니다.
INSERT INTO public.congestion_logs (facility_id, timestamp, current_count, congestion_level, source)
SELECT 
    f.id AS facility_id,
    t AS timestamp,
    -- current_count 계산 (capacity * congestion_level)
    ROUND(f.capacity * 
      CASE
        -- 1) 식당 (cafeteria) 패턴
        WHEN f.type = 'cafeteria' THEN
          CASE
            -- 주말 패턴: 거의 이용하지 않음
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.02 + random() * 0.08
            -- 점심 피크 (11:30 ~ 13:30)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 11 AND 13 THEN 0.70 + random() * 0.25
            -- 저녁 피크 (17:30 ~ 19:30)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 17 AND 19 THEN 0.50 + random() * 0.25
            -- 기타 일과 시간대
            WHEN EXTRACT(HOUR FROM t) BETWEEN 9 AND 20 THEN 0.10 + random() * 0.20
            -- 야간/새벽
            ELSE 0.0 + random() * 0.03
          END
        
        -- 2) 주차장 (parking) 패턴
        WHEN f.type = 'parking' THEN
          CASE
            -- 주말 패턴: 한산함
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.10 + random() * 0.15
            -- 평일 출근 피크 (08:00 ~ 09:30)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 8 AND 9 THEN 0.75 + random() * 0.20
            -- 평일 근무 시간대 유지 (10:00 ~ 17:00)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 10 AND 16 THEN 0.65 + random() * 0.15
            -- 평일 퇴근 시간대 및 감소 (17:00 ~ 20:00)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 17 AND 19 THEN 0.40 + random() * 0.20
            -- 평일 야간/새벽 (21:00 ~ 07:00)
            ELSE 0.15 + random() * 0.10
          END

        -- 3) 회의실 (meeting_room) 패턴
        WHEN f.type = 'meeting_room' THEN
          CASE
            -- 주말: 닫음
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.0
            -- 평일 일과 시간 회의 (09:00 ~ 18:00)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 9 AND 17 THEN 0.20 + random() * 0.60
            -- 야간 예약 회의
            WHEN EXTRACT(HOUR FROM t) BETWEEN 18 AND 21 THEN 0.05 + random() * 0.25
            ELSE 0.0
          END

        -- 4) 하역장 (loading_dock) 패턴
        WHEN f.type = 'loading_dock' THEN
          CASE
            -- 주말 패턴: 한산
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.05 + random() * 0.10
            -- 평일 오전 물류 피크 (08:00 ~ 11:30)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 8 AND 11 THEN 0.60 + random() * 0.35
            -- 평일 오후 물류 피크 (13:30 ~ 16:30)
            WHEN EXTRACT(HOUR FROM t) BETWEEN 13 AND 16 THEN 0.55 + random() * 0.35
            -- 평일 야간 물류 교대
            WHEN EXTRACT(HOUR FROM t) BETWEEN 21 AND 23 THEN 0.20 + random() * 0.30
            ELSE 0.05 + random() * 0.15
          END
      END
    ) AS current_count,

    -- congestion_level 계산 (위 CASE 수식을 그대로 차용하되 0~1 바운드 처리)
    GREATEST(0.0, LEAST(1.0, 
      CASE
        WHEN f.type = 'cafeteria' THEN
          CASE
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.02 + random() * 0.08
            WHEN EXTRACT(HOUR FROM t) BETWEEN 11 AND 13 THEN 0.70 + random() * 0.25
            WHEN EXTRACT(HOUR FROM t) BETWEEN 17 AND 19 THEN 0.50 + random() * 0.25
            WHEN EXTRACT(HOUR FROM t) BETWEEN 9 AND 20 THEN 0.10 + random() * 0.20
            ELSE 0.0 + random() * 0.03
          END
        WHEN f.type = 'parking' THEN
          CASE
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.10 + random() * 0.15
            WHEN EXTRACT(HOUR FROM t) BETWEEN 8 AND 9 THEN 0.75 + random() * 0.20
            WHEN EXTRACT(HOUR FROM t) BETWEEN 10 AND 16 THEN 0.65 + random() * 0.15
            WHEN EXTRACT(HOUR FROM t) BETWEEN 17 AND 19 THEN 0.40 + random() * 0.20
            ELSE 0.15 + random() * 0.10
          END
        WHEN f.type = 'meeting_room' THEN
          CASE
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.0
            WHEN EXTRACT(HOUR FROM t) BETWEEN 9 AND 17 THEN 0.20 + random() * 0.60
            WHEN EXTRACT(HOUR FROM t) BETWEEN 18 AND 21 THEN 0.05 + random() * 0.25
            ELSE 0.0
          END
        WHEN f.type = 'loading_dock' THEN
          CASE
            WHEN EXTRACT(ISODOW FROM t) IN (6, 7) THEN 0.05 + random() * 0.10
            WHEN EXTRACT(HOUR FROM t) BETWEEN 8 AND 11 THEN 0.60 + random() * 0.35
            WHEN EXTRACT(HOUR FROM t) BETWEEN 13 AND 16 THEN 0.55 + random() * 0.35
            WHEN EXTRACT(HOUR FROM t) BETWEEN 21 AND 23 THEN 0.20 + random() * 0.30
            ELSE 0.05 + random() * 0.15
          END
      END
    )) AS congestion_level,
    
    -- 로그 소스 지정
    CASE 
      WHEN f.type = 'parking' THEN 'iot_sensor'
      WHEN f.type = 'cafeteria' THEN 'cctv'
      WHEN f.type = 'meeting_room' THEN 'access_card'
      ELSE 'iot_sensor'
    END AS source

FROM 
    public.facilities f
CROSS JOIN 
    generate_series(
        timezone('utc'::text, date_trunc('hour', now()) - interval '7 days'), 
        timezone('utc'::text, date_trunc('hour', now())), 
        interval '1 hour'
    ) AS t;
