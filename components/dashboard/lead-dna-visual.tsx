
import React from 'react';
import { Shield, Zap, TrendingUp, Smartphone, MapPin, Timer, UserCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

interface LeadDnaVisualProps {
  dna: string;
  score: number;
  insights?: { label: string; icon: string; value: string }[];
  className?: string;
}

const iconMap: Record<string, React.ElementType> = {
  ShieldCheck: Shield,
  Zap: Zap,
  TrendingUp: TrendingUp,
  Smartphone: Smartphone,
  MapPin: MapPin,
  Timer: Timer,
  UserCheck: UserCheck,
};

export const LeadDnaVisual: React.FC<LeadDnaVisualProps> = ({ dna, score, insights, className }) => {
  // Map DNA hex chars to colors
  const getDnaColor = (char: string) => {
    const colors = [
      'bg-slate-400', 'bg-blue-400', 'bg-emerald-400', 'bg-violet-400',
      'bg-amber-400', 'bg-rose-400', 'bg-indigo-400', 'bg-cyan-400',
      'bg-orange-400', 'bg-lime-400', 'bg-teal-400', 'bg-fuchsia-400',
      'bg-sky-400', 'bg-pink-400', 'bg-emerald-600', 'bg-violet-600'
    ];
    const index = parseInt(char, 16);
    return colors[index % colors.length];
  };

  return (
    <div className={cn("p-4 rounded-xl bg-slate-900/50 border border-slate-800 shadow-2xl backdrop-blur-md", className)}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="p-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
            <Shield className="w-4 h-4 text-emerald-400" />
          </div>
          <span className="text-xs font-bold text-slate-400 uppercase tracking-widest">Forensic DNA Trace</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-mono text-slate-500">{dna}</span>
          <div className="flex gap-0.5">
            {dna.split('').map((char, i) => (
              <div 
                key={i} 
                className={cn("w-1.5 h-3 rounded-full opacity-80", getDnaColor(char))}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 mb-4">
        <div className="p-3 rounded-lg bg-black/40 border border-slate-800 flex flex-col items-center justify-center relative overflow-hidden group">
          <div className="absolute inset-0 bg-linear-to-br from-emerald-500/5 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
          <span className="text-[10px] text-slate-500 uppercase font-semibold">Singularity Score</span>
          <span className={cn(
            "text-2xl font-black tracking-tighter",
            score >= 80 ? "text-emerald-400" : score >= 50 ? "text-blue-400" : "text-amber-400"
          )}>
            {score}%
          </span>
        </div>
        <div className="p-3 rounded-lg bg-black/40 border border-slate-800 flex flex-col items-center justify-center">
          <span className="text-[10px] text-slate-500 uppercase font-semibold">Risk Factor</span>
          <span className="text-xl font-bold text-slate-200">
            {score > 90 ? "Ultra Minimal" : score > 70 ? "Low" : "Standard"}
          </span>
        </div>
      </div>

      {insights && insights.length > 0 && (
        <div className="space-y-2">
          <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Signal Insights</span>
          <div className="grid grid-cols-1 gap-1.5">
            {insights.map((insight, i) => {
              const Icon = iconMap[insight.icon] || Zap;
              return (
                <div key={i} className="flex items-center justify-between p-2 rounded-lg bg-slate-800/30 border border-slate-700/50 hover:bg-slate-800/50 transition-colors">
                  <div className="flex items-center gap-2">
                    <Icon className="w-3.5 h-3.5 text-blue-400" />
                    <span className="text-xs text-slate-300 font-medium">{insight.label}</span>
                  </div>
                  <span className="text-[10px] font-mono text-slate-500">{insight.value}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
