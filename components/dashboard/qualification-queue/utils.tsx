import React from 'react';
import { Icons } from '@/components/icons';
import { CheckCircle2, MessageCircle, Phone, FileText, XOctagon } from 'lucide-react';

export function peekBorderClass(action: string | null | undefined) {
  const t = (action || '').toLowerCase();
  if (t === 'whatsapp') return 'border-l-4 border-green-500';
  if (t === 'phone') return 'border-l-4 border-blue-500';
  if (t === 'form') return 'border-l-4 border-purple-500';
  return 'border-l-4 border-border';
}

export function iconForAction(a: string | null) {
  const t = (a || '').toLowerCase();
  if (t === 'whatsapp') return MessageCircle;
  if (t === 'phone') return Phone;
  if (t === 'form') return FileText;
  return Icons.circleDot;
}

export function statusBadge(status: string | null) {
  const s = (status || 'intent').toLowerCase();
  if (s === 'confirmed' || s === 'qualified' || s === 'real') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-emerald-200 bg-emerald-50 px-2 py-0.5 text-xs font-medium text-emerald-800">
        <CheckCircle2 className="h-3 w-3" />
        Sealed
      </span>
    );
  }
  if (s === 'cancelled') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
        <XOctagon className="h-3 w-3" />
        Cancelled
      </span>
    );
  }
  if (s === 'junk') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-red-200 bg-red-50 px-2 py-0.5 text-xs font-medium text-red-800">
        <XOctagon className="h-3 w-3" />
        Junk
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-xs font-medium text-slate-700">
      <Icons.circleDot className="h-3 w-3" />
      Intent
    </span>
  );
}

