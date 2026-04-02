import { defineConfig, presetMini } from 'unocss';
import extractorSvelte from '@unocss/extractor-svelte';

export default defineConfig({
  presets: [
    presetMini(),
  ],
  extractors: [
    extractorSvelte(),
  ],
  theme: {
    colors: {
      accent: {
        50: '#eff6ff',
        100: '#dbeafe',
        200: '#bfdbfe',
        500: '#3b82f6',
        600: '#2563eb',
        700: '#1d4ed8',
      },
    },
  },
  shortcuts: {
    'app-shell': 'min-h-screen bg-[linear-gradient(180deg,#f8fafc_0%,#f1f5f9_100%)] text-slate-800',
    'panel': 'rounded-2xl border border-slate-200 bg-white shadow-sm',
    'panel-body': 'p-4 md:p-5',
    'panel-kicker': 'text-[11px] font-semibold [text-transform:uppercase] tracking-[0.18em] text-slate-500',
    'panel-title': 'text-lg font-semibold text-slate-900',
    'toolbar': 'grid gap-3 md:grid-cols-4',
    'field': 'grid gap-1.5',
    'input-base': 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-3 focus:ring-slate-200',
    'textarea-base': 'w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-800 shadow-sm outline-none transition focus:border-slate-400 focus:ring-3 focus:ring-slate-200',
    'btn': 'inline-flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
    'btn-primary': 'border-accent-600 bg-accent-600 text-white hover:bg-accent-700',
    'btn-danger': 'border-rose-200 bg-rose-50 text-rose-700 hover:bg-rose-100',
    'btn-xs': 'inline-flex items-center justify-center rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50',
    'badge': 'inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-medium',
    'badge-muted': 'border-slate-200 bg-slate-50 text-slate-600',
    'badge-info': 'border-accent-200 bg-accent-50 text-accent-700',
    'badge-success': 'border-emerald-200 bg-emerald-50 text-emerald-700',
    'badge-warn': 'border-amber-200 bg-amber-50 text-amber-700',
    'badge-danger': 'border-rose-200 bg-rose-50 text-rose-700',
    'stat-card': 'rounded-2xl border border-slate-200 bg-white p-4 shadow-sm',
    'progress-shell': 'h-2.5 overflow-hidden rounded-full bg-slate-100',
    'table-wrap': 'overflow-x-auto rounded-xl border border-slate-200',
  },
});
