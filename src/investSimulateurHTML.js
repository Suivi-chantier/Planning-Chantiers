// HTML du simulateur Profero Invest — ne pas modifier manuellement
export function getSimulateurHTML() {
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Simulateur Profero Invest</title>
<link href="https://fonts.googleapis.com/css2?family=DM+Mono:wght@400;500&family=Sora:wght@300;400;600;700;800&display=swap" rel="stylesheet">
<script src="https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js"><\/script>
<style>
:root{
  --navy:#1a2d4a;--navy2:#162844;--navy3:#1e3a5f;
  --profero-blue:#1f4ea1;
  --gold:#c9a84c;--gold-light:#f0d080;--gold-pale:#fffde7;
  --green:#1a7a4a;--green-light:#e6f5ee;
  --red:#c0392b;--red-light:#fdf0ef;--orange:#d4610a;--orange-light:#fef3e9;
  --white:#ffffff;--gray50:#f8f9fb;--gray100:#eef0f5;--gray200:#d8dce6;
  --gray400:#9aa0b0;--gray600:#5a6070;--gray800:#2c3040;
  --input-bg:#fffef5;--input-border:#c9a84c;
  --shadow-sm:0 1px 4px rgba(15,30,53,.08);
  --radius:10px;--radius-sm:6px;
}
*{box-sizing:border-box;margin:0;padding:0;}
body{font-family:'Sora',sans-serif;background:var(--gray50);color:var(--gray800);min-height:100vh;font-size:13px;}
.tabs-nav{background:var(--navy);display:flex;padding:0 24px;gap:2px;border-bottom:2px solid var(--navy3);}
.tab-btn{padding:11px 20px;font-family:'Sora',sans-serif;font-size:12px;font-weight:600;color:var(--gray400);background:transparent;border:none;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .15s;}
.tab-btn:hover{color:white;}.tab-btn.active{color:var(--gold);border-bottom-color:var(--gold);}
.tab-content{display:none;}.tab-content.active{display:block;}
.page{padding:20px 24px;max-width:1200px;margin:0 auto;}
.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px;}
.card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow-sm);border:1px solid var(--gray100);overflow:hidden;}
.card-header{background:var(--navy);color:white;padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;display:flex;align-items:center;gap:8px;}
.card-header.mid{background:var(--navy3);}.card-header.gold{background:var(--gold);color:var(--navy);}.card-header.danger{background:#c0392b;}.card-header.profero{background:var(--profero-blue);}
.card-body{padding:14px 16px;}
.row{display:grid;grid-template-columns:1fr auto;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray100);gap:12px;}
.row:last-child{border-bottom:none;}.row.total{border-top:2px solid var(--navy);margin-top:4px;padding-top:8px;border-bottom:none;}.row.subtotal{background:var(--gray50);margin:0 -16px;padding:6px 16px;}
.row-label{font-size:12px;color:var(--gray600);}.row-label.bold{font-weight:700;color:var(--gray800);}
.row-value{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;white-space:nowrap;}
.row-value.calc{color:var(--navy3);}.row-value.green{color:var(--green);font-weight:700;}.row-value.orange{color:var(--orange);font-weight:700;}.row-value.red{color:var(--red);font-weight:700;}
input[type=number],input[type=text],select{font-family:'DM Mono',monospace;font-size:13px;font-weight:500;color:#0033aa;background:var(--input-bg);border:1.5px solid var(--input-border);border-radius:var(--radius-sm);padding:5px 10px;text-align:right;outline:none;transition:border-color .15s,box-shadow .15s;}
input[type=number]:focus,select:focus{border-color:#2a7fd4;box-shadow:0 0 0 3px rgba(42,127,212,.15);}
select{text-align:left;cursor:pointer;}
.kpi-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:16px;}
.kpi{background:white;border-radius:var(--radius);padding:14px 16px;border:1px solid var(--gray100);box-shadow:var(--shadow-sm);display:flex;flex-direction:column;gap:4px;}
.kpi-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.07em;color:var(--gray400);}
.kpi-value{font-family:'DM Mono',monospace;font-size:22px;font-weight:700;color:var(--navy);}
.kpi-value.green{color:var(--green);}.kpi-value.orange{color:var(--orange);}.kpi-value.red{color:var(--red);}
.kpi-sub{font-size:11px;color:var(--gray400);}
.scenario-toggle{display:flex;gap:6px;margin-top:6px;}
.scen-btn{flex:1;padding:6px;border-radius:var(--radius-sm);font-family:'Sora',sans-serif;font-size:11px;font-weight:700;border:1.5px solid var(--gray200);background:var(--gray50);color:var(--gray400);cursor:pointer;transition:all .15s;text-align:center;}
.scen-btn.active{background:var(--profero-blue);color:white;border-color:var(--profero-blue);}
.scenario-header{display:grid;grid-template-columns:1fr 110px 110px;padding:8px 16px;background:var(--navy3);font-size:11px;font-weight:700;color:white;letter-spacing:.04em;}
.scenario-row{display:grid;grid-template-columns:1fr 110px 110px;align-items:center;padding:6px 16px;border-bottom:1px solid var(--gray100);gap:8px;}
.scenario-row:last-child{border-bottom:none;}.scenario-row.highlight{background:var(--green-light);}.scenario-row.warning{background:var(--orange-light);}
.s-val{font-family:'DM Mono',monospace;font-size:13px;text-align:right;font-weight:500;}
.s-val.green{color:var(--green);font-weight:700;}.s-val.orange{color:var(--orange);font-weight:700;}.s-val.input-cell{padding:0;}
.lot-table-wrap{overflow-x:auto;width:100%;}
.lot-grid{display:grid;grid-template-columns:90px 85px 80px 100px 78px 70px 72px 1fr 60px;gap:6px;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray100);min-width:720px;}
.lot-grid.header{font-size:10px;font-weight:700;color:var(--gray400);letter-spacing:.05em;text-transform:uppercase;padding-bottom:8px;border-bottom:2px solid var(--gray200);}
.lot-grid input,.lot-grid select{width:100%;}
.lot-lv{font-family:'DM Mono',monospace;font-size:12px;text-align:right;color:var(--gray600);}
.btn-remove{background:none;border:none;cursor:pointer;color:var(--gray400);font-size:16px;padding:0 4px;line-height:1;transition:color .15s;}.btn-remove:hover{color:var(--red);}
.btn-add-lot{display:flex;align-items:center;justify-content:center;gap:6px;margin-top:10px;padding:7px 14px;background:var(--gray50);border:1.5px dashed var(--gray200);border-radius:var(--radius-sm);cursor:pointer;font-family:'Sora',sans-serif;font-size:12px;font-weight:600;color:var(--profero-blue);transition:all .15s;width:100%;}
.btn-add-lot:hover{background:var(--gray100);border-color:var(--profero-blue);}
.toggle-wrap{display:flex;align-items:center;gap:10px;padding:8px 0;}
.toggle{position:relative;width:40px;height:22px;}.toggle input{opacity:0;width:0;height:0;}
.toggle-slider{position:absolute;inset:0;background:var(--gray200);border-radius:22px;cursor:pointer;transition:.2s;}
.toggle-slider:before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:white;border-radius:50%;transition:.2s;}
input:checked+.toggle-slider{background:var(--profero-blue);}
input:checked+.toggle-slider:before{transform:translateX(18px);}
.budget-section-header{background:var(--navy3);color:white;padding:8px 14px;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;margin:10px -16px 4px;display:flex;align-items:center;gap:6px;}
.brow{display:grid;grid-template-columns:1fr 75px 72px 82px 82px;padding:5px 0;border-bottom:1px solid var(--gray100);align-items:center;gap:6px;}
.brow.bhead{font-size:10px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.05em;border-bottom:2px solid var(--gray200);padding-bottom:8px;}
.brow .bl{font-size:12px;color:var(--gray600);}
.brow .bn{font-family:'DM Mono',monospace;font-size:12px;text-align:right;}
.brow input[type=number],.brow input[type=text]{width:100%;font-size:12px;padding:4px 7px;}
.brow input[type=text]{text-align:left;}
.btn-add-divers{display:inline-flex;align-items:center;gap:5px;padding:5px 12px;background:var(--gray50);border:1.5px dashed var(--gray200);border-radius:var(--radius-sm);cursor:pointer;font-family:'Sora',sans-serif;font-size:11px;font-weight:600;color:var(--profero-blue);transition:all .15s;margin-top:6px;}
.btn-add-divers:hover{background:var(--gray100);border-color:var(--profero-blue);}
.fisca-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;}
.regime-card{background:white;border-radius:var(--radius);border:1px solid var(--gray100);overflow:hidden;box-shadow:var(--shadow-sm);}
.regime-header{padding:12px 16px;font-size:12px;font-weight:700;color:white;}
.regime-header.is{background:var(--navy3);}.regime-header.ir{background:#6b3a8a;}.regime-header.lmnp{background:var(--green);}
.regime-row{display:flex;justify-content:space-between;align-items:center;padding:6px 14px;border-bottom:1px solid var(--gray100);gap:8px;}
.regime-row:last-child{border-bottom:none;}
.regime-row .rl{font-size:11px;color:var(--gray600);flex:1;}
.regime-row .rv{font-family:'DM Mono',monospace;font-size:13px;font-weight:600;text-align:right;}
.regime-row.highlight{background:var(--green-light);}.regime-row.warn{background:var(--orange-light);}
.pct-badge{display:inline-block;padding:2px 7px;border-radius:20px;font-size:10px;font-weight:700;background:var(--gray100);color:var(--gray600);font-family:'DM Mono',monospace;margin-left:6px;}
.modal-overlay{display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:1000;align-items:center;justify-content:center;}
.modal-overlay.open{display:flex;}
.modal{background:white;border-radius:12px;padding:28px;max-width:400px;width:90%;box-shadow:0 20px 60px rgba(0,0,0,.3);text-align:center;}
.modal-icon{font-size:40px;margin-bottom:12px;}
.modal-title{font-size:16px;font-weight:800;color:var(--navy);margin-bottom:8px;}
.modal-text{font-size:13px;color:var(--gray600);margin-bottom:24px;line-height:1.6;}
.modal-actions{display:flex;gap:10px;justify-content:center;}
.btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:var(--radius-sm);font-family:'Sora',sans-serif;font-size:12px;font-weight:600;cursor:pointer;border:none;transition:all .15s;white-space:nowrap;}
.btn-blue{background:var(--profero-blue);color:white;}.btn-blue:hover{background:#1740c0;}
.btn-outline{background:transparent;color:var(--navy);border:1.5px solid var(--gray200);}.btn-outline:hover{background:var(--gray50);}
.btn-gold{background:var(--gold);color:var(--navy);}.btn-gold:hover{background:var(--gold-light);}
.btn-danger{background:var(--red);color:white;}.btn-danger:hover{background:#a93226;}
.project-bar{background:var(--gray50);border-bottom:1px solid var(--gray200);padding:8px 24px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;}
.project-label{font-size:11px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;white-space:nowrap;}
.project-name-input{font-family:'Sora',sans-serif;font-size:13px;font-weight:600;color:var(--navy);background:var(--white);border:1.5px solid var(--gray200);border-radius:var(--radius-sm);padding:6px 12px;outline:none;transition:border-color .15s;width:280px;}
.project-name-input:focus{border-color:var(--profero-blue);}
.project-date{font-size:11px;color:var(--gray400);}
.chart-card{background:var(--white);border-radius:var(--radius);box-shadow:var(--shadow-sm);border:1px solid var(--gray100);overflow:hidden;display:flex;flex-direction:column;}
.chart-card-header{background:var(--navy);color:white;padding:10px 16px;font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;}
.chart-card-body{padding:16px;flex:1;display:flex;flex-direction:column;gap:16px;}
.donut-wrap{display:flex;align-items:center;gap:16px;}
.donut-legend{display:flex;flex-direction:column;gap:7px;flex:1;}
.legend-item{display:flex;align-items:center;gap:8px;font-size:11px;}
.legend-dot{width:10px;height:10px;border-radius:50%;flex-shrink:0;}
.legend-label{color:var(--gray600);flex:1;}
.legend-val{font-family:'DM Mono',monospace;font-size:11px;font-weight:600;color:var(--gray800);text-align:right;}
.legend-pct{font-family:'DM Mono',monospace;font-size:10px;color:var(--gray400);min-width:34px;text-align:right;}
.stat-row{display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--gray100);}
.stat-row:last-child{border-bottom:none;}
.stat-label{font-size:11px;color:var(--gray600);}
.stat-val{font-family:'DM Mono',monospace;font-size:13px;font-weight:700;}
.stat-val.green{color:var(--green);}.stat-val.orange{color:var(--orange);}.stat-val.red{color:var(--red);}
.gauge-wrap{padding:4px 0;}
.gauge-label{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--gray400);margin-bottom:6px;}
.gauge-bar{height:8px;background:var(--gray100);border-radius:4px;overflow:hidden;}
.gauge-fill{height:100%;border-radius:4px;transition:width .4s ease;}
.gauge-vals{display:flex;justify-content:space-between;margin-top:4px;font-family:'DM Mono',monospace;font-size:10px;color:var(--gray400);}
.photo-zone{border:2px dashed var(--gray200);border-radius:var(--radius);background:var(--gray50);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:8px;cursor:pointer;transition:all .2s;min-height:120px;position:relative;overflow:hidden;}
.photo-zone:hover{border-color:var(--profero-blue);background:var(--gray100);}
.photo-zone.has-photo{border-style:solid;border-color:var(--gray200);padding:0;}
.photo-zone img{width:100%;height:100%;object-fit:cover;display:block;border-radius:calc(var(--radius) - 2px);}
.photo-zone-label{font-size:12px;font-weight:600;color:var(--gray400);text-align:center;pointer-events:none;}
.photo-zone-icon{font-size:28px;pointer-events:none;}
.photo-zone-actions{position:absolute;top:6px;right:6px;display:flex;gap:4px;}
.photo-action-btn{background:rgba(0,0,0,.55);color:white;border:none;border-radius:4px;padding:4px 8px;font-size:11px;cursor:pointer;}
.photo-slots{display:grid;grid-template-columns:1fr 1fr;gap:10px;}
.photo-slot-label{font-size:10px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;margin-bottom:5px;}
@media print{.no-print{display:none!important;}body{background:white;}.tab-content{display:block!important;}.page{padding:0;max-width:100%;}.card{box-shadow:none;border:1px solid #ccc;break-inside:avoid;}@page{margin:15mm;}}
</style>
</head>
<body>

<div class="modal-overlay" id="resetModal">
  <div class="modal">
    <div class="modal-icon">⚠️</div>
    <div class="modal-title">Réinitialiser le simulateur ?</div>
    <div class="modal-text">Toutes vos données saisies seront effacées.<br><strong>Cette action est irréversible.</strong></div>
    <div class="modal-actions">
      <button class="btn btn-outline" onclick="closeModal()">Annuler</button>
      <button class="btn btn-danger" onclick="doReset()">Oui, réinitialiser</button>
    </div>
  </div>
</div>

<!-- PROJECT BAR -->
<div class="project-bar no-print">
  <span class="project-label">Projet :</span>
  <input class="project-name-input" id="projectName" type="text" placeholder="Nom du projet…"
    oninput="onProjectNameChange(this.value)">
  <span class="project-date" id="projectDate"></span>
  <div style="margin-left:auto;display:flex;gap:8px;align-items:center">
    <button class="btn btn-gold" onclick="saveToSupabase()">💾 Enregistrer</button>
    <button class="btn btn-blue" onclick="exportXLSX()">📊 Export Excel</button>
    <button class="btn btn-outline" onclick="genererFiche()">📄 Fiche PDF</button>
    <button class="btn btn-outline" onclick="openModal()" style="color:var(--red);border-color:var(--red)">🔄 Réinitialiser</button>
  </div>
</div>

<!-- TABS -->
<nav class="tabs-nav no-print">
  <button class="tab-btn active" onclick="showTab('simulateur',this)">📊 Simulateur</button>
  <button class="tab-btn" onclick="showTab('budget',this)">🔨 Budget Travaux</button>
  <button class="tab-btn" onclick="showTab('fisca',this)">⚖️ Fiscalité</button>
</nav>

<!-- TAB 1 — SIMULATEUR -->
<div id="tab-simulateur" class="tab-content active"><div class="page">
  <div class="kpi-bar">
    <div class="kpi"><div class="kpi-label">Coût total opération</div><div class="kpi-value" id="k-total">—</div></div>
    <div class="kpi"><div class="kpi-label">Rentabilité nette</div><div class="kpi-value green" id="k-rnet">—</div></div>
    <div class="kpi"><div class="kpi-label">Cash-flow mensuel</div><div class="kpi-value" id="k-cf">—</div><div class="kpi-sub" id="k-cf-sub">scénario 1</div>
      <div class="scenario-toggle"><button id="scen-btn-1" class="scen-btn active" onclick="selectScenario(1)">S1</button><button id="scen-btn-2" class="scen-btn" onclick="selectScenario(2)">S2</button></div>
    </div>
    <div class="kpi"><div class="kpi-label">Point d'équilibre</div><div class="kpi-value orange" id="k-pe">—</div></div>
    <div class="kpi"><div class="kpi-label">Marge de sécurité</div><div class="kpi-value" id="k-ms">—</div></div>
  </div>
  <div class="grid-2">
    <div>
      <div class="card">
        <div class="card-header profero">🏠 A — Acquisition</div>
        <div class="card-body">
          <div class="row"><div class="row-label">Prix affiché (€)</div><input type="number" id="prixAffiche" value="280000" oninput="calc()"></div>
          <div class="row"><div class="row-label">Prix négocié (€)</div><input type="number" id="prixNegocie" value="250000" oninput="calc()"></div>
          <div class="row"><div class="row-label">Négociation obtenue</div><div class="row-value calc" id="partNego">—</div></div>
          <div class="row"><div class="row-label">Taux frais notaire (%)</div><select id="tauxNotaire" onchange="calc()" style="width:110px"><option value="0.08" selected>8% (ancien)</option><option value="0.03">3% (neuf)</option><option value="0.025">2,5%</option><option value="0.07">7%</option><option value="0.075">7,5%</option></select></div>
          <div class="row"><div class="row-label">Frais de notaire (€)</div><div class="row-value calc" id="fraisNotaire">—</div></div>
          <div class="row"><div class="row-label">Surface totale (m²)</div><input type="number" id="surface" value="237" oninput="onSurfaceChange()"></div>
          <div class="row"><div class="row-label">Prix d'achat / m² (€)</div><div class="row-value calc" id="prixM2">—</div></div>
          <div class="row"><div class="row-label">Budget travaux TTC (€) <span style="color:var(--gold);font-size:10px">← lier au budget</span></div><input type="number" id="budgetTravaux" value="0" oninput="calc()"></div>
          <div class="row"><div class="row-label">Honoraires (€)</div><input type="number" id="honoraires" value="0" oninput="calc()"></div>
          <div class="row"><div class="row-label">Raccordement Enedis (€)</div><input type="number" id="enedis" value="0" oninput="calc()"></div>
          <div class="row total"><div class="row-label bold">COÛT TOTAL OPÉRATION (€)</div><div class="row-value green" id="coutTotal">—</div></div>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-header mid">📋 C — Charges d'Exploitation</div>
        <div class="card-body">
          <div class="row"><div class="row-label">Taxe foncière (€/an)</div><input type="number" id="taxeFonciere" value="1000" oninput="calc()" style="width:130px"></div>
          <div class="row"><div class="row-label">Assurance PNO (€/an)</div><input type="number" id="assurance" value="600" oninput="calc()" style="width:130px"></div>
          <div class="row"><div class="row-label">Comptabilité société (€/an)</div><input type="number" id="compta" value="800" oninput="calc()" style="width:130px"></div>
          <div class="row subtotal"><div class="row-label">Frais gestion locative (€/an) <span class="pct-badge" id="gestionPctBadge">0%</span></div><div class="row-value calc" id="fraisGestion">—</div></div>
          <div class="row"><div class="row-label">Provisions travaux (€/an)</div><input type="number" id="provisions" value="1500" oninput="calc()" style="width:130px"></div>
          <div class="row total"><div class="row-label bold">TOTAL CHARGES (€/an)</div><div class="row-value orange" id="totalCharges">—</div></div>
        </div>
      </div>
    </div>
    <div>
      <div class="card">
        <div class="card-header">🏘️ B — Lots & Loyers</div>
        <div class="card-body">
          <div class="toggle-wrap">
            <label class="toggle"><input type="checkbox" id="gestionActive" onchange="calc();renderLots()"><span class="toggle-slider"></span></label>
            <span style="font-size:12px;font-weight:600;color:var(--gray600)">Gestion locative externalisée</span>
          </div>
          <div class="lot-table-wrap">
            <div class="lot-grid header"><div>Type</div><div>m²</div><div>Niveau</div><div>Loyer/mois</div><div>Loyer/an</div><div>€/m²</div><div>Gestion</div><div>Note</div><div></div></div>
            <div id="lots-rows"></div>
            <div class="lot-grid" style="font-size:12px;font-weight:700">
              <div style="color:var(--navy);grid-column:1/3">TOTAL</div><div></div>
              <div class="lot-lv" id="totalLoyer" style="color:var(--green);font-weight:700">—</div>
              <div class="lot-lv" id="totalLoyerAn" style="color:var(--green);font-weight:700">—</div>
              <div></div>
              <div class="lot-lv" id="totalGestion" style="color:var(--orange);font-weight:700">—</div>
              <div></div><div></div>
            </div>
          </div>
          <button class="btn-add-lot no-print" onclick="addLot()" id="btn-add-lot">＋ Ajouter un lot</button>
        </div>
      </div>
      <div class="card" style="margin-top:16px">
        <div class="card-header mid">📝 Description du Projet</div>
        <div class="card-body" style="display:flex;flex-direction:column;gap:10px">
          <div><label style="font-size:11px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Description générale</label>
            <textarea id="projetDescription" rows="3" placeholder="Type de bien, localisation, contexte…" style="width:100%;font-family:'Sora',sans-serif;font-size:12px;color:var(--gray800);background:var(--gray50);border:1.5px solid var(--gray200);border-radius:var(--radius-sm);padding:8px 10px;outline:none;resize:vertical;line-height:1.5"></textarea></div>
          <div><label style="font-size:11px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Travaux envisagés</label>
            <textarea id="projetTravaux" rows="2" placeholder="Rénovation toiture, électricité, plomberie…" style="width:100%;font-family:'Sora',sans-serif;font-size:12px;color:var(--gray800);background:var(--gray50);border:1.5px solid var(--gray200);border-radius:var(--radius-sm);padding:8px 10px;outline:none;resize:vertical;line-height:1.5"></textarea></div>
          <div><label style="font-size:11px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Atouts / Points de vigilance</label>
            <textarea id="projetAtouts" rows="2" placeholder="Emplacement, potentiel, risques…" style="width:100%;font-family:'Sora',sans-serif;font-size:12px;color:var(--gray800);background:var(--gray50);border:1.5px solid var(--gray200);border-radius:var(--radius-sm);padding:8px 10px;outline:none;resize:vertical;line-height:1.5"></textarea></div>
          <div><label style="font-size:11px;font-weight:700;color:var(--gray400);text-transform:uppercase;letter-spacing:.06em;display:block;margin-bottom:5px">Photos du bien</label>
            <div class="photo-slots" id="photoSlots"></div></div>
        </div>
      </div>
    </div>
  </div>
  <div class="grid-2" style="margin-top:16px">
    <div class="card">
      <div class="card-header mid">🏦 D — Plan de Financement</div>
      <div class="card-body">
        <div class="scenario-header"><div>Paramètre</div><div style="text-align:right">Scénario 1</div><div style="text-align:right">Scénario 2</div></div>
        <div class="scenario-row"><div class="row-label">Montant opération (€)</div><div class="s-val" id="s-montant">—</div><div class="s-val" id="s-montant2">—</div></div>
        <div class="scenario-row"><div class="row-label">Apport (€)</div>
          <div class="s-val input-cell" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><input type="number" id="apport1" value="20000" oninput="calc()" style="width:100px"><span style="font-size:10px;color:var(--profero-blue);font-family:'DM Mono',monospace;font-weight:700" id="apport1pct"></span></div>
          <div class="s-val input-cell" style="display:flex;flex-direction:column;align-items:flex-end;gap:2px"><input type="number" id="apport2" value="20000" oninput="calc()" style="width:100px"><span style="font-size:10px;color:var(--profero-blue);font-family:'DM Mono',monospace;font-weight:700" id="apport2pct"></span></div>
        </div>
        <div class="scenario-row"><div class="row-label">Montant à financer (€)</div><div class="s-val" id="s-afinancer1">—</div><div class="s-val" id="s-afinancer2">—</div></div>
        <div class="scenario-row"><div class="row-label">Taux TAEG (%)</div><div class="s-val input-cell"><input type="number" id="taux1" value="4.32" step="0.01" oninput="calc()" style="width:100px"></div><div class="s-val input-cell"><input type="number" id="taux2" value="3.14" step="0.01" oninput="calc()" style="width:100px"></div></div>
        <div class="scenario-row"><div class="row-label">Durée (années)</div><div class="s-val input-cell"><input type="number" id="duree1" value="20" oninput="calc()" style="width:100px"></div><div class="s-val input-cell"><input type="number" id="duree2" value="25" oninput="calc()" style="width:100px"></div></div>
        <div class="scenario-row highlight"><div class="row-label bold">Mensualité (€)</div><div class="s-val green" id="s-mensualite1">—</div><div class="s-val green" id="s-mensualite2">—</div></div>
        <div class="scenario-row"><div class="row-label">Annuité (€)</div><div class="s-val" id="s-annuite1">—</div><div class="s-val" id="s-annuite2">—</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header gold">📈 E — Rentabilité</div>
      <div class="card-body">
        <div class="scenario-header"><div>Indicateur</div><div style="text-align:right">Scénario 1</div><div style="text-align:right">Scénario 2</div></div>
        <div class="scenario-row"><div class="row-label">Loyers bruts annuels (€)</div><div class="s-val" id="r-bruts">—</div><div class="s-val">—</div></div>
        <div class="scenario-row"><div class="row-label">Rentabilité brute</div><div class="s-val" id="r-rbrute">—</div><div class="s-val">—</div></div>
        <div class="scenario-row highlight"><div class="row-label bold">Rentabilité nette</div><div class="s-val green" id="r-rnette1">—</div><div class="s-val green" id="r-rnette2">—</div></div>
        <div class="scenario-row highlight"><div class="row-label bold">Cash-flow mensuel (€)</div><div class="s-val" id="r-cfm1">—</div><div class="s-val" id="r-cfm2">—</div></div>
        <div class="scenario-row"><div class="row-label">Cash-flow annuel (€)</div><div class="s-val" id="r-cfa1">—</div><div class="s-val" id="r-cfa2">—</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header danger">⚖️ F — Point d'Équilibre & Risque</div>
      <div class="card-body">
        <div class="scenario-header"><div>Indicateur</div><div style="text-align:right">Scénario 1</div><div style="text-align:right">Scénario 2</div></div>
        <div class="scenario-row"><div class="row-label">Charges totales annuelles (€)</div><div class="s-val" id="pe-ctot1">—</div><div class="s-val" id="pe-ctot2">—</div></div>
        <div class="scenario-row warning"><div class="row-label bold">Point d'équilibre (%)</div><div class="s-val orange" id="pe-pct1">—</div><div class="s-val orange" id="pe-pct2">—</div></div>
        <div class="scenario-row warning"><div class="row-label bold">Point d'équilibre (mois/an)</div><div class="s-val orange" id="pe-mois1">—</div><div class="s-val orange" id="pe-mois2">—</div></div>
        <div class="scenario-row highlight"><div class="row-label bold">Marge de sécurité</div><div class="s-val green" id="pe-marge1">—</div><div class="s-val green" id="pe-marge2">—</div></div>
        <div class="scenario-row"><div class="row-label">Loyer minimum viable (€/mois)</div><div class="s-val" id="pe-loymin1">—</div><div class="s-val" id="pe-loymin2">—</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header">🧾 G — Fiscalité Rapide (Scénario 1)</div>
      <div class="card-body"><div class="grid-2">
        <div>
          <div class="row"><div class="row-label">Mode de détention</div><select id="modeDetention" onchange="calc()" style="width:150px"><option value="IS">SCI à l'IS</option><option value="IR">SCI à l'IR</option><option value="LMNP">LMNP au réel</option></select></div>
          <div class="row"><div class="row-label">TMI du foyer (pour IR)</div><select id="tmi" onchange="calc()" style="width:100px"><option value="0">0%</option><option value="0.11">11%</option><option value="0.30" selected>30%</option><option value="0.41">41%</option><option value="0.45">45%</option></select></div>
          <div class="row"><div class="row-label">Résultat courant avant impôt (€/an)</div><div class="row-value calc" id="f-resultat">—</div></div>
          <div class="row"><div class="row-label">Impôt estimé (€/an)</div><div class="row-value calc" id="f-is">—</div></div>
        </div>
        <div>
          <div class="row"><div class="row-label">Cash-flow net après impôt (€/an)</div><div class="row-value green" id="f-cfan">—</div></div>
          <div class="row"><div class="row-label">Cash-flow net après impôt (€/mois)</div><div class="row-value green" id="f-cfmois">—</div></div>
        </div>
      </div></div>
    </div>
  </div>
</div></div>

<!-- TAB 2 — BUDGET TRAVAUX -->
<div id="tab-budget" class="tab-content"><div class="page">
  <div class="grid-2" style="margin-top:16px;">
    <div class="card">
      <div class="card-header mid">⚙️ Paramètres du Projet</div>
      <div class="card-body">
        <div class="row"><div class="row-label">Surface totale (m²)</div><div class="row-value calc" id="b-surface">—</div></div>
        <div class="row"><div class="row-label">Nombre total de logements</div><div class="row-value calc" id="b-nbLots">—</div></div>
        <div class="row"><div class="row-label">dont Studios</div><div class="row-value calc" id="b-nbStudio">—</div></div>
        <div class="row"><div class="row-label">dont T1</div><div class="row-value calc" id="b-nbT1">—</div></div>
        <div class="row"><div class="row-label">dont T2</div><div class="row-value calc" id="b-nbT2">—</div></div>
        <div class="row"><div class="row-label">dont T3</div><div class="row-value calc" id="b-nbT3">—</div></div>
        <div class="row"><div class="row-label">dont T4+</div><div class="row-value calc" id="b-nbT4">—</div></div>
        <div class="row"><div class="row-label">dont Commerce</div><div class="row-value calc" id="b-nbCommerce">—</div></div>
      </div>
    </div>
    <div class="card">
      <div class="card-header mid">🏗️ Coefficient État Général</div>
      <div class="card-body">
        <div class="row"><div class="row-label">Bon état général</div><div class="row-value" style="color:var(--green)">× 0,70</div></div>
        <div class="row"><div class="row-label">État moyen</div><div class="row-value">× 1,00</div></div>
        <div class="row"><div class="row-label">Mauvais état / gros œuvre</div><div class="row-value" style="color:var(--orange)">× 1,30</div></div>
        <div class="row"><div class="row-label">Passoire / ruine</div><div class="row-value" style="color:var(--red)">× 1,60</div></div>
        <div class="row total"><div class="row-label bold">▶ Coefficient retenu</div><input type="number" id="coefEtat" value="1.0" step="0.05" min="0.5" max="2" oninput="calcBudget()" style="width:80px"></div>
      </div>
    </div>
  </div>
  <div class="card" style="margin-top:16px;">
    <div class="card-header">🔨 Détail par Corps de Métier</div>
    <div class="card-body">
      <div class="brow bhead"><div>Corps de métier</div><div style="text-align:center">Base</div><div style="text-align:right">Qté</div><div style="text-align:right">Prix unit. (€)</div><div style="text-align:right">Total HT (€)</div></div>
      <div id="budget-rows"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 0 4px;border-top:1px solid var(--gray200);margin-top:8px;gap:8px;">
        <div style="font-size:12px;font-weight:600;color:var(--orange)">Provision imprévus</div>
        <div style="display:flex;align-items:center;gap:6px;">
          <input type="number" id="imprevusPct" value="10" min="0" max="50" step="1" oninput="calcBudget()" style="width:60px;border-color:var(--orange)">
          <span style="font-size:12px;color:var(--orange);font-weight:600">%</span>
          <div style="font-family:'DM Mono',monospace;font-size:13px;font-weight:700;color:var(--orange);min-width:90px;text-align:right" id="b-imprevus">—</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;padding:7px 0;border-top:2px solid var(--navy);margin-top:6px;font-size:12px;font-weight:700;color:var(--navy);">
        <div>Sous-total HT + imprévus</div><div style="font-family:'DM Mono',monospace" id="b-soustotal">—</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr auto;padding:5px 0;font-size:12px;font-weight:600;color:var(--navy3);">
        <div>× Coefficient état (×<span id="b-coefLabel">1,00</span>)</div><div style="font-family:'DM Mono',monospace" id="b-totalcoef">—</div>
      </div>
      <div style="background:var(--navy);margin:8px -16px 0;padding:12px 16px;border-radius:0 0 var(--radius) var(--radius);display:flex;justify-content:space-between;align-items:center;">
        <div style="color:white;font-size:13px;font-weight:800">TOTAL TTC (TVA 10%)</div>
        <div style="font-family:'DM Mono',monospace;font-size:18px;font-weight:700;color:var(--gold)" id="b-totalttc">—</div>
      </div>
      <div style="display:flex;gap:24px;margin-top:12px;padding-top:12px;border-top:1px solid var(--gray100)">
        <div><div class="kpi-label">Budget HT/m²</div><div class="kpi-value" id="b-ht-m2" style="font-size:18px">—</div></div>
        <div><div class="kpi-label">Budget TTC/m²</div><div class="kpi-value" id="b-ttc-m2" style="font-size:18px">—</div></div>
      </div>
    </div>
  </div>
</div></div>

<!-- TAB 3 — FISCALITÉ -->
<div id="tab-fisca" class="tab-content"><div class="page" style="padding-top:20px;">
  <div class="card" style="margin-bottom:16px;">
    <div class="card-header">⚖️ Comparatif des Régimes Fiscaux</div>
    <div class="card-body" style="overflow-x:auto;">
      <table style="width:100%;border-collapse:collapse;font-size:12px;"><thead><tr>
        <th style="text-align:left;padding:8px;border-bottom:2px solid var(--gray200);color:var(--gray400);font-size:10px;text-transform:uppercase;letter-spacing:.05em">Critère</th>
        <th style="text-align:center;padding:8px;border-bottom:2px solid var(--navy3);color:var(--navy3);background:rgba(30,58,95,.05)">SCI à l'IS</th>
        <th style="text-align:center;padding:8px;border-bottom:2px solid #6b3a8a;color:#6b3a8a;background:rgba(107,58,138,.05)">SCI à l'IR</th>
        <th style="text-align:center;padding:8px;border-bottom:2px solid var(--green);color:var(--green);background:rgba(26,122,74,.05)">LMNP (réel)</th>
      </tr></thead><tbody id="fisca-comparatif"></tbody></table>
    </div>
  </div>
  <div class="fisca-grid">
    <div class="regime-card"><div class="regime-header is">🏢 SCI à l'IS</div><div id="fisca-is-rows"></div></div>
    <div class="regime-card"><div class="regime-header ir">👤 SCI à l'IR</div><div id="fisca-ir-rows"></div></div>
    <div class="regime-card"><div class="regime-header lmnp">🏨 LMNP au Réel</div><div id="fisca-lmnp-rows"></div></div>
  </div>
</div></div>

<script>
// ══ CONFIG ══
const DEFAULT_LOTS=[{type:'T4',m2:134,loyer:900,niveau:'RDC',comment:''},{type:'Studio',m2:27,loyer:380,niveau:'R+1',comment:''},{type:'T2',m2:40,loyer:490,niveau:'R+1',comment:''},{type:'T2',m2:36,loyer:490,niveau:'R+2',comment:''}];
const NIVEAUX=['RDC','R+1','R+2','R+3','R+4','Autre'];
const MAX_LOTS=10;
const GESTION_PRICES={Studio:42,T1:45.6,T2:40.8,T3:44.4,T4:44.4,T5:46.8,T6:49.2,Commerce:60,'Sélectionner':0};
const LOT_TYPES=['Sélectionner','Studio','T1','T2','T3','T4','T5','T6','Commerce'];
let selectedScenario=1;
let lots=DEFAULT_LOTS.map(l=>Object.assign({},l));
let budgetQty={};
let budgetPrice={};
let customDivers=[];
let pricesLocked=true;
let projectPhotos=[null,null,null,null];

const BUDGET_SECTIONS=[
  {id:'elec',sec:'⚡ Électricité',items:[{id:'elec-studio',label:'Studio',base:'/ logement',autoFn:()=>cntT('Studio'),price:7012.1},{id:'elec-t1',label:'T1',base:'/ logement',autoFn:()=>cntT('T1'),price:7012.1},{id:'elec-t2',label:'T2',base:'/ logement',autoFn:()=>cntT('T2'),price:9271.69},{id:'elec-t3',label:'T3',base:'/ logement',autoFn:()=>cntT('T3'),price:11968},{id:'elec-t4',label:'T4+',base:'/ logement',autoFn:()=>cntT('T4'),price:13625.9},{id:'elec-t5',label:'T5',base:'/ logement',autoFn:()=>cntT('T5'),price:17807.1},{id:'elec-t6',label:'T6',base:'/ logement',autoFn:()=>cntT('T6'),price:17807.1}]},
  {id:'plomb',sec:'🔧 Réseaux Plomberie',items:[{id:'plomb-cpt',label:'Compteur divisionnaire',base:'/ logement',autoFn:()=>nbLots(),price:312.6},{id:'plomb-gen',label:'Réseau général',base:'/ logement',autoFn:()=>nbLots(),price:2500},{id:'plomb-int',label:'Distribution interne',base:'/ logement',autoFn:()=>nbLots(),price:1800}]},
  {id:'sdb',sec:'🚿 Salle de Bain',items:[{id:'sdb-std',label:'Salle de bain complète',base:'/ unité',autoFn:()=>nbLots(),price:5884.53},{id:'sdb-exist',label:'SDB — éléments conservés',base:'/ unité',autoFn:()=>0,price:3600}]},
  {id:'cuis',sec:'🍳 Cuisine',items:[{id:'cuis-droite',label:'Cuisine droite',base:'/ unité',autoFn:()=>nbLots(),price:2100}]},
  {id:'clois',sec:'🧱 Cloisons',items:[{id:'clois-dist',label:'Distribution + isolation phonique',base:'m²',autoFn:()=>0,price:89},{id:'clois-dbl',label:'Doublage sans isolation',base:'m²',autoFn:()=>0,price:89},{id:'clois-dbli',label:'Doublage avec isolation',base:'m²',autoFn:()=>0,price:100},{id:'clois-sad',label:'Cloison SAD',base:'m²',autoFn:()=>0,price:210}]},
  {id:'sol',sec:'🏠 Revêtement de Sol',items:[{id:'sol-pq',label:'Parquet stratifié + plinthes',base:'m²',autoFn:()=>getSurface(),price:62}]},
  {id:'peinture',sec:'🎨 Peinture',items:[{id:'peinture-neuf',label:'Peinture sur placo neuf',base:'m²',autoFn:()=>Math.round(getSurface()*2.5),price:20},{id:'peinture-anc',label:'Peinture sur ancien',base:'m²',autoFn:()=>0,price:30}]},
  {id:'plafond',sec:'🏛️ Plafond',items:[{id:'plaf-ramp',label:'Faux plafond rampant',base:'m²',autoFn:()=>getSurface(),price:86},{id:'plaf-rampni',label:'Faux plafond rampant sans isolant',base:'m²',autoFn:()=>0,price:64}]},
  {id:'isol',sec:'🧱 Isolation',items:[{id:'isol-laine',label:'Laine posée',base:'m²',autoFn:()=>0,price:25}]},
  {id:'rav',sec:'🏗️ Ravalement',items:[{id:'rav-fac',label:'Ravalement façade',base:'m²',autoFn:()=>0,price:120}]},
  {id:'toit',sec:'🏠 Toiture',items:[{id:'toit-couv',label:'Couverture (sur devis)',base:'m²',autoFn:()=>0,price:0}]},
  {id:'menext',sec:'🪟 Menuiseries Extérieures',items:[{id:'men-fen',label:'Fenêtre double vitrage',base:'/ unité',autoFn:()=>0,price:1400},{id:'men-fenouv',label:'Création ouverture + pose fenêtre',base:'/ unité',autoFn:()=>0,price:2200},{id:'men-velux',label:'Vélux',base:'/ unité',autoFn:()=>0,price:700},{id:'men-veluxouv',label:'Création ouverture + pose Vélux',base:'/ unité',autoFn:()=>0,price:2000},{id:'men-baie',label:'Baie vitrée',base:'/ unité',autoFn:()=>0,price:3000},{id:'men-pext',label:'Porte extérieure',base:'/ unité',autoFn:()=>nbLots(),price:1650},{id:'men-pextouv',label:'Création ouverture + pose porte',base:'/ unité',autoFn:()=>0,price:2450}]},
  {id:'menint',sec:'🚪 Menuiseries Intérieures',items:[{id:'meni-pal',label:'Porte palière 83',base:'/ unité',autoFn:()=>nbLots(),price:950},{id:'meni-por83',label:'Porte intérieure 83',base:'/ unité',autoFn:()=>nbLots()*3,price:310},{id:'meni-por73',label:'Porte intérieure 73',base:'/ unité',autoFn:()=>0,price:230}]},
  {id:'divers',sec:'🔩 Divers',items:[{id:'div-deb',label:'Démolition (à la journée)',base:'journée',autoFn:()=>1,price:300}]},
];

// ══ HELPERS ══
function pmt(P,r,n){if(!P||!r||!n)return 0;const rm=r/100/12,nm=n*12;return rm?P*rm/(1-Math.pow(1+rm,-nm)):P/nm;}
function fmt(v){if(v===null||v===undefined||isNaN(v))return'—';return new Intl.NumberFormat('fr-FR',{maximumFractionDigits:0}).format(v)+' €';}
function fmtPct(v){return isNaN(v)?'—':(v*100).toFixed(1)+' %';}
function fmtMois(v){return isNaN(v)?'—':v.toFixed(1)+' mois';}
function iv(id){const el=document.getElementById(id);return el?parseFloat(el.value)||0:0;}
function sv(id,v){const el=document.getElementById(id);if(el)el.textContent=v;}
function cntT(t){return lots.filter(l=>l.type.startsWith(t)).length;}
function nbLots(){return lots.filter(l=>l.type!=='Sélectionner').length;}
function getSurface(){return iv('surface')||0;}
function colorCf(id,v){const el=document.getElementById(id);if(el)el.className='s-val '+(v>0?'green':v<0?'orange':'');}

// ══ AUTOSAVE vers React (toutes les 30s) ══
let autoSaveTimer = null;
function scheduleAutoSave(){
  if(autoSaveTimer) clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(()=>{
    const state = collectState();
    window.parent.postMessage({ source:'profero-invest', type:'autosave', state, projectName: state.projectName }, '*');
  }, 30000);
}

// ══ SAVE MANUEL vers React ══
function saveToSupabase(){
  const state = collectState();
  window.parent.postMessage({ source:'profero-invest', type:'save', state, projectName: state.projectName }, '*');
}

// ══ Nom du projet → React ══
function onProjectNameChange(val){
  window.parent.postMessage({ source:'profero-invest', type:'namechange', projectName: val }, '*');
  scheduleAutoSave();
}

// ══ RECEVOIR l'état depuis React (chargement projet) ══
window.addEventListener('message', function(e){
  if(!e.data || e.data.source !== 'profero-host') return;
  if(e.data.type === 'loadState'){
    applyState(e.data.state);
    if(e.data.projectName){
      const pn = document.getElementById('projectName');
      if(pn) pn.value = e.data.projectName;
    }
    updateProjectDate();
  }
});

function collectState(){
  return{
    version:4,savedAt:new Date().toISOString(),
    projectName:document.getElementById('projectName')?.value||'Sans nom',
    inputs:{prixAffiche:iv('prixAffiche'),prixNegocie:iv('prixNegocie'),budgetTravaux:iv('budgetTravaux'),tauxNotaire:parseFloat(document.getElementById('tauxNotaire')?.value)||0.08,surface:iv('surface'),honoraires:iv('honoraires'),enedis:iv('enedis'),taxeFonciere:iv('taxeFonciere'),assurance:iv('assurance'),compta:iv('compta'),provisions:iv('provisions'),apport1:iv('apport1'),apport2:iv('apport2'),taux1:iv('taux1'),taux2:iv('taux2'),duree1:iv('duree1'),duree2:iv('duree2'),coefEtat:iv('coefEtat'),imprevusPct:iv('imprevusPct')},
    selects:{gestionActive:document.getElementById('gestionActive')?.checked,modeDetention:document.getElementById('modeDetention')?.value,tmi:document.getElementById('tmi')?.value,selectedScenario:selectedScenario},
    lots:lots.map(l=>({...l})),budgetQty:{...budgetQty},budgetPrice:{...budgetPrice},customDivers:customDivers.map(c=>({...c})),
    descriptions:{description:document.getElementById('projetDescription')?.value||'',travaux:document.getElementById('projetTravaux')?.value||'',atouts:document.getElementById('projetAtouts')?.value||''},
    photos:projectPhotos.slice(),
  };
}

function applyState(state){
  if(!state)return;
  Object.entries(state.inputs||{}).forEach(([id,val])=>{const el=document.getElementById(id);if(el)el.value=val;});
  if(state.inputs?.tauxNotaire){const tn=document.getElementById('tauxNotaire');if(tn)tn.value=state.inputs.tauxNotaire;}
  if(state.selects){
    const ga=document.getElementById('gestionActive');if(ga)ga.checked=state.selects.gestionActive;
    const md=document.getElementById('modeDetention');if(md)md.value=state.selects.modeDetention;
    const tm=document.getElementById('tmi');if(tm)tm.value=state.selects.tmi;
    if(state.selects.selectedScenario)selectScenario(state.selects.selectedScenario);
  }
  const pn=document.getElementById('projectName');if(pn)pn.value=state.projectName||'';
  lots=(state.lots||[]).map(l=>({...l}));
  customDivers=(state.customDivers||[]).map(c=>({...c}));
  pricesLocked=true;
  buildBudgetRows();
  if(state.budgetQty)Object.entries(state.budgetQty).forEach(([k,v])=>{budgetQty[k]=v;const inp=document.getElementById('qty-'+k);if(inp)inp.value=v;});
  if(state.budgetPrice)Object.entries(state.budgetPrice).forEach(([k,v])=>{budgetPrice[k]=v;const inp=document.getElementById('price-'+k);if(inp)inp.value=v;});
  renderLots();calcBudget(false);calc();
  if(state.descriptions){
    const d=document.getElementById('projetDescription');if(d)d.value=state.descriptions.description||'';
    const t=document.getElementById('projetTravaux');if(t)t.value=state.descriptions.travaux||'';
    const a=document.getElementById('projetAtouts');if(a)a.value=state.descriptions.atouts||'';
  }
  if(state.photos){projectPhotos=[...state.photos,null,null,null,null].slice(0,4);}
  else{projectPhotos=[null,null,null,null];}
  renderPhotoSlots();
}

function updateProjectDate(){
  const el=document.getElementById('projectDate');
  if(el)el.textContent='Modifié le '+new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'});
}

// ══ BUDGET ══
function buildBudgetRows(){
  const c=document.getElementById('budget-rows');if(!c)return;c.innerHTML='';
  BUDGET_SECTIONS.forEach(sec=>{
    const sh=document.createElement('div');sh.className='budget-section-header';sh.textContent=sec.sec;c.appendChild(sh);
    sec.items.forEach(item=>{
      const autoQty=item.autoFn?item.autoFn():0;
      if(budgetQty[item.id]===undefined)budgetQty[item.id]=autoQty;
      if(budgetPrice[item.id]===undefined)budgetPrice[item.id]=item.price;
      const div=document.createElement('div');div.className='brow';
      div.innerHTML=`<div class="bl">${item.label}</div>
        <div style="text-align:center;font-size:11px;color:var(--gray400)">${item.base}</div>
        <div><input type="number" id="qty-${item.id}" value="${budgetQty[item.id]}" min="0" step="1"
          oninput="budgetQty['${item.id}']=+this.value;calcBudget(false);scheduleAutoSave()" style="width:68px"></div>
        <div><input type="number" id="price-${item.id}" value="${budgetPrice[item.id]}" min="0"
          oninput="budgetPrice['${item.id}']=+this.value;calcBudget(false);scheduleAutoSave()" style="width:78px"></div>
        <div class="bn" id="tot-${item.id}">${fmt((budgetQty[item.id]||0)*(budgetPrice[item.id]||0))}</div>`;
      c.appendChild(div);
    });
  });
  renderCustomDivers(c);
  const btn=document.createElement('button');
  btn.className='btn-add-divers';btn.id='btn-add-divers';
  btn.innerHTML='＋ Ligne personnalisée';
  btn.onclick=()=>{customDivers.push({label:'',qty:1,price:0});rebuildCustomDivers();calcBudget(false);};
  c.appendChild(btn);
}

function renderCustomDivers(container){
  document.querySelectorAll('.custom-divers-row').forEach(el=>el.remove());
  const btn=document.getElementById('btn-add-divers');
  customDivers.forEach((cd,ci)=>{
    const div=document.createElement('div');div.className='brow custom-divers-row';
    div.innerHTML=`<div><input type="text" id="label-custom-${ci}" value="${cd.label||''}" placeholder="Désignation"
        oninput="customDivers[${ci}].label=this.value;scheduleAutoSave()" style="width:100%;font-size:12px;padding:4px 7px;text-align:left"></div>
      <div style="text-align:center;font-size:11px;color:var(--gray400)">unité</div>
      <div><input type="number" id="qty-custom-${ci}" value="${cd.qty||0}" min="0"
        oninput="customDivers[${ci}].qty=+this.value;calcBudget(false);scheduleAutoSave()" style="width:68px"></div>
      <div><input type="number" id="price-custom-${ci}" value="${cd.price||0}" min="0"
        oninput="customDivers[${ci}].price=+this.value;calcBudget(false);scheduleAutoSave()" style="width:78px"></div>
      <div style="display:flex;align-items:center;justify-content:flex-end;gap:4px">
        <span class="bn" id="tot-custom-${ci}">${fmt((cd.qty||0)*(cd.price||0))}</span>
        <button class="btn-remove" onclick="customDivers.splice(${ci},1);rebuildCustomDivers();calcBudget(false)">×</button>
      </div>`;
    if(btn)container.insertBefore(div,btn);else container.appendChild(div);
  });
}

function rebuildCustomDivers(){const c=document.getElementById('budget-rows');renderCustomDivers(c);}
function refreshAutoQty(){BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{const el=document.getElementById('qty-'+item.id);if(el&&pricesLocked){const auto=item.autoFn?item.autoFn():0;budgetQty[item.id]=auto;el.value=auto;}}));}

