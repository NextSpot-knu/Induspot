export const getMarkerSvg = (type: string, level: number, features?: any) => {
  let color = "#3b82f6"; // blue (한산)
  if (level >= 0.75) {
    color = "#f97316"; // orange (혼잡)
  } else if (level >= 0.50) {
    color = "#f59e0b"; // yellow (보통)
  } else if (level >= 0.25) {
    color = "#10b981"; // green (여유)
  }

  let emoji = "📍";
  if (type === "cafeteria") emoji = "🍴";
  else if (type === "parking") emoji = "🚗";
  else if (type === "meeting_room") emoji = "🤝";
  else if (type === "rest_area" || type === "loading_dock") emoji = "🛋️";

  const isPrivateParking = type === "parking" && features && (features.is_private === true || features.is_public === false);

  if (isPrivateParking) {
    emoji = "🏢"; // 사내 주차장 이모지
    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="40" height="40" viewBox="0 0 40 40">
        <rect x="4" y="4" width="32" height="32" rx="11" fill="${color}" stroke="#ffffff" stroke-width="1"/>
        <circle cx="20" cy="20" r="12" fill="#ffffff"/>
        <text x="20" y="24.5" font-size="13" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  // 얇은 흰 테두리 + 넓은 흰 원(색 띠를 얇게) + 그림자 없음(플랫·클린)
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="36" height="46" viewBox="0 0 36 46">
      <path fill="${color}" stroke="#ffffff" stroke-width="1" d="M18 0C8.1 0 0 8.1 0 18c0 13.5 16.5 26.5 17.1 27.1a1.2 1.2 0 0 0 1.8 0c.6-.6 17.1-13.6 17.1-27.1C36 8.1 27.9 0 18 0z"/>
      <circle cx="18" cy="18" r="12.5" fill="#ffffff"/>
      <text x="18" y="22.6" font-size="13" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};
