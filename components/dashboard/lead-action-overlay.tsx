'use client';

import React, { useState, useEffect } from 'react';
import { X, Phone, Star, CheckCircle2, ChevronRight, Hash } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import type { HunterIntent } from '@/lib/types/hunter';

interface LeadActionOverlayProps {
  intent: HunterIntent;
  isOpen: boolean;
  onClose: () => void;
  onComplete: (phone?: string, score?: number) => Promise<void>;
}

export function LeadActionOverlay({
  intent,
  isOpen,
  onClose,
  onComplete
}: LeadActionOverlayProps) {
  const [step, setStep] = useState<'phone' | 'rating' | 'success'>('phone');
  const [phone, setPhone] = useState('');
  const [score, setScore] = useState<number | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset state on open
  useEffect(() => {
    if (isOpen) {
      setStep('phone');
      setPhone('');
      setScore(null);
      setIsSubmitting(false);
    }
  }, [isOpen]);

  const handleNext = () => {
    setStep('rating');
  };

  const handleScoreSelect = async (val: number) => {
    setScore(val);
    setIsSubmitting(true);
    await onComplete(phone, val);
    setIsSubmitting(false);
    setStep('success');
    
    // Auto close after success
    setTimeout(() => {
      onClose();
    }, 1500);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-100 flex items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div 
        className="absolute inset-0 bg-slate-900/60 backdrop-blur-xl animate-in fade-in duration-500" 
        onClick={onClose}
      />

      <Card className="relative w-full h-full sm:h-auto sm:max-w-lg overflow-hidden border-0 sm:border border-slate-200/50 bg-white/90 backdrop-blur-md shadow-2xl flex flex-col rounded-none sm:rounded-[2.5rem]">
        {/* Header */}
        <div className="p-6 flex items-center justify-between border-b border-slate-100 bg-white/50">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-blue-600 text-white flex items-center justify-center shadow-lg shadow-blue-500/20">
              <Hash size={20} />
            </div>
            <div>
              <h2 className="text-lg font-black text-slate-800 tracking-tight leading-none uppercase">
                {intent.utm_term || 'Bilinmeyen Niyet'}
              </h2>
              <p className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
                {intent.city || 'Konum Bilinmiyor'} · {new Date(intent.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="w-10 h-10 rounded-full hover:bg-slate-100 flex items-center justify-center text-slate-400 transition-colors"
          >
            <X size={24} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 flex flex-col items-center justify-center text-center space-y-8">
          {step === 'phone' && (
            <div className="w-full max-w-sm space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
              <div className="space-y-2">
                <div className="inline-flex p-4 bg-blue-50 rounded-3xl text-blue-600 mb-2">
                   <Phone size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">Müşteri Numarası</h3>
                <p className="text-slate-500 font-semibold text-sm">Görüşülen kişinin telefon numarasını girerek kaydı mühürleyin.</p>
              </div>

              <div className="relative">
                <input 
                  type="tel"
                  placeholder="05..."
                  autoFocus
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full h-20 text-center text-3xl font-black tracking-widest bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-blue-500 focus:bg-white outline-none transition-all placeholder:text-slate-200"
                />
              </div>

              <Button 
                onClick={handleNext}
                className="w-full h-16 bg-slate-900 hover:bg-black text-white rounded-2xl font-black text-lg shadow-xl"
              >
                DEVAM ET <ChevronRight className="ml-2" />
              </Button>
              
              <button 
                onClick={() => setStep('rating')}
                className="text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-colors"
              >
                Numara Girmeden Puanla
              </button>
            </div>
          )}

          {step === 'rating' && (
            <div className="w-full max-w-sm space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
               <div className="space-y-2">
                <div className="inline-flex p-4 bg-emerald-50 rounded-3xl text-emerald-600 mb-2">
                   <Star size={32} />
                </div>
                <h3 className="text-2xl font-black text-slate-800 tracking-tight">Leadi Puanla (1-100)</h3>
                <p className="text-slate-500 font-semibold text-sm">Bu niyet için 1 ile 100 arasında bir kalite puanı verin.</p>
              </div>

              <div className="relative">
                <input 
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="100"
                  placeholder="100"
                  autoFocus
                  value={score || ''}
                  onChange={(e) => {
                    const val = parseInt(e.target.value, 10);
                    if (!isNaN(val)) setScore(val);
                    else if (e.target.value === '') setScore(null);
                  }}
                  className="w-full h-24 text-center text-5xl font-black text-emerald-600 bg-slate-50 border-2 border-slate-100 rounded-3xl focus:border-emerald-500 focus:bg-white outline-none transition-all placeholder:text-slate-200"
                />
                <div className="absolute right-6 top-1/2 -translate-y-1/2 text-slate-300 font-black text-xl">PTS</div>
              </div>

              <Button 
                onClick={() => score && handleScoreSelect(score)}
                disabled={isSubmitting || !score || score < 1 || score > 100}
                className="w-full h-16 bg-emerald-600 hover:bg-emerald-700 text-white rounded-2xl font-black text-lg shadow-xl shadow-emerald-500/20"
              >
                {isSubmitting ? 'MÜHÜRLENİYOR...' : 'KAYDI MÜHÜRLE'}
              </Button>

              <div className="pt-4">
                 <button 
                  onClick={() => setStep('phone')}
                  className="text-slate-400 font-bold text-xs uppercase tracking-widest hover:text-slate-600 transition-colors flex items-center gap-2 mx-auto"
                 >
                   Telefon Adımına Dön
                 </button>
              </div>
            </div>
          )}

          {step === 'success' && (
            <div className="flex flex-col items-center justify-center space-y-4 animate-in zoom-in-95 duration-500">
              <div className="w-24 h-24 bg-emerald-500 rounded-full flex items-center justify-center text-white shadow-2xl shadow-emerald-500/50">
                 <CheckCircle2 size={48} />
              </div>
              <h3 className="text-3xl font-black text-slate-800 tracking-tight">MÜHÜRLENDİ</h3>
              <p className="text-emerald-600 font-bold uppercase tracking-widest text-xs">Reklam Paneline İletildi</p>
            </div>
          )}
        </div>

        {/* Footer padding for mobile safari */}
        <div className="h-4 sm:hidden bg-white/50" />
      </Card>
    </div>
  );
}