// ══ LOTS ══
function renderLots(){
  const c=document.getElementById('lots-rows');c.innerHTML='';
  const gActive=document.getElementById('gestionActive').checked;
  const btnAdd=document.getElementById('btn-add-lot');
  if(btnAdd)btnAdd.style.display=lots.length>=MAX_LOTS?'none':'flex';
  lots.forEach((lot,i)=>{
    if(!lot.niveau)lot.niveau='RDC';if(!lot.comment)lot.comment='';
    const div=document.createElement('div');div.className='lot-grid';div.id='lot-row-'+i;
    const gPrice=gActive?(GESTION_PRICES[lot.type]||0):0;
    const loyerAn=lot.loyer*12;const ratio=lot.m2>0?(lot.loyer/lot.m2).toFixed(2):'—';
    div.innerHTML=`<select onchange="lots[${i}].type=this.value;onLotTypeChange(${i})" style="width:100%">
        ${LOT_TYPES.map(t=>\`<option\${t===lot.type?' selected':''}>\${t}</option>\`).join('')}</select>
      <input type="text" id="lot-m2-${i}" value="${lot.m2}" oninput="onLotM2Input(${i},this)" onblur="resolveLotM2(${i},this)" onkeydown="if(event.key==='Enter'){resolveLotM2(${i},this);this.blur();}" style="width:100%;text-align:right">
      <select id="lot-niv-${i}" onchange="lots[${i}].niveau=this.value;calc()" style="width:100%">
        ${NIVEAUX.map(n=>`<option${n===lot.niveau?' selected':''}>${n}</option>`).join('')}</select>
      <input type="number" id="lot-loyer-${i}" value="${lot.loyer}" min="0" oninput="onLotLoyerChange(${i},+this.value)" style="width:100%">
      <div class="lot-lv" id="lot-loyeran-${i}">${fmt(loyerAn)}</div>
      <div class="lot-lv" id="lot-ratio-${i}">${ratio}</div>
      <div class="lot-lv" id="lot-gest-${i}" style="color:${gActive?'var(--orange)':'var(--gray400)'}">${gActive?fmt(gPrice):'—'}</div>
      <input type="text" id="lot-comment-${i}" value="${lot.comment.replace(/"/g,'&quot;')}" placeholder="Note…"
        oninput="lots[${i}].comment=this.value;scheduleAutoSave()"
        style="font-size:11px;padding:4px 7px;background:var(--gray50);border-color:var(--gray200);text-align:left;color:var(--gray600);width:100%">
      <div style="display:flex;gap:3px">
        <button class="btn-remove" onclick="duplicateLot(${i})" title="Dupliquer" style="color:var(--profero-blue);font-size:13px">⧉</button>
        <button class="btn-remove" onclick="removeLot(${i})" title="Supprimer">×</button>
      </div>`;
    c.appendChild(div);
  });
}

