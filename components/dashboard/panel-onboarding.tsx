'use client';

import React, { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Settings2 } from 'lucide-react';
import { useRouter } from 'next/navigation';

export function PanelOnboarding({ siteId }: { siteId: string }) {
  const router = useRouter();
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [baseValue, setBaseValue] = useState<string>('2000');
  const [labels, setLabels] = useState({
    v1: 'Sadece Bilgi',
    v2: 'İlgili (Sıcak)',
    v3: 'Teklif Verildi',
    v4: 'Kazanıldı',
  });

  const handleSave = async () => {
    setIsSubmitting(true);
    try {
      const response = await fetch(`/api/sites/${siteId}/config`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_deal_value_try: parseInt(baseValue, 10),
          pipeline_stages: [
             { id: 'g_trash', label: 'Çöp (Yanlış Numara)', action: 'discard', color: 'rose', order: 0 },
             { id: 'g_1', label: labels.v1, multiplier: 0.05, action: 'oci_ping', color: 'slate', order: 1 },
             { id: 'g_2', label: labels.v2, multiplier: 0.1, action: 'oci_ping', color: 'orange', order: 2 },
             { id: 'g_3', label: labels.v3, multiplier: 0.3, action: 'oci_ping', color: 'blue', order: 3 },
             { id: 'g_4', label: labels.v4, multiplier: 1.0, action: 'oci_ping', color: 'emerald', order: 4, is_macro: true }
          ]
        })
      });
      if (!response.ok) throw new Error('Failed to save config');
      router.refresh(); // Refresh page to remove onboarding blockade
    } catch (err) {
      console.error(err);
      alert('Kaydedilirken hata oluştu.');
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900 flex items-center justify-center p-4">
      <Card className="w-full max-w-lg p-6 bg-white rounded-3xl shadow-2xl relative overflow-hidden">
         <div className="absolute top-0 left-0 w-full h-1.5 bg-linear-to-r from-blue-500 to-emerald-500" />
         
         <div className="flex items-center gap-3 mb-6">
            <div className="p-3 bg-blue-100 rounded-2xl text-blue-600">
               <Settings2 size={24} />
            </div>
            <div>
               <h2 className="text-xl font-black text-slate-800">Panele Hoşgeldin!</h2>
               <p className="text-sm font-semibold text-slate-500">Sistemin senin dilinden konuşması için 2 kısa sorumuz var.</p>
            </div>
         </div>

         <div className="space-y-6">
            <div>
               <label className="block text-sm font-bold text-slate-700 mb-2">
                  Sizin sektörde bir işten elinize geçen net kazanç (veya ciro) ortalama ne kadardır?
               </label>
               <p className="text-xs font-semibold text-blue-600 mb-2">Bunu sadece 1 kere soracağız. İşleri bağladıkça matematik gizlice arkada bu rakam üzerinden çarpılacaktır.</p>
               <div className="relative">
                  <input 
                     type="number"
                     className="w-full h-14 pl-4 pr-12 text-xl font-black text-slate-800 bg-slate-50 border-2 border-slate-200 rounded-xl focus:border-blue-500 outline-none"
                     value={baseValue}
                     onChange={(e) => setBaseValue(e.target.value)}
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 font-bold text-slate-400">TL</span>
               </div>
            </div>

            <div>
               <label className="block text-sm font-bold text-slate-700 mb-2">
                  Satış yaparken hangi jargonu kullanırsın? (İstediğini değiştirebilirsin)
               </label>
               <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                     <span className="text-[10px] font-black text-slate-400 uppercase">Vites 1 (Fiyat Soran/Ölücü)</span>
                     <input type="text" className="w-full h-12 px-3 text-sm font-bold text-slate-700 bg-white border border-slate-200 rounded-lg" value={labels.v1} onChange={e => setLabels({...labels, v1: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <span className="text-[10px] font-black text-slate-400 uppercase">Vites 2 (Temas / İlgili)</span>
                     <input type="text" className="w-full h-12 px-3 text-sm font-bold text-orange-600 bg-white border border-orange-200 rounded-lg" value={labels.v2} onChange={e => setLabels({...labels, v2: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <span className="text-[10px] font-black text-slate-400 uppercase">Vites 3 (Konum/Sıcak Arama)</span>
                     <input type="text" className="w-full h-12 px-3 text-sm font-bold text-blue-600 bg-white border border-blue-200 rounded-lg" value={labels.v3} onChange={e => setLabels({...labels, v3: e.target.value})} />
                  </div>
                  <div className="space-y-1">
                     <span className="text-[10px] font-black text-slate-400 uppercase">Vites 4 (Mühür / İşi Aldım)</span>
                     <input type="text" className="w-full h-12 px-3 text-sm font-bold text-emerald-600 bg-white border border-emerald-200 rounded-lg" value={labels.v4} onChange={e => setLabels({...labels, v4: e.target.value})} />
                  </div>
               </div>
            </div>

            <Button 
               disabled={isSubmitting || !baseValue} 
               onClick={handleSave}
               className="w-full h-14 bg-blue-600 hover:bg-blue-700 text-white font-black text-lg rounded-xl shadow-lg shadow-blue-500/30"
            >
               {isSubmitting ? 'Kaydediliyor...' : 'KAYDET VE AKIŞA GEÇ'}
            </Button>
         </div>
      </Card>
    </div>
  );
}
