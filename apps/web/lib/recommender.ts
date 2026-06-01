// 클라이언트 추천 점수·정렬·사유 엔진 — 백엔드 TTTV 메커니즘의 "미러".
//
// 용도(데모를 따로 분리):
//  1) 데모 전용 시설(합성 휴게실/회의실 그룹, 시간대 시뮬 mockHour)의 점수·사유
//  2) 백엔드(/api/v1/recommendations/by-type) 미가용 시 폴백
//  3) 지도 마커 정렬 캡 등 대량 점수(백엔드 호출 없이)
//
// 가중치는 백엔드 services/tttv/score.py 와 동일하게 맞춘다(이전 main 인라인은
// 시간/혼잡분산 가중치가 뒤바뀐 0.30/0.25 였음 → 0.25/0.30 으로 정정).
//   W1(선호)=0.45, W2(시간비용)=0.25, W3(혼잡분산)=0.30

import type { RecommendationResponse } from "./api-client";

export const CATEGORY_VECTORS: Record<string, number[]> = {
  cafeteria: [1.0, 0.0, 0.0, 0.0, 0.2, 0.1, 0.0, 0.0],
  parking: [0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.3, 0.1],
  meeting_room: [0.0, 0.0, 1.0, 0.0, 0.1, 0.0, 0.0, 0.2],
  rest_area: [0.0, 0.0, 0.0, 1.0, 0.0, 0.2, 0.0, 0.0],
  loading_dock: [0.0, 0.0, 0.0, 1.0, 0.0, 0.2, 0.0, 0.0], // 레거시 별칭
};

export interface Tttv {
  score: number; // 0~100
  preferencePercent: number; // 0~100
  expectedWait: number; // 분
  expectedTravel: number; // 분
  timeToService: number; // 분
}

export interface ScoreOpts {
  userLocation: { lat: number; lng: number };
  preferredCategories?: string[];
  mockHour?: number | null;
}

const WALK_M_PER_MIN = 66.67; // 백엔드 WALKING_SPEED_M_PER_MIN 와 동일
const BROWSE_BASELINE_CONGESTION = 0.7; // 원본이 없는 브라우즈 랭킹의 혼잡 분산 기준선(백엔드와 동일)

export function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function preferenceMatch(facility: any, preferredCategories: string[]): number {
  const userVec = [0, 0, 0, 0, 0, 0, 0, 0];
  let count = 0;
  const cats = preferredCategories.length > 0 ? preferredCategories : Object.keys(CATEGORY_VECTORS);
  cats.forEach((c) => {
    if (CATEGORY_VECTORS[c]) {
      for (let i = 0; i < 8; i++) userVec[i] += CATEGORY_VECTORS[c][i];
      count++;
    }
  });
  const nu = count > 0 ? userVec.map((v) => v / count) : userVec.map(() => 1 / Math.sqrt(8));
  const un = Math.sqrt(nu.reduce((s, v) => s + v * v, 0));
  const uf = nu.map((v) => (un > 0 ? v / un : v));

  const fv = [...(CATEGORY_VECTORS[facility.type] || [0, 0, 0, 0, 0, 0, 0, 0])];
  if (facility.features) {
    if (facility.features.has_ev_charger && facility.type === "parking") fv[6] += 0.3;
    if (facility.features.has_vegetarian && facility.type === "cafeteria") fv[4] += 0.2;
  }
  const fn = Math.sqrt(fv.reduce((s, v) => s + v * v, 0));
  const ff = fv.map((v) => (fn > 0 ? v / fn : v));

  let dot = 0;
  for (let i = 0; i < 8; i++) dot += uf[i] * ff[i];
  return Math.max(0, Math.min(1, dot));
}

export function scoreFacility(facility: any, opts: ScoreOpts): Tttv {
  if (!facility) return { score: 0, preferencePercent: 0, expectedWait: 0, expectedTravel: 0, timeToService: 0 };

  const pref = preferenceMatch(facility, opts.preferredCategories || []);

  const defaultTimes: Record<string, number> = {
    cafeteria: 20,
    parking: 5,
    meeting_room: 10,
    rest_area: 10,
    loading_dock: 30,
  };
  const avgProcess = facility.features?.average_processing_time ?? defaultTimes[facility.type] ?? 15;
  const hour = opts.mockHour !== null && opts.mockHour !== undefined ? opts.mockHour : new Date().getHours();
  let mult = 1.0;
  if (hour >= 12 && hour < 14) mult = 1.3;
  else if (hour === 7 || hour === 15) mult = 1.2;

  const cong = facility.congestionLevel ?? 0;
  const expectedWait = cong * avgProcess * mult;

  const fLat = typeof facility.latitude === "number" ? facility.latitude : opts.userLocation.lat;
  const fLng = typeof facility.longitude === "number" ? facility.longitude : opts.userLocation.lng;
  const distanceM = haversineMeters(opts.userLocation.lat, opts.userLocation.lng, fLat, fLng);
  const expectedTravel = distanceM / WALK_M_PER_MIN;

  // 백엔드 동일 가중치: 선호 0.45 − 시간비용 0.25 + 혼잡분산 0.30, Min-Max 정규화
  const w1 = 0.45,
    w2 = 0.25,
    w3 = 0.3;
  const timeCost = Math.min(1.0, (expectedWait + expectedTravel) / 60.0);
  const incentive = Math.max(0, BROWSE_BASELINE_CONGESTION - cong);
  const raw = w1 * pref - w2 * timeCost + w3 * incentive;
  const normalized = (raw + w2) / (w1 + w2 + w3);
  const finalScore = Math.max(0, Math.min(1, normalized));

  return {
    score: isNaN(finalScore) ? 0 : Math.round(finalScore * 100),
    preferencePercent: isNaN(pref) ? 0 : Math.round(pref * 100),
    expectedWait: isNaN(expectedWait) ? 0 : Math.round(expectedWait * 10) / 10,
    expectedTravel: isNaN(expectedTravel) ? 0 : Math.round(expectedTravel * 10) / 10,
    timeToService: isNaN(expectedWait + expectedTravel) ? 0 : Math.round((expectedWait + expectedTravel) * 10) / 10,
  };
}

