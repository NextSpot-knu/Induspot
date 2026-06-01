export const getMarkerSvg = (
  type: string,
  level: number,
  features?: any,
  selected: boolean = false
) => {
  // 마커는 지도 다크 필터를 우회(타일에만 적용)하므로 본래의 색으로 표시된다.
  // 평소 = 600계열, 선택 = 한 단계 밝은 500계열.
  const p =
    level >= 0.75
      ? { base: "#dc2626", sel: "#ef4444" } // 혼잡 (red)
      : level >= 0.5
      ? { base: "#d97706", sel: "#f59e0b" } // 보통 (yellow)
      : level >= 0.25
      ? { base: "#059669", sel: "#10b981" } // 여유 (green)
      : { base: "#2563eb", sel: "#3b82f6" }; // 한산 (blue)
  const color = selected ? p.sel : p.base;

  let emoji = "📍";
  if (type === "cafeteria") emoji = "🍴";
  else if (type === "parking") emoji = "🚗";
  else if (type === "meeting_room") emoji = "🤝";
  else if (type === "rest_area" || type === "loading_dock") emoji = "🛋️";

  const isPrivateParking =
    type === "parking" && features && (features.is_private === true || features.is_public === false);
  if (isPrivateParking) emoji = "🏢";

  // 로고(이모지)를 흰색 실루엣으로 만드는 필터 (RGB→흰색, 알파 유지)
  const whiteFilter =
    '<filter id="w"><feColorMatrix type="matrix" values="0 0 0 0 1 0 0 0 0 1 0 0 0 0 1 0 0 0 1 0"/></filter>';

  if (isPrivateParking) {
    // 흰 테두리 없음 + 까만 원 + 흰 로고
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <defs>${whiteFilter}</defs>
        <rect x="2" y="2" width="36" height="36" rx="11" fill="${color}"/>
        <circle cx="20" cy="20" r="11.5" fill="#000000"/>
        <text x="20" y="24.5" font-size="13" text-anchor="middle" filter="url(#w)" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  // 흰 테두리 없음 + 까만 원 + 흰 로고
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
      <defs>${whiteFilter}</defs>
      <path fill="${color}" d="M18 0C8.1 0 0 8.1 0 18c0 13.5 16.5 26.5 17.1 27.1a1.2 1.2 0 0 0 1.8 0c.6-.6 17.1-13.6 17.1-27.1C36 8.1 27.9 0 18 0z"/>
      <circle cx="18" cy="18" r="11" fill="#000000"/>
      <text x="18" y="22.6" font-size="13" text-anchor="middle" filter="url(#w)" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};