function onLotTypeChange(i){renderLots();calc();}
function onLotM2Input(i,inputEl){const val=evalM2(inputEl.value);lots[i].m2=val;const ratio=val>0?(lots[i].loyer/val).toFixed(2):'—';const ratioEl=document.getElementById('lot-ratio-'+i);if(ratioEl)ratioEl.textContent=ratio;calc();scheduleAutoSave();}
function resolveLotM2(i,inputEl){const val=evalM2(inputEl.value);lots[i].m2=val;inputEl.value=val>0?val:(inputEl.value.trim()===''?'':'0');const ratio=val>0?(lots[i].loyer/val).toFixed(2):'—';const ratioEl=document.getElementById('lot-ratio-'+i);if(ratioEl)ratioEl.textContent=ratio;calc();}
function evalM2(raw){raw=(raw||'').trim();if(!raw)return 0;if(/^[\d\s\+\-\*\/\.\(\)]+$/.test(raw)){try{return Math.max(0,Function('"use strict";return('+raw+')')())||0;}catch(e){}}return Math.max(0,parseFloat(raw)||0);}
function onLotLoyerChange(i,val){lots[i].loyer=val;const loyerAnEl=document.getElementById('lot-loyeran-'+i);if(loyerAnEl)loyerAnEl.textContent=fmt(val*12);const m2=lots[i].m2;const ratio=m2>0?(val/m2).toFixed(2):'—';const ratioEl=document.getElementById('lot-ratio-'+i);if(ratioEl)ratioEl.textContent=ratio;calc();scheduleAutoSave();}
function onLotChange(){renderLots();calc();}
function addLot(){if(lots.length>=MAX_LOTS)return;lots.push({type:'T2',m2:35,loyer:450,niveau:'RDC',comment:''});onLotChange();scheduleAutoSave();}
function duplicateLot(i){if(lots.length>=MAX_LOTS){alert('Maximum '+MAX_LOTS+' lots atteint.');return;}lots.splice(i+1,0,Object.assign({},lots[i]));onLotChange();scheduleAutoSave();}
function removeLot(i){if(lots.length<=1)return;lots.splice(i,1);onLotChange();scheduleAutoSave();}
function onSurfaceChange(){calc();scheduleAutoSave();}

