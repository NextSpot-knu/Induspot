-- 관리자(admin) 계정 준비 헬퍼
-- ---------------------------------------------------------------------------
-- 관리자 로그인은 Supabase Auth(이메일/비밀번호) + public.users.role='admin' 가드를 쓴다.
-- public.users.id 는 auth.users(id) 를 참조하고, 가입 시 자동으로 users 행이 생성되는
-- 트리거는 없으므로(스키마상), 아래 절차로 관리자 행을 직접 만들어야 한다.
--
-- 1) Supabase 대시보드(Authentication > Users) 또는 signUp 으로 관리자 이메일/비밀번호 계정 생성.
-- 2) 아래 쿼리의 이메일을 그 계정으로 바꿔 실행(SQL Editor). employee_id 는 유니크해야 한다.
--
-- 멱등: 이미 users 행이 있으면 role 만 admin 으로 갱신한다.

INSERT INTO public.users (id, employee_id, company_name, role)
SELECT u.id, 'ADMIN-001', 'InduSpot', 'admin'
FROM auth.users AS u
WHERE u.email = 'admin@induspot.example'   -- ← 실제 관리자 이메일로 교체
ON CONFLICT (id) DO UPDATE SET role = 'admin';

-- 확인:
-- SELECT pu.id, au.email, pu.role
-- FROM public.users pu JOIN auth.users au ON au.id = pu.id
-- WHERE pu.role = 'admin';
