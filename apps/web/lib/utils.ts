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
      <svg xmlns="http://www.w3.org/2000/svg" width="18" height="23" viewBox="0 0 36 46">
        <path fill="${color}" stroke="%23ffffff" stroke-width="2" d="M6 2h24a4 4 0 0 1 4 4v22a4 4 0 0 1-4 4h-9l-3 12-3-12H6a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4z"/>
        <circle cx="18" cy="17" r="11" fill="%23ffffff"/>
        <text x="18" y="21" font-size="12" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
      </svg>
    `;
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
  }

  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="23" viewBox="0 0 36 46">
      <path fill="${color}" stroke="%23ffffff" stroke-width="2" d="M18 0C8.1 0 0 8.1 0 18c0 13.5 16.5 26.5 17.1 27.1a1.2 1.2 0 0 0 1.8 0c.6-.6 17.1-13.6 17.1-27.1C36 8.1 27.9 0 18 0z"/>
      <circle cx="18" cy="18" r="11" fill="%23ffffff"/>
      <text x="18" y="22" font-size="12" text-anchor="middle" font-family="Segoe UI Symbol, Apple Color Emoji, sans-serif">${emoji}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg.trim())}`;
};
