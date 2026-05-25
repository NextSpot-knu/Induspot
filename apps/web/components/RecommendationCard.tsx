import { Bookmark, Sparkles } from 'lucide-react';

interface RecommendationCardProps {
  title: string;
  matchPercentage: number;
  description: string;
  onAccept: () => void;
  onReject: () => void;
}

export function RecommendationCard({
  title,
  matchPercentage,
  description,
  onAccept,
  onReject,
}: RecommendationCardProps) {
  return (
    <div className="w-full bg-[#131a28]/80 backdrop-blur-2xl border border-white/10 rounded-2xl p-5 shadow-2xl flex flex-col gap-4">
      {/* Top Section */}
      <div className="flex justify-between items-start">
        <div>
          <div className="flex items-center gap-2 text-blue-400 mb-2 text-sm font-medium">
            <Sparkles size={16} />
            <span>AI RECOMMENDED</span>
          </div>
          <h3 className="text-2xl font-bold text-white mb-2">{title}</h3>
          <p className="text-gray-400 text-sm leading-relaxed max-w-[80%]">
            {description}
          </p>
        </div>
        
        {/* Match Badge */}
        <div className="flex flex-col items-center justify-center w-16 h-16 rounded-full border border-blue-500/30 bg-blue-500/10">
          <span className="text-white font-bold">{matchPercentage}%</span>
          <span className="text-xs text-blue-300">Match</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex gap-3 mt-2">
        <button
          onClick={onReject}
          className="flex-1 bg-white/5 hover:bg-white/10 text-gray-300 font-semibold py-3.5 rounded-xl border border-white/20 transition-colors"
        >
          Reject
        </button>
        <button
          onClick={onAccept}
          className="flex-1 bg-[#104bce] hover:bg-blue-700 text-white font-semibold py-3.5 rounded-xl transition-colors"
        >
          Accept Route
        </button>
      </div>
    </div>
  );
}
