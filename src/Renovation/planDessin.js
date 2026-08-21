// ─────────────────────────────────────────────────────────────────────────────
// DESSIN DE PLANS — helpers purs partagés entre l'éditeur bureau (Plans.jsx)
// et la visionneuse lecture seule de l'espace ouvrier (PlanViewerOuvrier.jsx).
// Extraits de Plans.jsx tels quels : ne modifier le rendu qu'ici.
// ─────────────────────────────────────────────────────────────────────────────

export function getBounds(segments, symbols=[]) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity;
  segments.forEach(s => {
    minX=Math.min(minX,s.x1,s.x2); maxX=Math.max(maxX,s.x1,s.x2);
    minY=Math.min(minY,s.y1,s.y2); maxY=Math.max(maxY,s.y1,s.y2);
  });
  symbols.forEach(s => {
    minX=Math.min(minX,s.x); maxX=Math.max(maxX,s.x);
    minY=Math.min(minY,s.y); maxY=Math.max(maxY,s.y);
  });
  if (!isFinite(minX)) return {minX:0,maxX:100,minY:0,maxY:100,w:100,h:100};
  return {minX,maxX,minY,maxY,w:maxX-minX,h:maxY-minY};
}

export function calcSurface(pts) {
  let s = 0;
  const n = pts.length;
  for (let i=0; i<n; i++) {
    const j = (i+1)%n;
    s += pts[i].x * pts[j].y;
    s -= pts[j].x * pts[i].y;
  }
  return Math.abs(s/2);
}

