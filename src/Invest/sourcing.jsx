import React from "react";

export default function Sourcing() {
  return (
    <div className="p-6 space-y-6">
      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium uppercase tracking-wide text-amber-700">
            Profero Invest
          </p>

          <h1 className="text-2xl font-bold text-slate-900">
            Sourcing
          </h1>

          <p className="max-w-4xl text-sm text-slate-600">
            Radar d’opportunités immobilières destiné à détecter, analyser et qualifier les annonces intéressantes avant leur transformation en fiche bien dans le Stock de biens.
          </p>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Annonces détectées</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">0</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Opportunités A / A+</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">0</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">Baisses de prix</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">0</p>
        </div>

        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <p className="text-sm text-slate-500">À contacter</p>
          <p className="mt-2 text-3xl font-bold text-slate-900">0</p>
        </div>
      </div>

      <div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap gap-2 border-b border-slate-200 pb-4">
          <button className="rounded-full bg-slate-900 px-4 py-2 text-sm font-medium text-white">
            Dashboard
          </button>

          <button className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            Annonces détectées
          </button>

          <button className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            Critères de recherche
          </button>

          <button className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            Analyse automatique
          </button>

          <button className="rounded-full bg-slate-100 px-4 py-2 text-sm font-medium text-slate-700">
            Historique / logs
          </button>
        </div>

        <div className="mt-6 rounded-2xl border border-dashed border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold text-slate-900">
            Module Sourcing prêt à être connecté
          </h2>

          <p className="mt-2 text-sm text-slate-700">
            La prochaine étape sera de connecter cette page aux tables Supabase :
            <strong> sourcing_annonces</strong>, <strong> sourcing_criteres</strong> et <strong> sourcing_logs</strong>.
          </p>
        </div>
      </div>
    </div>
  );
}