const TYPE_KO: Record<string, string> = {
  cafeteria: "식당",
  parking: "주차장",
  meeting_room: "회의실",
  rest_area: "휴게실",
  loading_dock: "휴게실",
};

// 그럴듯한 한국어 추천 사유(데모/폴백용). 백엔드 Gemini 사유와 어투를 맞춘다.
export function buildReason(facility: any, tttv: Tttv): string {
  const name = facility?.name || "이 시설";
  const cong = facility?.congestionLevel ?? 0;
  const congPct = Math.round(cong * 100);
  const congLabel = cong >= 0.75 ? "혼잡" : cong >= 0.5 ? "보통" : cong >= 0.25 ? "여유" : "한산";

  const bits: string[] = [];
  bits.push(`도보 ${Math.max(1, Math.round(tttv.expectedTravel))}분`);
  if (facility?.type === "parking") {
    const cap = facility?.capacity ?? 0;
    const cur = facility?.currentCount ?? Math.round(cap * cong);
    bits.push(`빈자리 약 ${Math.max(0, cap - cur)}면`);
  } else {
    bits.push(`예상 대기 ${Math.round(tttv.expectedWait)}분`);
  }
  bits.push(`혼잡도 ${congPct}%(${congLabel})`);

  let tail = "지금 균형이 가장 좋아 추천드려요.";
  if (tttv.preferencePercent >= 70) tail = `취향 일치율 ${tttv.preferencePercent}%로 선호와 잘 맞아요.`;
  else if (cong < 0.25) tail = "지금이 가장 한산해 바로 이용하기 좋아요.";
  else if (facility?.type !== "parking" && tttv.expectedWait <= 5) tail = "대기 거의 없이 이용할 수 있어요.";

  return `${name}: ${bits.join(", ")} 수준으로 ${tail}`;
}

export function compareTttv(a: any, b: any): number {
  const at = a.tttv,
    bt = b.tttv;
  if (!at || !bt) return (a.name || "").localeCompare(b.name || "", "ko-KR");
  if (bt.score !== at.score) return bt.score - at.score; // 1. 높은 점수
  if (at.timeToService !== bt.timeToService) return at.timeToService - bt.timeToService; // 2. 짧은 총 소요
  if (bt.preferencePercent !== at.preferencePercent) return bt.preferencePercent - at.preferencePercent; // 3. 높은 선호
  if (at.expectedTravel !== bt.expectedTravel) return at.expectedTravel - bt.expectedTravel; // 4. 짧은 이동
  return (a.name || "").localeCompare(b.name || "", "ko-KR"); // 5. 가나다
}

// 시설 배열에 tttv+reason 을 부여하고 정렬(데모/폴백/마커 공용). 기존 reason 은 보존.
export function rankFacilities(facilities: any[], opts: ScoreOpts): any[] {
  const scored = facilities.map((f) => {
    const tttv = scoreFacility(f, opts);
    return { ...f, tttv, reason: f.reason || buildReason(f, tttv) };
  });
  scored.sort(compareTttv);
  return scored;
}

// 백엔드 RecommendItem(camelCase) → 카드용 Tttv 형태로 변환.
export function recToTttv(rec: RecommendationResponse): Tttv {
  const b = (rec.breakdown || {}) as any;
  const wait = typeof b.waitTime === "number" ? b.waitTime : 0;
  const travel = typeof b.travelTime === "number" ? b.travelTime : (rec.distanceM || 0) / WALK_M_PER_MIN;
  const score01 = rec.tttvScore <= 1 ? rec.tttvScore : rec.tttvScore / 100;
  return {
    score: Math.round(score01 * 100),
    preferencePercent: Math.round((typeof b.preference === "number" ? b.preference : 0) * 100),
    expectedWait: Math.round(wait * 10) / 10,
    expectedTravel: Math.round(travel * 10) / 10,
    timeToService: Math.round((wait + travel) * 10) / 10,
  };
}
