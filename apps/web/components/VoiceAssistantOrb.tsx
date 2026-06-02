"use client";

// 음성 비서 오버레이 UI(오브 + 자막). 고정 위치는 없음 — 부모가 배치한다(재사용성).
// 상태는 useVoiceAssistant 훅이 제공한다.
import React from "react";

type VoiceState = "idle" | "speaking" | "listening" | "thinking";

interface Props {
  active: boolean;
  voiceState: VoiceState;
  liveTranscript: string;
  caption: string;
  muted: boolean;
  sttSupported: boolean;
  onOrb: () => void;
  onToggleMute: () => void;
}

export default function VoiceAssistantOrb({
  active, voiceState, liveTranscript, caption, muted, sttSupported, onOrb, onToggleMute,
}: Props) {
  return (
    <div className="flex flex-col items-end gap-2 select-none pointer-events-auto">
      {/* 자막 / 안내 pill (스크린리더 라이브 영역) */}
      {active && (
        <div
          role="status"
          aria-live="polite"
          aria-atomic="true"
          className="max-w-[15rem] md:max-w-[17rem] border border-white/10 rounded-2xl px-3.5 py-2.5 shadow-xl bg-[#0b1022]/95 backdrop-blur"
        >
          <div className="flex items-center gap-1.5 mb-1">
            <span className="flex gap-0.5">
              <span className="w-1.5 h-1.5 rounded-full bg-sky-400" />
              <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[10px] font-bold tracking-wide bg-gradient-to-r from-sky-400 to-purple-400 bg-clip-text text-transparent">
              InduSpot 음성 비서
            </span>
          </div>
          <p className="text-[11px] leading-snug text-slate-200 min-h-[1.1rem]">
            {voiceState === "listening"
              ? liveTranscript
                ? `“${liveTranscript}”`
                : "듣고 있어요…"
              : voiceState === "thinking"
              ? "✨ 응답을 해석하고 있어요…"
              : voiceState === "speaking"
              ? caption || "추천을 안내하고 있어요. 끝나면 말씀해 주세요."
              : "음성으로 응답할 수 있어요."}
          </p>
          <p className="text-[9px] text-slate-500 mt-1">응=수락 · 다음=넘기기 · 자세히 · 그만</p>
          {!sttSupported && (
            <p className="text-[9px] text-amber-300/90 mt-1">음성 응답 미지원 — 카드 버튼으로 응답해 주세요</p>
          )}
        </div>
      )}

      <div className="flex items-center gap-2">
        {active && (
          <button
            type="button"
            onClick={onToggleMute}
            aria-label={muted ? "음성 안내 켜기" : "음성 안내 끄기"}
            className="w-9 h-9 rounded-full flex items-center justify-center border border-white/10 bg-white/5 text-slate-300 hover:text-white text-sm transition-all"
          >
            {muted ? "🔇" : "🔈"}
          </button>
        )}
        <button
          type="button"
          onClick={onOrb}
          aria-label={active ? "음성 안내 정지" : "AI 음성 추천 듣기"}
          className={`relative w-14 h-14 rounded-full flex items-center justify-center text-xl shadow-lg transition-all active:scale-95 border ${
            voiceState === "listening"
              ? "bg-emerald-500/20 border-emerald-400/60 shadow-emerald-500/20"
              : voiceState === "speaking"
              ? "bg-purple-500/20 border-purple-400/60 shadow-purple-500/20"
              : voiceState === "thinking"
              ? "bg-sky-500/20 border-sky-400/60"
              : "bg-gradient-to-br from-sky-500/30 to-purple-600/30 border-white/20"
          }`}
        >
          {!active && <span className="absolute inset-0 rounded-full border border-sky-400/40 animate-ping" />}
          {!active ? (
            <span>🔊</span>
          ) : voiceState === "speaking" ? (
            <span className="flex items-end gap-0.5 h-5">
              {[0, 1, 2, 3].map((i) => (
                <span
                  key={i}
                  className="w-1 bg-purple-300 rounded-full animate-pulse"
                  style={{ height: `${8 + (i % 2) * 8}px`, animationDelay: `${i * 120}ms` }}
                />
              ))}
            </span>
          ) : voiceState === "listening" ? (
            <span className="relative flex items-center justify-center">
              <span className="absolute w-9 h-9 rounded-full bg-emerald-400/20 animate-ping" />
              <span className="flex gap-1">
                {[0, 1, 2].map((i) => (
                  <span
                    key={i}
                    className="w-1.5 h-1.5 rounded-full bg-emerald-300 animate-bounce"
                    style={{ animationDelay: `${i * 150}ms` }}
                  />
                ))}
              </span>
            </span>
          ) : voiceState === "thinking" ? (
            <span className="w-5 h-5 border-2 border-sky-300 border-t-transparent rounded-full animate-spin" />
          ) : (
            <span>🔊</span>
          )}
        </button>
      </div>

      {!active && (
        <span className="text-[10px] text-slate-200 bg-black/60 border border-white/10 rounded-full px-2.5 py-1 animate-pulse whitespace-nowrap">
          🔊 AI 음성 추천 듣기
        </span>
      )}
    </div>
  );
}