// ══ CALC BUDGET ══
function calcBudget(refreshLotQty){
  if(refreshLotQty)refreshAutoQty();
  let sub=0;
  BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{const k=item.id;const t=(budgetQty[k]||0)*(budgetPrice[k]||0);sub+=t;const el=document.getElementById('tot-'+k);if(el)el.textContent=fmt(t);}));
  customDivers.forEach((cd,ci)=>{const t=(cd.qty||0)*(cd.price||0);sub+=t;const el=document.getElementById('tot-custom-'+ci);if(el)el.textContent=fmt(t);});
  const impPct=(parseFloat(document.getElementById('imprevusPct')?.value)||0)/100;
  const imp=sub*impPct;const coef=parseFloat(document.getElementById('coefEtat')?.value)||1;
  const totalCoef=(sub+imp)*coef;const totalTTC=totalCoef*1.10;const surf=getSurface()||1;
  sv('b-imprevus',fmt(imp));sv('b-soustotal',fmt(sub+imp));sv('b-totalcoef',fmt(totalCoef));sv('b-totalttc',fmt(totalTTC));
  sv('b-ht-m2',surf>0?Math.round(totalCoef/surf)+' €/m²':'—');sv('b-ttc-m2',surf>0?Math.round(totalTTC/surf)+' €/m²':'—');
  sv('b-coefLabel',coef.toFixed(2).replace('.',','));
}
function getBudgetTTC(){let sub=0;BUDGET_SECTIONS.forEach(sec=>sec.items.forEach(item=>{sub+=(budgetQty[item.id]||0)*(budgetPrice[item.id]||0)}));customDivers.forEach(cd=>{sub+=(cd.qty||0)*(cd.price||0)});const impPct=(parseFloat(document.getElementById('imprevusPct')?.value)||0)/100;const coef=parseFloat(document.getElementById('coefEtat')?.value)||1;return(sub*(1+impPct))*coef*1.10;}

