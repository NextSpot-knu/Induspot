export const getMarkerSvg = (
  type: string,
  level: number,
  features?: any,
  selected: boolean = false
) => {
  // 평소엔 연한 색, 선택 시 진한 색으로 구분 (파랑 한산 / 초록 여유 / 노랑 보통 / 빨강 혼잡)
  // 지도에 다크 invert 필터가 걸려 있어 'SVG가 진할수록 화면에선 밝게' 보인다.
  // 평소 = 진한 600계열(화면에서 또렷·밝게), 선택 시 = 한 단계 더 진한 700계열(화면에서 더 밝게).
  const p =
    level >= 0.75
      ? { base: "#e11d48", sel: "#9f1239" } // 혼잡 (red): 평소 600 / 선택 800
      : level >= 0.5
      ? { base: "#d97706", sel: "#92400e" } // 보통 (yellow)
      : level >= 0.25
      ? { base: "#059669", sel: "#065f46" } // 여유 (green)
      : { base: "#2563eb", sel: "#1e40af" }; // 한산 (blue)
  const color = selected ? p.sel : p.base;

  let emoji = "📍";
  if (type === "cafeteria") emoji = "🍴";
  else if (type === "parking") emoji = "🚗";
  else if (type === "meeting_room") emoji = "🤝";
  else if (type === "rest_area" || type === "loading_dock") emoji = "🛋️";

  const isPrivateParking =
    type === "parking" && features && (features.is_private === true || features.is_public === false);
  if (isPrivateParking) emoji = "🏢";

  if (isPrivateParking) {
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <rect x="4" y="4" width="32" height="32" rx="11" fill="${color}" stroke="#ffffff" stroke-width="1"/>
        <circle cx="20" cy="20" r="13" fill="#ffffff"/>
        <text x="20" y="24.5" font-size="13" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  // 얇은 흰 테두리 + 넓은 흰 원(색 띠를 더 얇게) + 그림자 없음(플랫·클린)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
      <path fill="${color}" stroke="#ffffff" stroke-width="1" d="M18 0C8.1 0 0 8.1 0 18c0 13.5 16.5 26.5 17.1 27.1a1.2 1.2 0 0 0 1.8 0c.6-.6 17.1-13.6 17.1-27.1C36 8.1 27.9 0 18 0z"/>
      <circle cx="18" cy="18" r="13" fill="#ffffff"/>
      <text x="18" y="22.6" font-size="13" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};