// ── Dessin des symboles bibliothèque (taille écran fixe) ────────────────────
// SZ = taille de base en pixels écran, indépendante du zoom
export function drawLibSym(ctx, symType, label, color, sz, isPrint) {
  const sc = isPrint ? '#1a1f2e' : color;   // couleur stroke
  const fc = isPrint ? '#1a1f2e' : color;   // couleur fill
  const bg = isPrint ? '#ffffff' : '#12151f';
  ctx.strokeStyle = sc;
  ctx.fillStyle   = fc;
  ctx.lineWidth   = 1.5;

  // ─ Fond commun : carré arrondi ─
  const h = sz * 0.55; // demi-côté
  ctx.fillStyle = isPrint ? 'rgba(240,240,235,0.92)' : 'rgba(18,21,31,0.82)';
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-h, -h, h*2, h*2, sz*0.15);
  else ctx.rect(-h, -h, h*2, h*2);
  ctx.fill();
  ctx.strokeStyle = sc;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  if (ctx.roundRect) ctx.roundRect(-h, -h, h*2, h*2, sz*0.15);
  else ctx.rect(-h, -h, h*2, h*2);
  ctx.stroke();

  const r = sz * 0.28; // rayon cercle intérieur
  ctx.strokeStyle = sc;
  ctx.lineWidth = 1.5;

  // ─ Pictogramme selon le type ─
  if (symType === 'elec_inter_simple') {
    // Cercle + trait oblique (interrupteur NF)
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(r*0.7, -r*1.6); ctx.stroke();
    ctx.beginPath(); ctx.arc(r*0.7, -r*1.6, r*0.15, 0, Math.PI*2); ctx.fill();

  } else if (symType === 'elec_inter_double') {
    ctx.beginPath(); ctx.arc(-r*0.5, 0, r*0.65, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(r*0.5,  0, r*0.65, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.5,-r*0.65); ctx.lineTo(-r*0.1,-r*1.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( r*0.5,-r*0.65); ctx.lineTo( r*0.9,-r*1.4); ctx.stroke();

  } else if (symType === 'elec_va_vient') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(r*0.7,-r*1.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.5,-r*0.3); ctx.lineTo(r*0.5,-r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(r*0.7,-r*1.6, r*0.15, 0, Math.PI*2); ctx.fill();

  } else if (symType === 'elec_minuterie') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    // aiguille horloge
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(0,-r*0.8); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(r*0.5,r*0.3); ctx.stroke();

  } else if (symType === 'elec_variateur') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    // flèche diagonale
    ctx.beginPath(); ctx.moveTo(-r*0.6,r*0.6); ctx.lineTo(r*0.6,-r*0.6); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.6,-r*0.6); ctx.lineTo(r*0.2,-r*0.6); ctx.moveTo(r*0.6,-r*0.6); ctx.lineTo(r*0.6,-r*0.2); ctx.stroke();

  } else if (symType === 'elec_prise') {
    // 2 traits verticaux = broches + demi-cercle
    ctx.beginPath(); ctx.arc(0, 0, r, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.4,-r*0.2); ctx.lineTo(-r*0.4,r*0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo( r*0.4,-r*0.2); ctx.lineTo( r*0.4,r*0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0, r*0.4); ctx.lineTo(0, r*0.7); ctx.stroke(); // terre

  } else if (symType === 'elec_prise_double') {
    // 2 fois le symbole prise côte à côte miniaturisé
    [-r*0.55, r*0.55].forEach(ox => {
      ctx.beginPath(); ctx.arc(ox, 0, r*0.45, Math.PI, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox-r*0.2,-r*0.1); ctx.lineTo(ox-r*0.2,r*0.2); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(ox+r*0.2,-r*0.1); ctx.lineTo(ox+r*0.2,r*0.2); ctx.stroke();
    });

  } else if (symType === 'elec_prise_data') {
    // Rectangle avec traits (connecteur)
    ctx.strokeRect(-r*0.7,-r*0.5,r*1.4,r);
    for (let i=0;i<3;i++) { ctx.beginPath(); ctx.moveTo(-r*0.5+i*r*0.5,-r*0.5); ctx.lineTo(-r*0.5+i*r*0.5,r*0.5); ctx.stroke(); }

  } else if (symType === 'elec_luminaire') {
    // Cercle + croix (symbole plafonnier NF)
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.moveTo(0,-r); ctx.lineTo(0,r); ctx.stroke();

  } else if (symType === 'elec_spot') {
    // Double cercle concentrique
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r*0.45, 0, Math.PI*2); ctx.fill();

  } else if (symType === 'elec_applique') {
    // Demi-cercle + ligne murale
    ctx.beginPath(); ctx.arc(0, -r*0.3, r*0.7, Math.PI, 0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r, -r*0.3); ctx.lineTo(r, -r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,-r*0.3,r*0.18,0,Math.PI*2); ctx.fill();

  } else if (symType === 'elec_hublot') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r*0.5, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,-r); ctx.lineTo(r,r); ctx.stroke(); // IP

  } else if (symType === 'elec_tableau') {
    ctx.strokeRect(-r,-r*1.2,r*2,r*2.4);
    for (let i=0;i<3;i++) { ctx.beginPath(); ctx.moveTo(-r*0.7,-r*0.6+i*r*0.6); ctx.lineTo(r*0.7,-r*0.6+i*r*0.6); ctx.stroke(); }

  } else if (symType === 'elec_disjoncteur') {
    ctx.strokeRect(-r*0.5,-r,r,r*2);
    ctx.beginPath(); ctx.moveTo(-r*0.4,-r*0.5); ctx.lineTo(r*0.4,r*0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(0,-r*1.4); ctx.moveTo(0,r); ctx.lineTo(0,r*1.4); ctx.stroke();

  } else if (symType === 'elec_differentiel') {
    ctx.strokeRect(-r*0.6,-r,r*1.2,r*2);
    ctx.beginPath(); ctx.moveTo(-r*0.5,-r*0.4); ctx.lineTo(r*0.5,r*0.4); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.5,0); ctx.lineTo(r*0.5,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-r); ctx.lineTo(0,-r*1.4); ctx.moveTo(0,r); ctx.lineTo(0,r*1.4); ctx.stroke();

  } else if (symType === 'elec_detecteur') {
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0, 0, r*0.35, 0, Math.PI*2);
    ctx.fillStyle = isPrint ? '#555' : color; ctx.fill();

  } else if (symType === 'elec_sonnette') {
    ctx.beginPath(); ctx.arc(0, r*0.15, r*0.7, Math.PI, 0); ctx.lineTo(r*0.7,r*0.15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.7,r*0.15); ctx.lineTo(r*0.7,r*0.15); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,r*0.15); ctx.lineTo(0,r*0.55); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,r*0.6,r*0.12,0,Math.PI*2); ctx.fill();

  } else if (symType === 'plomb_robinet') {
    // Corps rectangle + papillon (2 triangles)
    ctx.strokeRect(-r*0.8,-r*0.3,r*1.6,r*0.6);
    ctx.beginPath(); ctx.moveTo(-r*0.8,0); ctx.lineTo(-r*1.3,-r*0.4); ctx.lineTo(-r*1.3,r*0.4); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.8,0); ctx.lineTo(r*1.3,-r*0.4); ctx.lineTo(r*1.3,r*0.4); ctx.closePath(); ctx.stroke();

  } else if (symType === 'plomb_robinet_eq') {
    ctx.strokeRect(-r*0.8,-r*0.3,r*1.6,r*0.6);
    ctx.beginPath(); ctx.moveTo(-r*0.8,0); ctx.lineTo(-r*1.3,-r*0.4); ctx.lineTo(-r*1.3,r*0.4); ctx.closePath(); ctx.stroke();
    // Sortie vers le bas
    ctx.beginPath(); ctx.moveTo(0,r*0.3); ctx.lineTo(0,r); ctx.stroke();

  } else if (symType === 'plomb_clapet') {
    ctx.strokeRect(-r,-r*0.35,r*2,r*0.7);
    ctx.beginPath(); ctx.moveTo(-r*0.5,0); ctx.lineTo(r*0.5,0); ctx.stroke();
    // Flèche sens
    ctx.beginPath(); ctx.moveTo(r*0.5,0); ctx.lineTo(r*0.1,-r*0.3); ctx.moveTo(r*0.5,0); ctx.lineTo(r*0.1,r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.5,-r*0.35); ctx.lineTo(r*0.5,r*0.35); ctx.stroke();

  } else if (symType === 'plomb_vanne') {
    // Tuyau + 2 triangles face à face
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(-r*0.55,0); ctx.moveTo(r*0.55,0); ctx.lineTo(r,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.55,-r*0.5); ctx.lineTo(-r*0.55,r*0.5); ctx.lineTo(r*0.55,0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.55,-r*0.5); ctx.lineTo(r*0.55,r*0.5); ctx.lineTo(-r*0.55,0); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,-r*0.5); ctx.lineTo(0,-r); ctx.stroke();

  } else if (symType === 'plomb_siphon') {
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,r*0.45,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.45,0); ctx.lineTo(r*0.45,0); ctx.moveTo(0,-r*0.45); ctx.lineTo(0,r*0.45); ctx.stroke();

  } else if (symType === 'plomb_compteur') {
    ctx.strokeRect(-r,-r*0.6,r*2,r*1.2);
    // M intérieur
    ctx.beginPath(); ctx.moveTo(-r*0.6,r*0.3); ctx.lineTo(-r*0.6,-r*0.3); ctx.lineTo(0,r*0.2); ctx.lineTo(r*0.6,-r*0.3); ctx.lineTo(r*0.6,r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(-r*1.4,0); ctx.moveTo(r,0); ctx.lineTo(r*1.4,0); ctx.stroke();

  } else if (symType === 'plomb_chauffe_eau') {
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.5,-r*0.3); ctx.lineTo(-r*0.5,r*0.3); ctx.lineTo(r*0.5,r*0.3); ctx.lineTo(r*0.5,-r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,r*0.2,0,Math.PI*2); ctx.fill();

  } else if (symType === 'plomb_chaudiere') {
    ctx.strokeRect(-r,-r,r*2,r*2);
    ctx.beginPath(); ctx.moveTo(-r*0.7,r*0.3); ctx.lineTo(r*0.7,r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.7,-r*0.3); ctx.lineTo(r*0.7,-r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(-r*1.4,0); ctx.moveTo(r,0); ctx.lineTo(r*1.4,0); ctx.stroke();

  } else if (symType === 'plomb_colonne') {
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.moveTo(0,-r); ctx.lineTo(0,r); ctx.stroke();

  } else if (symType === 'plomb_regard') {
    ctx.strokeRect(-r,-r,r*2,r*2);
    ctx.beginPath(); ctx.moveTo(-r,-r); ctx.lineTo(r,r); ctx.moveTo(r,-r); ctx.lineTo(-r,r); ctx.stroke();

  } else if (symType === 'plomb_pompe') {
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(-r*0.6,0); ctx.moveTo(r*0.6,0); ctx.lineTo(r,0); ctx.stroke();
    ctx.beginPath(); ctx.arc(0,0,r*0.6,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.3,r*0.3); ctx.lineTo(r*0.3,-r*0.3); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.3,-r*0.3); ctx.lineTo(r*0.05,-r*0.3); ctx.moveTo(r*0.3,-r*0.3); ctx.lineTo(r*0.3,-r*0.05); ctx.stroke();

  } else if (symType === 'plomb_nourrice') {
    ctx.strokeRect(-r,-r*0.35,r*2,r*0.7);
    [-r*0.65,-r*0.22,r*0.22,r*0.65].forEach(x=>{ ctx.beginPath(); ctx.moveTo(x,r*0.35); ctx.lineTo(x,r); ctx.stroke(); });
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(-r*1.4,0); ctx.stroke();

  } else if (symType === 'plomb_vase') {
    ctx.beginPath(); ctx.arc(0,0,r,0,Math.PI*2); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,0); ctx.lineTo(r,0); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.7,-r*0.5); ctx.lineTo(r*0.7,-r*0.5); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(0,r); ctx.lineTo(0,r*1.4); ctx.stroke();

  // ─ Radiateurs & sèche-serviettes ─────────────────────────────────────────
  } else if (symType === 'rad_elec' || symType === 'rad_elec_l') {
    // Rectangle horizontal avec ailettes verticales + symbole éclair
    const rw = symType==='rad_elec_l' ? r*1.8 : r*1.1;
    ctx.strokeRect(-rw, -r*0.4, rw*2, r*0.8);
    const nc = symType==='rad_elec_l' ? 5 : 3;
    for(let i=1;i<nc;i++){ const x=-rw+i*(rw*2/nc); ctx.beginPath(); ctx.moveTo(x,-r*0.4); ctx.lineTo(x,r*0.4); ctx.stroke(); }
    // Éclair centré
    ctx.beginPath();
    ctx.moveTo(r*0.1,-r*0.25); ctx.lineTo(-r*0.1,0); ctx.lineTo(r*0.05,0); ctx.lineTo(-r*0.1,r*0.25);
    ctx.stroke();

  } else if (symType === 'rad_eau' || symType === 'rad_eau_l') {
    // Rectangle horizontal avec ailettes + 2 points de raccord (eau)
    const rw = symType==='rad_eau_l' ? r*1.8 : r*1.1;
    ctx.strokeRect(-rw, -r*0.4, rw*2, r*0.8);
    const nc = symType==='rad_eau_l' ? 5 : 3;
    for(let i=1;i<nc;i++){ const x=-rw+i*(rw*2/nc); ctx.beginPath(); ctx.moveTo(x,-r*0.4); ctx.lineTo(x,r*0.4); ctx.stroke(); }
    // 2 raccords eau (cercles aux extrémités)
    ctx.beginPath(); ctx.arc(-rw, 0, r*0.12, 0, Math.PI*2); ctx.fill();
    ctx.beginPath(); ctx.arc(rw, 0, r*0.12, 0, Math.PI*2); ctx.fill();

  } else if (symType === 'ss_elec' || symType === 'ss_eau' || symType === 'ss_mixte') {
    // Cadre vertical (sèche-serviettes = portrait)
    ctx.strokeRect(-r*0.55, -r, r*1.1, r*2);
    // 3 barreaux horizontaux
    for(let i=0;i<3;i++){
      const y = -r*0.55 + i*r*0.55;
      ctx.beginPath(); ctx.moveTo(-r*0.55, y); ctx.lineTo(r*0.55, y); ctx.stroke();
    }
    if (symType==='ss_elec') {
      // Éclair à droite
      ctx.beginPath(); ctx.moveTo(r*0.15,-r*0.2); ctx.lineTo(-r*0.05,r*0.05); ctx.lineTo(r*0.08,r*0.05); ctx.lineTo(-r*0.1,r*0.3); ctx.stroke();
    } else if (symType==='ss_eau') {
      // 2 raccords eau
      ctx.beginPath(); ctx.arc(0, -r, r*0.13, 0, Math.PI*2); ctx.fill();
      ctx.beginPath(); ctx.arc(0, r, r*0.13, 0, Math.PI*2); ctx.fill();
    } else {
      // Mixte : éclair + raccord
      ctx.beginPath(); ctx.moveTo(r*0.15,-r*0.3); ctx.lineTo(-r*0.05,-r*0.05); ctx.lineTo(r*0.08,-r*0.05); ctx.lineTo(-r*0.1,r*0.2); ctx.stroke();
      ctx.beginPath(); ctx.arc(0, r, r*0.13, 0, Math.PI*2); ctx.fill();
    }

  // ─ Légendes ───────────────────────────────────────────────────────────────
  } else if (symType.startsWith('legende_')) {
    // Pictogramme : petite grille tableau
    ctx.strokeRect(-r, -r*0.8, r*2, r*1.6);
    ctx.beginPath(); ctx.moveTo(-r, -r*0.27); ctx.lineTo(r, -r*0.27); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r,  r*0.27); ctx.lineTo(r,  r*0.27); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(-r*0.2, -r*0.8); ctx.lineTo(-r*0.2, r*0.8); ctx.stroke();
    // Petits carrés colorés à gauche (symboles)
    const cols = symType==='legende_elec' ? ['#FFC200','#5b8af5','#f5d08a','#e05c5c'] :
                 symType==='legende_plomb' ? ['#5b8af5','#40d0e0','#f5a623','#50c878'] :
                 symType==='legende_chauff' ? ['#f5a623','#e05c5c','#5b8af5','#b060ff'] :
                 ['#FFC200','#5b8af5','#f5a623','#50c878'];
    cols.forEach((c,i) => {
      ctx.fillStyle = c;
      ctx.fillRect(-r*0.15, -r*0.7 + i*r*0.45, r*0.2, r*0.28);
    });
  }

  // ─ Label court centré en bas ─
  const fs = Math.max(9, sz * 0.32);
  ctx.font = `bold ${fs}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.fillStyle = isPrint ? '#1a1f2e' : color;
  ctx.fillText(label, 0, h + fs + 1);
}