// ══ MAIN CALC ══
function calc(){
  const pA=iv('prixAffiche'),pN=iv('prixNegocie'),surf=iv('surface');
  const tauxN=parseFloat(document.getElementById('tauxNotaire')?.value)||0.08;
  const fn=pN*tauxN;const prixAchat=pN+fn;const budgetT=iv('budgetTravaux');
  const coutTotal=prixAchat+budgetT+iv('honoraires')+iv('enedis');
  sv('fraisNotaire',fmt(fn));sv('partNego',fmtPct(pA>0?(pA-pN)/pA:0));
  sv('prixM2',surf>0?(prixAchat/surf).toFixed(0)+' €/m²':'—');sv('coutTotal',fmt(coutTotal));
  sv('b-surface',surf+' m²');sv('b-nbLots',nbLots());sv('b-nbStudio',cntT('Studio'));sv('b-nbT1',cntT('T1'));sv('b-nbT2',cntT('T2'));sv('b-nbT3',cntT('T3'));sv('b-nbT4',cntT('T4')+cntT('T5')+cntT('T6'));sv('b-nbCommerce',cntT('Commerce'));
  const gActive=document.getElementById('gestionActive').checked;
  const actLots=lots.filter(l=>l.type!=='Sélectionner');
  const totLoyer=actLots.reduce((s,l)=>s+l.loyer,0);const totLoyerAn=totLoyer*12;
  const totGestMois=gActive?actLots.reduce((s,l)=>s+(GESTION_PRICES[l.type]||0),0):0;const totGestAn=totGestMois*12;
  const gestPct=totLoyerAn>0?totGestAn/totLoyerAn:0;
  sv('totalLoyer',fmt(totLoyer));sv('totalLoyerAn',fmt(totLoyerAn));sv('totalGestion',gActive?fmt(totGestMois):'—');
  const taxe=iv('taxeFonciere'),assur=iv('assurance'),compta=iv('compta'),prov=iv('provisions');
  const totCharges=taxe+assur+compta+totGestAn+prov;
  sv('fraisGestion',gActive?fmt(totGestAn):'0 €');
  const pb=document.getElementById('gestionPctBadge');if(pb)pb.textContent=gActive?fmtPct(gestPct):'0%';
  sv('totalCharges',fmt(totCharges));
  const a1=iv('apport1'),a2=iv('apport2'),t1=iv('taux1'),t2=iv('taux2'),d1=iv('duree1'),d2=iv('duree2');
  const af1=coutTotal-a1,af2=coutTotal-a2;const m1=pmt(af1,t1,d1),m2=pmt(af2,t2,d2);const ann1=m1*12,ann2=m2*12;
  sv('s-montant',fmt(coutTotal));sv('s-montant2',fmt(coutTotal));sv('s-afinancer1',fmt(af1));sv('s-afinancer2',fmt(af2));
  sv('s-mensualite1',fmt(m1));sv('s-mensualite2',fmt(m2));sv('s-annuite1',fmt(ann1));sv('s-annuite2',fmt(ann2));
  const ap1el=document.getElementById('apport1pct');if(ap1el)ap1el.textContent=coutTotal>0?fmtPct(a1/coutTotal):'';
  const ap2el=document.getElementById('apport2pct');if(ap2el)ap2el.textContent=coutTotal>0?fmtPct(a2/coutTotal):'';
  const rb=coutTotal>0?totLoyerAn/coutTotal:0;const rn=coutTotal>0?(totLoyerAn-totCharges)/coutTotal:0;
  const cfm1=(totLoyerAn-totCharges)/12-m1;const cfm2=(totLoyerAn-totCharges)/12-m2;
  sv('r-bruts',fmt(totLoyerAn));sv('r-rbrute',fmtPct(rb));sv('r-rnette1',fmtPct(rn));sv('r-rnette2',fmtPct(rn));
  sv('r-cfm1',fmt(cfm1));sv('r-cfm2',fmt(cfm2));sv('r-cfa1',fmt(cfm1*12));sv('r-cfa2',fmt(cfm2*12));
  colorCf('r-cfm1',cfm1);colorCf('r-cfm2',cfm2);colorCf('r-cfa1',cfm1);colorCf('r-cfa2',cfm2);
  const ct1=totCharges+ann1,ct2=totCharges+ann2;const pe1=totLoyerAn>0?ct1/totLoyerAn:0,pe2=totLoyerAn>0?ct2/totLoyerAn:0;
  sv('pe-ctot1',fmt(ct1));sv('pe-ctot2',fmt(ct2));sv('pe-pct1',fmtPct(pe1));sv('pe-pct2',fmtPct(pe2));
  sv('pe-mois1',fmtMois(pe1*12));sv('pe-mois2',fmtMois(pe2*12));sv('pe-marge1',fmtPct(1-pe1));sv('pe-marge2',fmtPct(1-pe2));
  sv('pe-loymin1',fmt(ct1/12));sv('pe-loymin2',fmt(ct2/12));
  const mode=document.getElementById('modeDetention').value;const tmi=parseFloat(document.getElementById('tmi').value)||0;
  const res=totLoyerAn-totCharges-ann1;const ab=coutTotal*0.85/30,at=budgetT/10;let impot=0,cfNet=res;
  if(mode==='IS'){const r2=totLoyerAn-totCharges-ann1*.7-ab;impot=r2>0?Math.min(r2,42500)*.15+Math.max(r2-42500,0)*.25:0;cfNet=res-impot;}
  else if(mode==='IR'){const rf=totLoyerAn-totCharges-ann1*.7;impot=Math.max(rf,0)*(tmi+.172);cfNet=res-impot;}
  else{const rl=res-ab-at;impot=Math.max(rl,0)*tmi;cfNet=res-impot;}
  sv('f-resultat',fmt(res));sv('f-is',fmt(impot));sv('f-cfan',fmt(cfNet));sv('f-cfmois',fmt(cfNet/12));
  const cfSel=selectedScenario===1?cfm1:cfm2;const peSel=selectedScenario===1?pe1:pe2;const margeSel=1-peSel;
  sv('k-total',fmt(coutTotal));sv('k-rnet',fmtPct(rn));sv('k-cf',fmt(cfSel));sv('k-pe',fmtMois(peSel*12));sv('k-ms',fmtPct(margeSel));
  sv('k-cf-sub',selectedScenario===1?'scénario 1 (S1)':'scénario 2 (S2)');
  const kCf=document.getElementById('k-cf');if(kCf)kCf.className='kpi-value '+(cfSel>0?'green':cfSel<0?'red':'orange');
  const kMs=document.getElementById('k-ms');if(kMs)kMs.className='kpi-value '+(margeSel>.2?'green':margeSel>0?'orange':'red');
  calcFisca(totLoyerAn,totCharges,ann1,coutTotal,budgetT,tmi);
  scheduleAutoSave();
}

// ══ FISCALITÉ ══
function calcFisca(loyersAn,charges,annuite,cout,budgetT,tmi){
  const r=loyersAn-charges-annuite,ab=cout*.85/30,at=budgetT/10;
  const rIS=loyersAn-charges-annuite*.7-ab,isT1=Math.min(Math.max(rIS,0),42500)*.15,isT2=Math.max(rIS-42500,0)*.25,cfIS=r-(isT1+isT2);
  const rf=loyersAn-charges-annuite*.7,irImp=Math.max(rf,0)*tmi,irPS=Math.max(rf,0)*.172,cfIR=r-irImp-irPS;
  const rL=r-ab-at,lImp=Math.max(rL,0)*tmi,cfL=r-lImp;
  renderReg('fisca-is-rows',[['Loyers bruts',fmt(loyersAn)],['− Charges exploitation',fmt(charges)],['− Intérêts emprunt ~70% annuité',fmt(annuite*.7)],['− Amortissement bien /30 ans',fmt(ab)],[' Résultat imposable',fmt(rIS),rIS<0?'warn':''],['IS tranche 1 (15% ≤ 42 500€)',fmt(isT1)],['IS tranche 2 (25%)',fmt(isT2)],['IS total',fmt(isT1+isT2)],['CF net annuel après IS',fmt(cfIS),'highlight'],['CF net mensuel',fmt(cfIS/12),'highlight']]);
  renderReg('fisca-ir-rows',[['Loyers bruts',fmt(loyersAn)],['− Charges déductibles',fmt(charges)],['− Intérêts emprunt ~70% annuité',fmt(annuite*.7)],[' Revenu foncier net',fmt(rf),rf<0?'warn':''],['Impôt sur le revenu (TMI)',fmt(irImp)],['Prélèvements sociaux 17,2%',fmt(irPS)],['Total imposition',fmt(irImp+irPS)],['CF net annuel',fmt(cfIR),'highlight'],['CF net mensuel',fmt(cfIR/12),'highlight']]);
  renderReg('fisca-lmnp-rows',[['Loyers bruts',fmt(loyersAn)],['− Charges',fmt(charges)],['− Amortissement bien /30 ans',fmt(ab)],['− Amortissement travaux /10 ans',fmt(at)],[' Résultat imposable LMNP',fmt(rL),rL<0?'warn':''],['Déficit reportable',fmt(Math.min(rL,0)),rL<0?'highlight':''],['Imposition BIC (TMI)',fmt(lImp)],['CF net annuel',fmt(cfL),'highlight'],['CF net mensuel',fmt(cfL/12),'highlight']]);
}
function renderReg(id,rows){const c=document.getElementById(id);if(!c)return;c.innerHTML=rows.map(([l,v,cls])=>\`<div class="regime-row \${cls||''}"><div class="rl">\${l}</div><div class="rv">\${v}</div></div>\`).join('');}

// ══ COMPARATIF ══
const COMP=[['Taux imposition bénéfice','15% / 25%','TMI foyer','0% si amortissement'],['Amortissement du bien','✅ Oui','❌ Non','✅ Oui'],['Amortissement travaux','✅ Oui','❌ Non','✅ Oui'],['Plus-value cession','IS sur +value','Exo 30 ans (IR)','IR / flat tax'],['Déficit foncier','Non applicable','✅ 10 700 €/an','Reportable BIC'],['Recommandé CF positif','✅ Oui','⚠️ Attention TMI','✅ Oui']];
function buildComparatif(){const tb=document.getElementById('fisca-comparatif');if(!tb)return;tb.innerHTML=COMP.map((r,i)=>\`<tr style="background:\${i%2===0?'var(--gray50)':'white'}"><td style="padding:8px;font-weight:600;color:var(--gray800);border-bottom:1px solid var(--gray100)">\${r[0]}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--gray100);background:rgba(30,58,95,.04)">\${r[1]}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--gray100);background:rgba(107,58,138,.04)">\${r[2]}</td><td style="padding:8px;text-align:center;border-bottom:1px solid var(--gray100);background:rgba(26,122,74,.04)">\${r[3]}</td></tr>\`).join('');}

// ══ TABS ══
function showTab(name,btn){document.querySelectorAll('.tab-content').forEach(el=>el.classList.remove('active'));document.querySelectorAll('.tab-btn').forEach(el=>el.classList.remove('active'));document.getElementById('tab-'+name).classList.add('active');btn.classList.add('active');}

// ══ SCENARIO ══
function selectScenario(n){selectedScenario=n;document.getElementById('scen-btn-1').className='scen-btn'+(n===1?' active':'');document.getElementById('scen-btn-2').className='scen-btn'+(n===2?' active':'');calc();}

// ══ RESET ══
function openModal(){document.getElementById('resetModal').classList.add('open');}
function closeModal(){document.getElementById('resetModal').classList.remove('open');}
function doReset(){
  ['prixAffiche','prixNegocie','surface','honoraires','enedis','taxeFonciere','assurance','compta','provisions','apport1','apport2','taux1','taux2','duree1','duree2','coefEtat','imprevusPct'].forEach(id=>{const el=document.getElementById(id);if(el)el.value=0;});
  document.getElementById('gestionActive').checked=false;const tnEl=document.getElementById('tauxNotaire');if(tnEl)tnEl.value='0.08';document.getElementById('modeDetention').value='IS';document.getElementById('tmi').value='0.30';document.getElementById('coefEtat').value=1.0;
  const pn=document.getElementById('projectName');if(pn)pn.value='';
  lots=[{type:'Sélectionner',m2:0,loyer:0,niveau:'RDC',comment:''}];
  ['projetDescription','projetTravaux','projetAtouts'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  projectPhotos=[null,null,null,null];renderPhotoSlots();customDivers=[];budgetQty={};budgetPrice={};
  pricesLocked=true;buildBudgetRows();renderLots();calcBudget(false);calc();closeModal();
}

// ══ EXPORT XLSX ══
function exportXLSX(){
  const wb=XLSX.utils.book_new();const pN=iv('prixNegocie'),fn=pN*.08,bT=getBudgetTTC(),tot=pN+fn+bT+iv('honoraires')+iv('enedis');
  const gA=document.getElementById('gestionActive').checked;const aLots=lots.filter(l=>l.type!=='Sélectionner');
  const sd=[['SIMULATEUR PROJET — PROFERO INVEST'],[''],['A — ACQUISITION'],['Prix affiché',iv('prixAffiche')],['Prix négocié',pN],['Frais notaire 8%',fn],['Budget travaux TTC',bT],['Honoraires',iv('honoraires')],['Enedis',iv('enedis')],['COÛT TOTAL',tot],[''],['B — LOTS'],['Type','m²','Loyer/mois','Loyer/an','Gestion/mois'],...aLots.map(l=>[l.type,l.m2,l.loyer,l.loyer*12,gA?(GESTION_PRICES[l.type]||0):0]),[''],['C — CHARGES (€/an)'],['Taxe foncière',iv('taxeFonciere')],['Assurance PNO',iv('assurance')],['Comptabilité société',iv('compta')],['Provisions travaux',iv('provisions')]];
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(sd),'Simulation');
  const bRows=[['BUDGET TRAVAUX'],[''],['Corps de métier','Base','Qté','Prix unit.','Total HT']];
  BUDGET_SECTIONS.forEach(sec=>{bRows.push([sec.sec]);sec.items.forEach(item=>{bRows.push([item.label,item.base,budgetQty[item.id]||0,budgetPrice[item.id]||0,(budgetQty[item.id]||0)*(budgetPrice[item.id]||0)])})});
  customDivers.forEach(cd=>bRows.push([cd.label,'unité',cd.qty||0,cd.price||0,(cd.qty||0)*(cd.price||0)]));
  XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet(bRows),'Budget Travaux');
  XLSX.writeFile(wb,'Profero_Simulation.xlsx');
}

// ══ FICHE PDF ══
function genererFiche(){
  const pN=iv('prixNegocie');const tauxN=parseFloat(document.getElementById('tauxNotaire')?.value)||0.08;
  const fn=pN*tauxN;const prixAchat=pN+fn;const budgetT=iv('budgetTravaux');const honoraires=iv('honoraires');const enedis=iv('enedis');
  const coutTotal=prixAchat+budgetT+honoraires+enedis;const surface=iv('surface');
  const projectName=document.getElementById('projectName')?.value||'Projet Profero';
  const gActive=document.getElementById('gestionActive').checked;
  const descText=document.getElementById('projetDescription')?.value||'';
  const travauxText=document.getElementById('projetTravaux')?.value||'';
  const atoutsText=document.getElementById('projetAtouts')?.value||'';
  const fichePhotos=projectPhotos.filter(p=>p);
  const actLots=lots.filter(l=>l.type!=='Sélectionner');
  const totalLoyer=actLots.reduce((s,l)=>s+l.loyer,0);const totalLoyerAn=totalLoyer*12;
  const totGestMois=gActive?actLots.reduce((s,l)=>s+(GESTION_PRICES[l.type]||0),0):0;const totGestAn=totGestMois*12;
  const taxe=iv('taxeFonciere'),assur=iv('assurance'),compta_v=iv('compta'),prov=iv('provisions');
  const totCharges=taxe+assur+compta_v+totGestAn+prov;
  const apport1=iv('apport1'),taux1=iv('taux1'),duree1=iv('duree1');
  const af1=coutTotal-apport1;const m1=pmt(af1,taux1,duree1);const ann1=m1*12;
  const rbrute=coutTotal>0?totalLoyerAn/coutTotal:0;const rnette=coutTotal>0?(totalLoyerAn-totCharges)/coutTotal:0;
  const cfm1=(totalLoyerAn-totCharges)/12-m1;
  const prixM2=surface>0?Math.round(prixAchat/surface):0;const opM2=surface>0?Math.round(coutTotal/surface):0;
  const esc=s=>(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
  const fmtN=v=>Math.round(v).toLocaleString('fr-FR');
  const lotRowsHTML=actLots.map((lot,i)=>'<tr><td>Appartement '+(i+1)+(lot.comment?' <span style="color:#64748b;font-size:9px">— '+esc(lot.comment)+'</span>':'')+'</td><td style="text-align:center">'+esc(lot.type)+'</td><td style="text-align:center">'+(lot.niveau||'—')+'</td><td style="text-align:right">'+lot.m2+' m²</td><td style="text-align:right;font-weight:700;color:#1a7a4a">'+lot.loyer.toLocaleString('fr-FR')+' €</td>'+(gActive?'<td style="text-align:right;color:#d4610a">'+(GESTION_PRICES[lot.type]||0).toLocaleString('fr-FR')+' €</td>':'')+'</tr>').join('');
  const win=window.open('','_blank','width=900,height=700');
  if(!win){alert('Autorisez les pop-ups pour ce site.');return;}
  win.document.write(\`<!DOCTYPE html><html lang="fr"><head><meta charset="UTF-8"><title>Fiche — \${projectName}</title>
  <link href="https://fonts.googleapis.com/css2?family=Sora:wght@300;400;600;700;800&display=swap" rel="stylesheet">
  <style>*{box-sizing:border-box;margin:0;padding:0;}body{font-family:'Sora',sans-serif;background:white;padding:0;font-size:11px;color:#2c3040;}
  .page{padding:14mm;max-width:210mm;margin:0 auto;}
  .fiche-header{display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:14px;padding-bottom:10px;border-bottom:2px solid #1f4ea1;}
  .fiche-brand{font-size:16px;font-weight:800;color:#1a2d4a;}.fiche-title h1{font-size:18px;font-weight:800;color:#1a2d4a;}.fiche-title h2{font-size:12px;color:#1f4ea1;font-weight:600;margin-top:3px;}
  .kpi-bar{display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:14px;}
  .kpi-box{background:#f8f9fb;border-radius:8px;padding:10px 12px;border-left:3px solid #1f4ea1;}
  .kpi-box.green{border-left-color:#1a7a4a;}.kpi-box.orange{border-left-color:#d4610a;}.kpi-box.gold{border-left-color:#c9a84c;}
  .kpi-val{font-size:15px;font-weight:800;color:#1a2d4a;}.kpi-val.green{color:#1a7a4a;}.kpi-val.orange{color:#d4610a;}
  .kpi-lbl{font-size:9px;font-weight:600;color:#9aa0b0;text-transform:uppercase;letter-spacing:.05em;margin-top:3px;}
  .section-title{background:#1a2d4a;color:white;padding:5px 10px;font-size:10px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;border-radius:4px 4px 0 0;}
  .section-body{border:1px solid #eef0f5;border-top:none;border-radius:0 0 4px 4px;padding:10px 12px;}
  .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:12px;}
  table{width:100%;border-collapse:collapse;font-size:10px;}th{background:#1e3a5f;color:white;padding:5px 8px;text-align:left;font-weight:700;font-size:9px;text-transform:uppercase;}
  td{padding:5px 8px;border-bottom:1px solid #eef0f5;}tr:nth-child(even) td{background:#f8f9fb;}
  .no-print{position:fixed;top:16px;right:16px;display:flex;gap:8px;z-index:100;}
  .print-btn{padding:10px 20px;background:#1f4ea1;color:white;border:none;border-radius:6px;font-family:'Sora',sans-serif;font-size:13px;font-weight:700;cursor:pointer;}
  .close-btn{padding:10px 16px;background:#f8f9fb;color:#1a2d4a;border:1px solid #d8dce6;border-radius:6px;font-family:'Sora',sans-serif;font-size:13px;cursor:pointer;}
  @media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}.no-print{display:none!important;}@page{size:A4;margin:0;}}
  </style></head><body>
  <div class="no-print"><button class="close-btn" onclick="window.close()">✕ Fermer</button><button class="print-btn" onclick="window.print()">🖨️ Imprimer / PDF</button></div>
  <div class="page">
    <div class="fiche-header"><div class="fiche-brand">🏢 Profero Invest</div><div class="fiche-title"><h1>\${esc(projectName)}</h1><h2>Analyse de Rentabilité · Généré le \${new Date().toLocaleDateString('fr-FR',{day:'2-digit',month:'long',year:'numeric'})}</h2></div></div>
    <div class="kpi-bar">
      <div class="kpi-box green"><div class="kpi-val green">\${(rbrute*100).toFixed(2)} %</div><div class="kpi-lbl">Rendement brut</div></div>
      <div class="kpi-box green"><div class="kpi-val green">\${(rnette*100).toFixed(2)} %</div><div class="kpi-lbl">Rendement net</div></div>
      <div class="kpi-box \${cfm1>=0?'green':'orange'}"><div class="kpi-val \${cfm1>=0?'green':'orange'}">\${fmtN(cfm1)} €/mois</div><div class="kpi-lbl">Cash-flow S1</div></div>
      <div class="kpi-box"><div class="kpi-val">\${fmtN(coutTotal)} €</div><div class="kpi-lbl">Coût total</div></div>
      <div class="kpi-box gold"><div class="kpi-val">\${fmtN(totalLoyer)} €/mois</div><div class="kpi-lbl">Loyers</div></div>
    </div>
    \${fichePhotos.length>0?\`<div style="margin-bottom:12px"><div class="section-title">📷 Photos</div><div class="section-body"><div style="display:grid;grid-template-columns:repeat(\${Math.min(fichePhotos.length,4)},1fr);gap:8px">\${fichePhotos.map((p,i)=>\`<img src="\${p}" style="width:100%;height:120px;object-fit:cover;border-radius:4px">\`).join('')}</div></div></div>\`:''}
    <div class="grid-2" style="margin-bottom:12px">
      <div><div class="section-title">🏢 Acquisition</div><div class="section-body">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px 12px">
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Prix négocié</div><div style="font-weight:700">\${fmtN(pN)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Budget travaux</div><div style="font-weight:700">\${fmtN(budgetT)} €</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Surface</div><div style="font-weight:700">\${surface} m²</div></div>
          <div><div style="font-size:9px;color:#9aa0b0;text-transform:uppercase">Coût total</div><div style="font-weight:700;color:#1a7a4a">\${fmtN(coutTotal)} €</div></div>
        </div>
        \${descText?\`<div style="margin-top:8px;padding:6px 8px;background:#f0f4ff;border-radius:4px;border-left:3px solid #1f4ea1;font-size:10px;color:#5a6070;line-height:1.5">\${esc(descText)}</div>\`:''}
      </div></div>
      <div><div class="section-title">🏘️ Lots (\${actLots.length})</div><div class="section-body">
        <table><thead><tr><th>Lot</th><th>Type</th><th>Niv.</th><th>m²</th><th>Loyer</th>\${gActive?'<th>Gestion</th>':''}</tr></thead>
        <tbody>\${lotRowsHTML}<tr style="background:#1a2d4a"><td colspan="4" style="color:white;font-weight:700">TOTAL</td><td style="text-align:right;color:#50c878;font-weight:700">\${fmtN(totalLoyer)} €</td>\${gActive?\`<td style="text-align:right;color:#f5a623;font-weight:700">\${fmtN(totGestMois)} €</td>\`:''}</tr></tbody></table>
      </div></div>
    </div>
    <div style="font-size:9px;color:#9aa0b0;text-align:center;margin-top:16px;padding-top:8px;border-top:1px solid #eef0f5">Profero Invest · Document confidentiel · \${new Date().toLocaleDateString('fr-FR')}</div>
  </div></body></html>\`);
  win.document.close();
}

// ══ PHOTOS ══
const PHOTO_LABELS=['Photo principale','Vue intérieure','Vue extérieure','Autre'];
function renderPhotoSlots(){
  const container=document.getElementById('photoSlots');if(!container)return;container.innerHTML='';
  projectPhotos.forEach((photo,i)=>{
    const wrap=document.createElement('div');
    wrap.innerHTML=\`<div class="photo-slot-label">\${PHOTO_LABELS[i]}</div>
      <div class="photo-zone \${photo?'has-photo':''}" id="photo-zone-\${i}"
           onclick="document.getElementById('photo-input-\${i}').click()"
           ondragover="event.preventDefault();this.style.borderColor='var(--profero-blue)'"
           ondragleave="this.style.borderColor=''"
           ondrop="handlePhotoDrop(event,\${i})">
        \${photo
          ?\`<img src="\${photo}" alt="Photo \${i+1}"><div class="photo-zone-actions"><button class="photo-action-btn" onclick="event.stopPropagation();removePhoto(\${i})">✕ Retirer</button></div>\`
          :\`<div class="photo-zone-icon">📷</div><div class="photo-zone-label">\${PHOTO_LABELS[i]}<br><span style="font-size:10px;font-weight:400">Cliquer ou glisser</span></div>\`
        }
      </div>
      <input type="file" id="photo-input-\${i}" accept="image/*" style="display:none" onchange="handlePhotoFile(event,\${i})">\`;
    container.appendChild(wrap);
  });
}
function handlePhotoFile(event,index){const file=event.target.files[0];if(!file)return;if(file.size>5*1024*1024){alert('Photo trop volumineuse (max 5 Mo).');return;}const reader=new FileReader();reader.onload=e=>{projectPhotos[index]=e.target.result;renderPhotoSlots();scheduleAutoSave();};reader.readAsDataURL(file);event.target.value='';}
function handlePhotoDrop(event,index){event.preventDefault();const file=event.dataTransfer.files[0];if(!file||!file.type.startsWith('image/'))return;if(file.size>5*1024*1024){alert('Photo trop volumineuse (max 5 Mo).');return;}const reader=new FileReader();reader.onload=e=>{projectPhotos[index]=e.target.result;renderPhotoSlots();scheduleAutoSave();};reader.readAsDataURL(file);}
function removePhoto(index){projectPhotos[index]=null;renderPhotoSlots();scheduleAutoSave();}

// ══ INIT ══
buildBudgetRows();
buildComparatif();
renderLots();
calcBudget(false);
calc();
renderPhotoSlots();
updateProjectDate();
<\/script>
</body>
</html>`;
}
