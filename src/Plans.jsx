import React, { useState, useEffect, useRef, useCallback } from "react";
import { supabase } from "./supabase";
import { COULEURS_PALETTE, THEMES, DEFAULT_CHANTIERS } from "./constants";

// ─── PAGE PLANS ───────────────────────────────────────────────────────────────

// ─── DXF PARSER ───────────────────────────────────────────────────────────────
function parseDXF(text) {
  const lines = text.split('\n').map(l => l.trim());
  const points = [], segments = [];
  const DXF_COLORS = {
    1:'#ff0000',2:'#ffff00',3:'#00ff00',4:'#00ffff',5:'#0000ff',
    6:'#ff00ff',7:'#ffffff',30:'#ff8000',40:'#80ff00',50:'#00ff80',
    60:'#0080ff',70:'#8000ff',80:'#ff0080',90:'#c0c0c0',100:'#808080',
    110:'#ffd700',113:'#a0c0ff',130:'#90ee90',150:'#ffb6c1',
  };
  const getColor = (c) => DXF_COLORS[c] || '#7090c0';
  let i = 0;
  while (i < lines.length) {
    const tok = lines[i];
    if (tok === 'POINT') {
      let x=null,y=null,color=7,layer='0';
      let j=i+1;
      while (j < Math.min(i+30, lines.length)) {
        const code = lines[j], val = lines[j+1];
        if (code==='10') x=parseFloat(val);
        else if (code==='20') y=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      if (x!=null && y!=null) points.push({x,y,color:getColor(color),layer});
    } else if (tok==='LINE') {
      let x1=null,y1=null,x2=null,y2=null,color=7,layer='0';
      let j=i+1;
      while (j < Math.min(i+40, lines.length)) {
        const code=lines[j], val=lines[j+1];
        if (code==='10') x1=parseFloat(val);
        else if (code==='20') y1=parseFloat(val);
        else if (code==='11') x2=parseFloat(val);
        else if (code==='21') y2=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      if (x1!=null&&y1!=null&&x2!=null&&y2!=null) segments.push({x1,y1,x2,y2,color:getColor(color),layer,id:Math.random()});
    } else if (tok==='LWPOLYLINE') {
      let verts=[],color=7,layer='0',closed=false;
      let j=i+1;
      while (j < Math.min(i+500, lines.length)) {
        const code=lines[j], val=lines[j+1];
        if (code==='10') verts.push({x:parseFloat(val),y:null});
        else if (code==='20' && verts.length) verts[verts.length-1].y=parseFloat(val);
        else if (code==='62') color=parseInt(val)||7;
        else if (code==='8') layer=val||'0';
        else if (code==='70') closed=!!(parseInt(val)&1);
        else if (code==='0' && j>i+1) break;
        j+=2;
      }
      const c=getColor(color);
      for (let k=0;k<verts.length-1;k++) {
        if (verts[k].y!=null&&verts[k+1].y!=null)
          segments.push({x1:verts[k].x,y1:verts[k].y,x2:verts[k+1].x,y2:verts[k+1].y,color:c,layer,id:Math.random()});
      }
      if (closed&&verts.length>1&&verts[0].y!=null&&verts[verts.length-1].y!=null)
        segments.push({x1:verts[verts.length-1].x,y1:verts[verts.length-1].y,x2:verts[0].x,y2:verts[0].y,color:c,layer,id:Math.random()});
    }
    i++;
  }
  let maxY = -Infinity;
  points.forEach(p  => { if (p.y  > maxY) maxY = p.y; });
  segments.forEach(s => { if (s.y1 > maxY) maxY = s.y1; if (s.y2 > maxY) maxY = s.y2; });
  if (!isFinite(maxY)) maxY = 0;
  points.forEach(p   => { p.y  = maxY - p.y; });
  segments.forEach(s => { s.y1 = maxY - s.y1; s.y2 = maxY - s.y2; });
  return {points, segments};
}

function autoConnect(points, threshold) {
  if (points.length === 0) return [];
  const groups = {};
  points.forEach(p => {
    const k = p.color+'_'+p.layer;
    if (!groups[k]) groups[k] = [];
    groups[k].push(p);
  });
  const segs = [];
  Object.values(groups).forEach(grp => {
    if (grp.length < 2) return;
    const bucket = {};
    const bsize = threshold;
    grp.forEach((p,idx) => {
      const bx = Math.floor(p.x/bsize), by = Math.floor(p.y/bsize);
      for (let dx=-1;dx<=1;dx++) for (let dy=-1;dy<=1;dy++) {
        const key = `${bx+dx}_${by+dy}`;
        if (!bucket[key]) continue;
        bucket[key].forEach(j => {
          if (j >= idx) return;
          const q = grp[j];
          const d = Math.sqrt((p.x-q.x)**2+(p.y-q.y)**2);
          if (d < threshold && d > 0.001) {
            segs.push({x1:p.x,y1:p.y,x2:q.x,y2:q.y,color:p.color,layer:p.layer,id:Math.random()});
          }
        });
      }
      const bk = `${bx}_${by}`;
      if (!bucket[bk]) bucket[bk] = [];
      bucket[bk].push(idx);
    });
  });
  return segs;
}

function getBounds(segments, symbols=[]) {
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

const SYMBOL_TYPES = [
  {id:'door',  icon:'🚪', label:'Porte'},
  {id:'window',icon:'⬜', label:'Fenêtre'},
  {id:'stair', icon:'🪜', label:'Escalier'},
  {id:'wc',    icon:'🚽', label:'WC'},
  {id:'text',  icon:'T',  label:'Texte'},
];

const TOOL_LIST = [
  {id:'pan',    icon:'✋', label:'Déplacer'},
  {id:'select', icon:'↖',  label:'Sélectionner / Supprimer'},
  {id:'line',   icon:'╱',  label:'Tracer une ligne'},
  {id:'door',   icon:'🚪', label:'Ajouter une porte'},
  {id:'window', icon:'⬜', label:'Ajouter une fenêtre'},
  {id:'text',   icon:'T',  label:'Ajouter un texte'},
  {id:'measure',icon:'📏', label:'Mesurer'},
];

// ─── ERROR BOUNDARY pour PlanEditor ─────────────────────────────────────────
class PlanEditorErrorBoundary extends React.Component {
  constructor(props) { super(props); this.state = { hasError: false, error: null }; }
  static getDerivedStateFromError(error) { return { hasError: true, error }; }
  componentDidCatch(error, info) { console.error('PlanEditor crash:', error, info); }
  render() {
    if (this.state.hasError) {
      return (
        <div style={{flex:1,display:'flex',flexDirection:'column',alignItems:'center',justifyContent:'center',
          background:'#12151f',color:'#e8eaf0',padding:40,gap:16}}>
          <div style={{fontSize:48}}>⚠️</div>
          <div style={{fontSize:20,fontWeight:700}}>Une erreur est survenue dans l'éditeur</div>
          <div style={{fontSize:14,color:'#5b6a8a',maxWidth:400,textAlign:'center'}}>
            {this.state.error?.message || 'Erreur inconnue'}
          </div>
          <button onClick={this.props.onClose} style={{background:'#5b8af5',color:'#fff',border:'none',
            borderRadius:10,padding:'12px 28px',fontSize:15,fontWeight:700,cursor:'pointer',marginTop:8}}>
            ← Retour à la liste
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

// ─── COULEURS LIGNES ──────────────────────────────────────────────────────────
const LINE_COLORS = [
  { label:'Blanc',    value:'#e8eaf0' },
  { label:'Bleu',     value:'#5b8af5' },
  { label:'Rouge',    value:'#e05c5c' },
  { label:'Vert',     value:'#50c878' },
  { label:'Jaune',    value:'#FFC200' },
  { label:'Orange',   value:'#f5a623' },
  { label:'Violet',   value:'#b060ff' },
  { label:'Cyan',     value:'#40d0e0' },
  { label:'Rose',     value:'#ff80c0' },
  { label:'Gris',     value:'#7090c0' },
];

const SURFACE_COLORS = [
  { label:'Bleu clair',  value:'#3b82f6', alpha:0.15 },
  { label:'Vert',        value:'#22c55e', alpha:0.15 },
  { label:'Jaune',       value:'#eab308', alpha:0.15 },
  { label:'Orange',      value:'#f97316', alpha:0.15 },
  { label:'Rouge',       value:'#ef4444', alpha:0.15 },
  { label:'Violet',      value:'#a855f7', alpha:0.15 },
  { label:'Rose',        value:'#ec4899', alpha:0.15 },
  { label:'Cyan',        value:'#06b6d4', alpha:0.15 },
  { label:'Gris',        value:'#94a3b8', alpha:0.15 },
];

function calcSurface(pts) {
  let s = 0;
  const n = pts.length;
  for (let i=0; i<n; i++) {
    const j = (i+1)%n;
    s += pts[i].x * pts[j].y;
    s -= pts[j].x * pts[i].y;
  }
  return Math.abs(s/2);
}

// ─── BIBLIOTHÈQUE DXF ────────────────────────────────────────────────────────
const DXF_LIBRARY = [
  // ── SANITAIRES ──────────────────────────────────────────────────────────────
  { id:'receveur_90x90', name:'Receveur douche 90×90 cm', icon:'🚿', category:'Sanitaires',
    segments:[
      // Bordure extérieure 0.90×0.90
      {x1:0,y1:0,x2:0.9,y2:0},{x1:0.9,y1:0,x2:0.9,y2:0.9},{x1:0.9,y1:0.9,x2:0,y2:0.9},{x1:0,y1:0.9,x2:0,y2:0},
      // Rebord intérieur 3 cm
      {x1:0.03,y1:0.03,x2:0.87,y2:0.03},{x1:0.87,y1:0.03,x2:0.87,y2:0.87},{x1:0.87,y1:0.87,x2:0.03,y2:0.87},{x1:0.03,y1:0.87,x2:0.03,y2:0.03},
      // Bonde centrale (croix)
      {x1:0.42,y1:0.45,x2:0.48,y2:0.45},{x1:0.45,y1:0.42,x2:0.45,y2:0.48},
    ]},

  { id:'receveur_80x80', name:'Receveur douche 80×80 cm', icon:'🚿', category:'Sanitaires',
    segments:[
      // Bordure extérieure 0.80×0.80
      {x1:0,y1:0,x2:0.8,y2:0},{x1:0.8,y1:0,x2:0.8,y2:0.8},{x1:0.8,y1:0.8,x2:0,y2:0.8},{x1:0,y1:0.8,x2:0,y2:0},
      // Rebord intérieur 3 cm
      {x1:0.03,y1:0.03,x2:0.77,y2:0.03},{x1:0.77,y1:0.03,x2:0.77,y2:0.77},{x1:0.77,y1:0.77,x2:0.03,y2:0.77},{x1:0.03,y1:0.77,x2:0.03,y2:0.03},
      // Bonde centrale
      {x1:0.37,y1:0.40,x2:0.43,y2:0.40},{x1:0.40,y1:0.37,x2:0.40,y2:0.43},
    ]},

  { id:'wc_365x60', name:'WC 36.5×60 cm', icon:'🚽', category:'Sanitaires',
    segments:[
      // Réservoir (partie haute) : 36.5 cm large × 15 cm haut
      {x1:0,y1:0,x2:0.365,y2:0},{x1:0.365,y1:0,x2:0.365,y2:0.15},{x1:0.365,y1:0.15,x2:0,y2:0.15},{x1:0,y1:0.15,x2:0,y2:0},
      // Intérieur réservoir
      {x1:0.02,y1:0.02,x2:0.345,y2:0.02},{x1:0.345,y1:0.02,x2:0.345,y2:0.13},{x1:0.345,y1:0.13,x2:0.02,y2:0.13},{x1:0.02,y1:0.13,x2:0.02,y2:0.02},
      // Cuvette : 36.5 cm large × 45 cm profond (total 60 cm)
      {x1:0,y1:0.15,x2:0.365,y2:0.15},
      {x1:0,y1:0.15,x2:0,y2:0.60},{x1:0.365,y1:0.15,x2:0.365,y2:0.60},
      // Avant arrondi (simplifié)
      {x1:0,y1:0.60,x2:0.18,y2:0.63},{x1:0.18,y1:0.63,x2:0.365,y2:0.60},
      // Contour intérieur cuvette
      {x1:0.03,y1:0.18,x2:0.335,y2:0.18},{x1:0.335,y1:0.18,x2:0.335,y2:0.55},{x1:0.335,y1:0.55,x2:0.18,y2:0.60},{x1:0.18,y1:0.60,x2:0.03,y2:0.55},{x1:0.03,y1:0.55,x2:0.03,y2:0.18},
      // Bouton chasse (centre réservoir)
      {x1:0.155,y1:0.06,x2:0.21,y2:0.06},{x1:0.21,y1:0.06,x2:0.21,y2:0.10},{x1:0.21,y1:0.10,x2:0.155,y2:0.10},{x1:0.155,y1:0.10,x2:0.155,y2:0.06},
    ]},

  { id:'vasque_25x35', name:'Vasque à poser 25×35 cm', icon:'🪣', category:'Sanitaires',
    segments:[
      // Contour extérieur 0.25×0.35
      {x1:0,y1:0,x2:0.25,y2:0},{x1:0.25,y1:0,x2:0.25,y2:0.35},{x1:0.25,y1:0.35,x2:0,y2:0.35},{x1:0,y1:0.35,x2:0,y2:0},
      // Rebord intérieur 2 cm
      {x1:0.02,y1:0.02,x2:0.23,y2:0.02},{x1:0.23,y1:0.02,x2:0.23,y2:0.33},{x1:0.23,y1:0.33,x2:0.02,y2:0.33},{x1:0.02,y1:0.33,x2:0.02,y2:0.02},
      // Bonde (centre)
      {x1:0.11,y1:0.165,x2:0.14,y2:0.165},{x1:0.125,y1:0.15,x2:0.125,y2:0.18},
    ]},

  { id:'lavabo', name:'Lavabo 60×50 cm', icon:'🪣', category:'Sanitaires',
    segments:[
      {x1:0,y1:0,x2:0.6,y2:0},{x1:0.6,y1:0,x2:0.6,y2:0.5},{x1:0.6,y1:0.5,x2:0,y2:0.5},{x1:0,y1:0.5,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:0.55,y2:0.05},{x1:0.55,y1:0.05,x2:0.55,y2:0.45},{x1:0.55,y1:0.45,x2:0.05,y2:0.45},{x1:0.05,y1:0.45,x2:0.05,y2:0.05},
      {x1:0.27,y1:0.18,x2:0.33,y2:0.18},{x1:0.33,y1:0.18,x2:0.33,y2:0.32},{x1:0.33,y1:0.32,x2:0.27,y2:0.32},{x1:0.27,y1:0.32,x2:0.27,y2:0.18},
    ]},

  { id:'baignoire', name:'Baignoire 170×75 cm', icon:'🛁', category:'Sanitaires',
    segments:[
      {x1:0,y1:0,x2:1.7,y2:0},{x1:1.7,y1:0,x2:1.7,y2:0.75},{x1:1.7,y1:0.75,x2:0,y2:0.75},{x1:0,y1:0.75,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:1.65,y2:0.05},{x1:1.65,y1:0.05,x2:1.65,y2:0.7},{x1:1.65,y1:0.7,x2:0.05,y2:0.7},{x1:0.05,y1:0.7,x2:0.05,y2:0.05},
      {x1:1.45,y1:0.25,x2:1.6,y2:0.25},{x1:1.6,y1:0.25,x2:1.6,y2:0.5},{x1:1.6,y1:0.5,x2:1.45,y2:0.5},{x1:1.45,y1:0.5,x2:1.45,y2:0.25},
    ]},

  { id:'douche_italienne', name:'Douche italienne 120×90 cm', icon:'🚿', category:'Sanitaires',
    segments:[
      {x1:0,y1:0,x2:1.2,y2:0},{x1:1.2,y1:0,x2:1.2,y2:0.9},{x1:1.2,y1:0.9,x2:0,y2:0.9},{x1:0,y1:0.9,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:1.15,y2:0.05},{x1:1.15,y1:0.05,x2:1.15,y2:0.85},{x1:1.15,y1:0.85,x2:0.05,y2:0.85},{x1:0.05,y1:0.85,x2:0.05,y2:0.05},
      {x1:0.9,y1:0.1,x2:1.1,y2:0.1},{x1:1.1,y1:0.1,x2:1.1,y2:0.4},{x1:1.1,y1:0.4,x2:0.9,y2:0.4},{x1:0.9,y1:0.4,x2:0.9,y2:0.1},
    ]},

  { id:'evier_2bacs', name:'Évier 2 bacs 120×60 cm', icon:'🪣', category:'Sanitaires',
    segments:[
      {x1:0,y1:0,x2:1.2,y2:0},{x1:1.2,y1:0,x2:1.2,y2:0.6},{x1:1.2,y1:0.6,x2:0,y2:0.6},{x1:0,y1:0.6,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:0.57,y2:0.05},{x1:0.57,y1:0.05,x2:0.57,y2:0.55},{x1:0.57,y1:0.55,x2:0.05,y2:0.55},{x1:0.05,y1:0.55,x2:0.05,y2:0.05},
      {x1:0.63,y1:0.05,x2:1.15,y2:0.05},{x1:1.15,y1:0.05,x2:1.15,y2:0.55},{x1:1.15,y1:0.55,x2:0.63,y2:0.55},{x1:0.63,y1:0.55,x2:0.63,y2:0.05},
      {x1:0.59,y1:0.25,x2:0.61,y2:0.25},
    ]},

  // ── OUVERTURES ──────────────────────────────────────────────────────────────
  { id:'porte_simple', name:'Porte simple 90 cm', icon:'🚪', category:'Ouvertures',
    segments:[
      {x1:0,y1:0,x2:0.9,y2:0},{x1:0,y1:0,x2:0,y2:0.9},
    ]},

  { id:'porte_double', name:'Porte double 140 cm', icon:'🚪', category:'Ouvertures',
    segments:[
      {x1:0,y1:0,x2:1.4,y2:0},
      {x1:0,y1:0,x2:0,y2:0.7},
      {x1:1.4,y1:0,x2:1.4,y2:0.7},
    ]},

  { id:'porte_coulissante', name:'Porte coulissante 90 cm', icon:'🚪', category:'Ouvertures',
    segments:[
      {x1:0,y1:0,x2:0.9,y2:0},{x1:0,y1:0,x2:0,y2:0.1},{x1:0.9,y1:0,x2:0.9,y2:0.1},
      {x1:0.05,y1:0.02,x2:0.85,y2:0.02},{x1:0.05,y1:0.08,x2:0.85,y2:0.08},
    ]},

  { id:'fenetre_std', name:'Fenêtre standard 120 cm', icon:'⬜', category:'Ouvertures',
    segments:[
      {x1:0,y1:0,x2:1.2,y2:0},
      {x1:0,y1:-0.1,x2:1.2,y2:-0.1},
      {x1:0,y1:0,x2:0,y2:-0.1},
      {x1:1.2,y1:0,x2:1.2,y2:-0.1},
      {x1:0.6,y1:0,x2:0.6,y2:-0.1},
    ]},

  { id:'fenetre_angle', name:'Fenêtre en angle 90+90 cm', icon:'⬜', category:'Ouvertures',
    segments:[
      {x1:0,y1:0,x2:0.9,y2:0},{x1:0,y1:-0.1,x2:0.9,y2:-0.1},{x1:0,y1:0,x2:0,y2:-0.1},{x1:0.9,y1:0,x2:0.9,y2:-0.1},
      {x1:0.9,y1:0,x2:0.9,y2:-0.9},{x1:1.0,y1:0,x2:1.0,y2:-0.9},{x1:0.9,y1:0,x2:1.0,y2:0},{x1:0.9,y1:-0.9,x2:1.0,y2:-0.9},
    ]},

  // ── STRUCTURE ───────────────────────────────────────────────────────────────
  { id:'escalier', name:'Escalier 12 marches (1m × 2m)', icon:'🪜', category:'Structure',
    segments: Array.from({length:12},(_,i)=>[
      {x1:0,y1:i*0.17,x2:1,y2:i*0.17},
    ]).flat().concat([{x1:0,y1:0,x2:0,y2:2},{x1:1,y1:0,x2:1,y2:2},{x1:0,y1:2,x2:1,y2:2}])},

  // ── MOBILIER ────────────────────────────────────────────────────────────────
  { id:'cuisine_180x60', name:'Cuisine droite 180×60 cm', icon:'🍳', category:'Mobilier',
    segments:[
      // Plan de travail extérieur : 1.80 m × 0.60 m
      {x1:0,y1:0,x2:1.8,y2:0},{x1:1.8,y1:0,x2:1.8,y2:0.6},{x1:1.8,y1:0.6,x2:0,y2:0.6},{x1:0,y1:0.6,x2:0,y2:0},
      // Façade avant (épaisseur de porte 4 cm)
      {x1:0,y1:0.04,x2:1.8,y2:0.04},
      // Séparations de caissons (3 caissons de 60 cm)
      {x1:0.60,y1:0.04,x2:0.60,y2:0.6},
      {x1:1.20,y1:0.04,x2:1.20,y2:0.6},
      // Évier intégré (caisson de droite, centré)
      {x1:1.27,y1:0.07,x2:1.73,y2:0.07},{x1:1.73,y1:0.07,x2:1.73,y2:0.50},{x1:1.73,y1:0.50,x2:1.27,y2:0.50},{x1:1.27,y1:0.50,x2:1.27,y2:0.07},
      {x1:1.28,y1:0.08,x2:1.50,y2:0.08},{x1:1.50,y1:0.08,x2:1.50,y2:0.49},{x1:1.50,y1:0.49,x2:1.28,y2:0.49},{x1:1.28,y1:0.49,x2:1.28,y2:0.08},
      {x1:1.51,y1:0.08,x2:1.72,y2:0.08},{x1:1.72,y1:0.08,x2:1.72,y2:0.49},{x1:1.72,y1:0.49,x2:1.51,y2:0.49},{x1:1.51,y1:0.49,x2:1.51,y2:0.08},
      // Robinet évier
      {x1:1.495,y1:0.22,x2:1.505,y2:0.22},{x1:1.50,y1:0.10,x2:1.50,y2:0.22},
      // Plaque de cuisson (caisson central)
      {x1:0.68,y1:0.10,x2:1.12,y2:0.10},{x1:1.12,y1:0.10,x2:1.12,y2:0.50},{x1:1.12,y1:0.50,x2:0.68,y2:0.50},{x1:0.68,y1:0.50,x2:0.68,y2:0.10},
      // 4 feux
      {x1:0.75,y1:0.20,x2:0.83,y2:0.20},{x1:0.83,y1:0.20,x2:0.83,y2:0.30},{x1:0.83,y1:0.30,x2:0.75,y2:0.30},{x1:0.75,y1:0.30,x2:0.75,y2:0.20},
      {x1:0.97,y1:0.20,x2:1.05,y2:0.20},{x1:1.05,y1:0.20,x2:1.05,y2:0.30},{x1:1.05,y1:0.30,x2:0.97,y2:0.30},{x1:0.97,y1:0.30,x2:0.97,y2:0.20},
      {x1:0.75,y1:0.36,x2:0.83,y2:0.36},{x1:0.83,y1:0.36,x2:0.83,y2:0.46},{x1:0.83,y1:0.46,x2:0.75,y2:0.46},{x1:0.75,y1:0.46,x2:0.75,y2:0.36},
      {x1:0.97,y1:0.36,x2:1.05,y2:0.36},{x1:1.05,y1:0.36,x2:1.05,y2:0.46},{x1:1.05,y1:0.46,x2:0.97,y2:0.46},{x1:0.97,y1:0.46,x2:0.97,y2:0.36},
    ]},

  { id:'cuisine_L', name:'Cuisine en L (300×240 cm)', icon:'🍳', category:'Mobilier',
    segments:[
      {x1:0,y1:0,x2:3,y2:0},{x1:3,y1:0,x2:3,y2:0.6},{x1:3,y1:0.6,x2:0,y2:0.6},{x1:0,y1:0.6,x2:0,y2:0},
      {x1:0,y1:0.6,x2:0,y2:2.4},{x1:0,y1:2.4,x2:0.6,y2:2.4},{x1:0.6,y1:2.4,x2:0.6,y2:0.6},
      {x1:0.5,y1:0.1,x2:2.5,y2:0.1},{x1:2.5,y1:0.1,x2:2.5,y2:0.5},{x1:2.5,y1:0.5,x2:0.5,y2:0.5},{x1:0.5,y1:0.5,x2:0.5,y2:0.1},
    ]},

  { id:'lit_2p', name:'Lit 2 personnes 160×200 cm', icon:'🛏', category:'Mobilier',
    segments:[
      {x1:0,y1:0,x2:1.6,y2:0},{x1:1.6,y1:0,x2:1.6,y2:2},{x1:1.6,y1:2,x2:0,y2:2},{x1:0,y1:2,x2:0,y2:0},
      {x1:0,y1:1.7,x2:1.6,y2:1.7},
      {x1:0.1,y1:1.75,x2:0.75,y2:1.75},{x1:0.75,y1:1.75,x2:0.75,y2:1.95},{x1:0.75,y1:1.95,x2:0.1,y2:1.95},{x1:0.1,y1:1.95,x2:0.1,y2:1.75},
      {x1:0.85,y1:1.75,x2:1.5,y2:1.75},{x1:1.5,y1:1.75,x2:1.5,y2:1.95},{x1:1.5,y1:1.95,x2:0.85,y2:1.95},{x1:0.85,y1:1.95,x2:0.85,y2:1.75},
    ]},

  { id:'lit_1p', name:'Lit 1 personne 90×200 cm', icon:'🛏', category:'Mobilier',
    segments:[
      {x1:0,y1:0,x2:0.9,y2:0},{x1:0.9,y1:0,x2:0.9,y2:2},{x1:0.9,y1:2,x2:0,y2:2},{x1:0,y1:2,x2:0,y2:0},
      {x1:0,y1:1.7,x2:0.9,y2:1.7},
      {x1:0.1,y1:1.75,x2:0.8,y2:1.75},{x1:0.8,y1:1.75,x2:0.8,y2:1.95},{x1:0.8,y1:1.95,x2:0.1,y2:1.95},{x1:0.1,y1:1.95,x2:0.1,y2:1.75},
    ]},

  { id:'table_rect', name:'Table rectangulaire 160×90 cm', icon:'🪑', category:'Mobilier',
    segments:[
      {x1:0,y1:0,x2:1.6,y2:0},{x1:1.6,y1:0,x2:1.6,y2:0.9},{x1:1.6,y1:0.9,x2:0,y2:0.9},{x1:0,y1:0.9,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:1.55,y2:0.05},{x1:1.55,y1:0.05,x2:1.55,y2:0.85},{x1:1.55,y1:0.85,x2:0.05,y2:0.85},{x1:0.05,y1:0.85,x2:0.05,y2:0.05},
    ]},

  // ── ÉQUIPEMENTS GÉNÉRAUX ─────────────────────────────────────────────────────
  { id:'radiateur', name:'Radiateur 120×20 cm', icon:'🔥', category:'Équipements généraux',
    segments:[
      {x1:0,y1:0,x2:1.2,y2:0},{x1:1.2,y1:0,x2:1.2,y2:0.2},{x1:1.2,y1:0.2,x2:0,y2:0.2},{x1:0,y1:0.2,x2:0,y2:0},
      ...Array.from({length:7},(_,i)=>[{x1:0.05+i*0.17,y1:0,x2:0.05+i*0.17,y2:0.2}]).flat(),
    ]},

  // ── ÉLECTRICITÉ — COMMANDES ──────────────────────────────────────────────────
  // Tous les symboles élec sont centrés sur (0,0), rayon ~0.15 m (15 cm)
  // Convention NF C 15-100 simplifiée pour plans d'architecte

  { id:'elec_interrupteur_simple', name:'Interrupteur simple', icon:'💡', category:'Électricité',
    segments:[
      // Cercle (octogone approché) Ø 20 cm
      {x1:0.10,y1:0,x2:-0.10,y2:0},{x1:-0.10,y1:0,x2:-0.14,y2:0.07},{x1:-0.14,y1:0.07,x2:-0.14,y2:-0.07},{x1:-0.14,y1:-0.07,x2:-0.10,y2:0},
      // Carré central 10×10 cm
      {x1:-0.05,y1:-0.05,x2:0.05,y2:-0.05},{x1:0.05,y1:-0.05,x2:0.05,y2:0.05},{x1:0.05,y1:0.05,x2:-0.05,y2:0.05},{x1:-0.05,y1:0.05,x2:-0.05,y2:-0.05},
      // Trait sortie murale (vers le haut)
      {x1:0,y1:-0.05,x2:0,y2:-0.20},
      // Ligne de commande (arc simplifié — 2 segments)
      {x1:-0.10,y1:0,x2:0,y2:0.12},{x1:0,y1:0.12,x2:0.10,y2:0},
    ]},

  { id:'elec_interrupteur_double', name:'Interrupteur double', icon:'💡', category:'Électricité',
    segments:[
      // Boîtier 30×12 cm
      {x1:-0.15,y1:-0.06,x2:0.15,y2:-0.06},{x1:0.15,y1:-0.06,x2:0.15,y2:0.06},{x1:0.15,y1:0.06,x2:-0.15,y2:0.06},{x1:-0.15,y1:0.06,x2:-0.15,y2:-0.06},
      // Séparation centrale
      {x1:0,y1:-0.06,x2:0,y2:0.06},
      // 2 traits sortie
      {x1:-0.07,y1:-0.06,x2:-0.07,y2:-0.18},
      {x1:0.07,y1:-0.06,x2:0.07,y2:-0.18},
      // 2 lignes de commande
      {x1:-0.14,y1:0,x2:-0.07,y2:0.10},{x1:-0.07,y1:0.10,x2:0,y2:0},
      {x1:0,y1:0,x2:0.07,y2:0.10},{x1:0.07,y1:0.10,x2:0.14,y2:0},
    ]},

  { id:'elec_va_et_vient', name:'Va-et-vient', icon:'💡', category:'Électricité',
    segments:[
      // Boîtier carré 12×12 cm
      {x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},{x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},
      // Trait sortie
      {x1:0,y1:-0.06,x2:0,y2:-0.18},
      // Ligne de commande avec double flèche (va-et-vient)
      {x1:-0.10,y1:0,x2:0,y2:0.12},{x1:0,y1:0.12,x2:0.10,y2:0},
      // Second trait (deuxième voie)
      {x1:-0.10,y1:0.04,x2:0.10,y2:0.04},
    ]},

  { id:'elec_minuterie', name:'Minuterie / Détecteur', icon:'⏱', category:'Électricité',
    segments:[
      // Cercle Ø 16 cm (octogone)
      {x1:0.08,y1:-0.08,x2:0.08,y2:0.08},{x1:0.08,y1:0.08,x2:-0.08,y2:0.08},{x1:-0.08,y1:0.08,x2:-0.08,y2:-0.08},{x1:-0.08,y1:-0.08,x2:0.08,y2:-0.08},
      // M intérieur (minuterie)
      {x1:-0.04,y1:0.04,x2:-0.04,y2:-0.04},{x1:-0.04,y1:-0.04,x2:0,y2:0.01},{x1:0,y1:0.01,x2:0.04,y2:-0.04},{x1:0.04,y1:-0.04,x2:0.04,y2:0.04},
      // Trait sortie
      {x1:0,y1:-0.08,x2:0,y2:-0.20},
    ]},

  { id:'elec_variateur', name:'Variateur de lumière', icon:'🔆', category:'Électricité',
    segments:[
      // Boîtier carré
      {x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},{x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},
      // Flèche oblique (symbole variateur)
      {x1:-0.04,y1:0.04,x2:0.04,y2:-0.04},
      {x1:0.04,y1:-0.04,x2:0.02,y2:-0.04},{x1:0.04,y1:-0.04,x2:0.04,y2:-0.02},
      // Trait sortie
      {x1:0,y1:-0.06,x2:0,y2:-0.18},
    ]},

  // ── ÉLECTRICITÉ — PRISES ─────────────────────────────────────────────────────

  { id:'elec_prise_2p_t', name:'Prise 2P+T (16A)', icon:'🔌', category:'Électricité',
    segments:[
      // Cercle Ø 16 cm
      {x1:0.08,y1:-0.08,x2:0.08,y2:0.08},{x1:0.08,y1:0.08,x2:-0.08,y2:0.08},{x1:-0.08,y1:0.08,x2:-0.08,y2:-0.08},{x1:-0.08,y1:-0.08,x2:0.08,y2:-0.08},
      // 2 trous phase/neutre
      {x1:-0.03,y1:-0.02,x2:-0.03,y2:0.02},
      {x1:0.03,y1:-0.02,x2:0.03,y2:0.02},
      // Terre (bas)
      {x1:0,y1:0.03,x2:0,y2:0.06},
      // Trait sortie murale
      {x1:0,y1:-0.08,x2:0,y2:-0.18},
    ]},

  { id:'elec_prise_double', name:'Prise double 2P+T', icon:'🔌', category:'Électricité',
    segments:[
      // 2 cercles côte à côte
      {x1:-0.14,y1:-0.07,x2:-0.14,y2:0.07},{x1:-0.14,y1:0.07,x2:-0.02,y2:0.07},{x1:-0.02,y1:0.07,x2:-0.02,y2:-0.07},{x1:-0.02,y1:-0.07,x2:-0.14,y2:-0.07},
      {x1:0.02,y1:-0.07,x2:0.02,y2:0.07},{x1:0.02,y1:0.07,x2:0.14,y2:0.07},{x1:0.14,y1:0.07,x2:0.14,y2:-0.07},{x1:0.14,y1:-0.07,x2:0.02,y2:-0.07},
      // Trous gauche
      {x1:-0.11,y1:-0.02,x2:-0.11,y2:0.02},{x1:-0.07,y1:-0.02,x2:-0.07,y2:0.02},{x1:-0.09,y1:0.02,x2:-0.09,y2:0.05},
      // Trous droite
      {x1:0.05,y1:-0.02,x2:0.05,y2:0.02},{x1:0.09,y1:-0.02,x2:0.09,y2:0.02},{x1:0.07,y1:0.02,x2:0.07,y2:0.05},
      // Trait sortie
      {x1:0,y1:-0.07,x2:0,y2:-0.18},
    ]},

  { id:'elec_prise_20a', name:'Prise 20A (four / lave-linge)', icon:'🔌', category:'Électricité',
    segments:[
      // Cercle large Ø 20 cm
      {x1:0.10,y1:-0.10,x2:0.10,y2:0.10},{x1:0.10,y1:0.10,x2:-0.10,y2:0.10},{x1:-0.10,y1:0.10,x2:-0.10,y2:-0.10},{x1:-0.10,y1:-0.10,x2:0.10,y2:-0.10},
      // Trous + terre
      {x1:-0.04,y1:-0.03,x2:-0.04,y2:0.03},{x1:0.04,y1:-0.03,x2:0.04,y2:0.03},{x1:0,y1:0.04,x2:0,y2:0.08},
      // Double trait (20A)
      {x1:-0.09,y1:-0.09,x2:0.09,y2:0.09},
      // Trait sortie
      {x1:0,y1:-0.10,x2:0,y2:-0.22},
    ]},

  { id:'elec_prise_rj45', name:'Prise RJ45 / Ethernet', icon:'🌐', category:'Électricité',
    segments:[
      // Boîtier rectangulaire 14×10 cm
      {x1:-0.07,y1:-0.05,x2:0.07,y2:-0.05},{x1:0.07,y1:-0.05,x2:0.07,y2:0.05},{x1:0.07,y1:0.05,x2:-0.07,y2:0.05},{x1:-0.07,y1:0.05,x2:-0.07,y2:-0.05},
      // RJ45 simplifié (petit rectangle + traits)
      {x1:-0.04,y1:-0.02,x2:0.04,y2:-0.02},{x1:0.04,y1:-0.02,x2:0.04,y2:0.02},{x1:0.04,y1:0.02,x2:-0.04,y2:0.02},{x1:-0.04,y1:0.02,x2:-0.04,y2:-0.02},
      {x1:-0.02,y1:-0.02,x2:-0.02,y2:0},{x1:0,y1:-0.02,x2:0,y2:0},{x1:0.02,y1:-0.02,x2:0.02,y2:0},
      // Trait sortie
      {x1:0,y1:-0.05,x2:0,y2:-0.18},
    ]},

  { id:'elec_prise_tv', name:'Prise TV / Antenne', icon:'📺', category:'Électricité',
    segments:[
      // Boîtier carré 12×12 cm
      {x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},{x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},
      // Symbole antenne (triangle + mât)
      {x1:0,y1:-0.04,x2:-0.04,y2:0.03},{x1:-0.04,y1:0.03,x2:0.04,y2:0.03},{x1:0.04,y1:0.03,x2:0,y2:-0.04},
      {x1:0,y1:0.03,x2:0,y2:0.05},
      // Trait sortie
      {x1:0,y1:-0.06,x2:0,y2:-0.18},
    ]},

  // ── ÉLECTRICITÉ — ÉCLAIRAGE ──────────────────────────────────────────────────

  { id:'elec_point_lumineux', name:'Point lumineux (plafonnier)', icon:'💡', category:'Électricité',
    segments:[
      // Cercle Ø 16 cm + croix (NF C 15-100)
      {x1:0.08,y1:0,x2:-0.08,y2:0},
      {x1:0,y1:0.08,x2:0,y2:-0.08},
      {x1:0.08,y1:-0.08,x2:0.08,y2:0.08},{x1:0.08,y1:0.08,x2:-0.08,y2:0.08},{x1:-0.08,y1:0.08,x2:-0.08,y2:-0.08},{x1:-0.08,y1:-0.08,x2:0.08,y2:-0.08},
    ]},

  { id:'elec_applique_murale', name:'Applique murale', icon:'💡', category:'Électricité',
    segments:[
      // Demi-cercle côté mur (simplifié = arc 3 segments)
      {x1:-0.08,y1:0,x2:-0.04,y2:-0.07},{x1:-0.04,y1:-0.07,x2:0.04,y2:-0.07},{x1:0.04,y1:-0.07,x2:0.08,y2:0},
      // Ligne murale
      {x1:-0.08,y1:0,x2:0.08,y2:0},
      // Croix centrale (lumineux)
      {x1:0,y1:-0.02,x2:0,y2:-0.06},{x1:-0.03,y1:-0.04,x2:0.03,y2:-0.04},
    ]},

  { id:'elec_spot_encastre', name:'Spot encastré', icon:'💡', category:'Électricité',
    segments:[
      // Cercle extérieur Ø 12 cm
      {x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},{x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},
      // Cercle intérieur Ø 6 cm
      {x1:0.03,y1:-0.03,x2:0.03,y2:0.03},{x1:0.03,y1:0.03,x2:-0.03,y2:0.03},{x1:-0.03,y1:0.03,x2:-0.03,y2:-0.03},{x1:-0.03,y1:-0.03,x2:0.03,y2:-0.03},
    ]},

  { id:'elec_hublot', name:'Hublot extérieur / SDB', icon:'💡', category:'Électricité',
    segments:[
      // Cercle Ø 16 cm
      {x1:0.08,y1:-0.08,x2:0.08,y2:0.08},{x1:0.08,y1:0.08,x2:-0.08,y2:0.08},{x1:-0.08,y1:0.08,x2:-0.08,y2:-0.08},{x1:-0.08,y1:-0.08,x2:0.08,y2:-0.08},
      // Cercle intérieur
      {x1:0.04,y1:-0.04,x2:0.04,y2:0.04},{x1:0.04,y1:0.04,x2:-0.04,y2:0.04},{x1:-0.04,y1:0.04,x2:-0.04,y2:-0.04},{x1:-0.04,y1:-0.04,x2:0.04,y2:-0.04},
      // IP (indice de protection) — trait diagonaux
      {x1:-0.07,y1:-0.07,x2:0.07,y2:0.07},
    ]},

  // ── ÉLECTRICITÉ — TABLEAU & PROTECTION ──────────────────────────────────────

  { id:'tableau_elec', name:'Tableau électrique / TGBT', icon:'⚡', category:'Électricité',
    segments:[
      {x1:0,y1:0,x2:0.5,y2:0},{x1:0.5,y1:0,x2:0.5,y2:0.7},{x1:0.5,y1:0.7,x2:0,y2:0.7},{x1:0,y1:0.7,x2:0,y2:0},
      {x1:0.05,y1:0.05,x2:0.45,y2:0.05},{x1:0.05,y1:0.05,x2:0.05,y2:0.65},{x1:0.05,y1:0.65,x2:0.45,y2:0.65},{x1:0.45,y1:0.65,x2:0.45,y2:0.05},
      {x1:0.10,y1:0.15,x2:0.40,y2:0.15},{x1:0.10,y1:0.25,x2:0.40,y2:0.25},{x1:0.10,y1:0.35,x2:0.40,y2:0.35},
      {x1:0.10,y1:0.45,x2:0.40,y2:0.45},{x1:0.10,y1:0.55,x2:0.40,y2:0.55},
    ]},

  { id:'elec_disjoncteur', name:'Disjoncteur', icon:'⚡', category:'Électricité',
    segments:[
      // Rectangle 8×16 cm
      {x1:-0.04,y1:-0.08,x2:0.04,y2:-0.08},{x1:0.04,y1:-0.08,x2:0.04,y2:0.08},{x1:0.04,y1:0.08,x2:-0.04,y2:0.08},{x1:-0.04,y1:0.08,x2:-0.04,y2:-0.08},
      // Entrée / sortie
      {x1:0,y1:-0.08,x2:0,y2:-0.16},{x1:0,y1:0.08,x2:0,y2:0.16},
      // Symbole coupure (trait oblique)
      {x1:-0.03,y1:-0.04,x2:0.03,y2:0.04},
    ]},

  { id:'elec_differentiel', name:'Interrupteur différentiel 30mA', icon:'⚡', category:'Électricité',
    segments:[
      // Rectangle 10×18 cm
      {x1:-0.05,y1:-0.09,x2:0.05,y2:-0.09},{x1:0.05,y1:-0.09,x2:0.05,y2:0.09},{x1:0.05,y1:0.09,x2:-0.05,y2:0.09},{x1:-0.05,y1:0.09,x2:-0.05,y2:-0.09},
      // Entrée / sortie
      {x1:0,y1:-0.09,x2:0,y2:-0.18},{x1:0,y1:0.09,x2:0,y2:0.18},
      // Trait coupure
      {x1:-0.04,y1:-0.05,x2:0.04,y2:0.05},
      // Double trait différentiel
      {x1:-0.04,y1:-0.02,x2:0.04,y2:-0.02},
    ]},

  { id:'elec_parafoudre', name:'Parafoudre / Parasurtenseur', icon:'⚡', category:'Électricité',
    segments:[
      // Boîtier 8×14 cm
      {x1:-0.04,y1:-0.07,x2:0.04,y2:-0.07},{x1:0.04,y1:-0.07,x2:0.04,y2:0.07},{x1:0.04,y1:0.07,x2:-0.04,y2:0.07},{x1:-0.04,y1:0.07,x2:-0.04,y2:-0.07},
      // Flèche éclair vers la terre
      {x1:0.02,y1:-0.05,x2:-0.02,y2:0},{x1:-0.02,y1:0,x2:0.02,y2:0},{x1:0.02,y1:0,x2:-0.02,y2:0.05},
      // Terre
      {x1:0,y1:0.07,x2:0,y2:0.14},{x1:-0.04,y1:0.14,x2:0.04,y2:0.14},{x1:-0.025,y1:0.17,x2:0.025,y2:0.17},{x1:-0.01,y1:0.20,x2:0.01,y2:0.20},
      {x1:0,y1:-0.07,x2:0,y2:-0.14},
    ]},

  // ── ÉLECTRICITÉ — DÉTECTION & SÉCURITÉ ──────────────────────────────────────

  { id:'elec_detecteur_fumee', name:'Détecteur de fumée', icon:'🔴', category:'Électricité',
    segments:[
      // Cercle Ø 14 cm
      {x1:0.07,y1:-0.07,x2:0.07,y2:0.07},{x1:0.07,y1:0.07,x2:-0.07,y2:0.07},{x1:-0.07,y1:0.07,x2:-0.07,y2:-0.07},{x1:-0.07,y1:-0.07,x2:0.07,y2:-0.07},
      // F intérieur (Fumée)
      {x1:-0.03,y1:-0.04,x2:-0.03,y2:0.04},{x1:-0.03,y1:-0.04,x2:0.03,y2:-0.04},{x1:-0.03,y1:0,x2:0.02,y2:0},
    ]},

  { id:'elec_sonnette', name:'Sonnette / Carillon', icon:'🔔', category:'Électricité',
    segments:[
      // Boîtier carré 12×12 cm
      {x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},{x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},
      // Cloche simplifiée
      {x1:-0.03,y1:-0.03,x2:-0.03,y2:0.01},{x1:-0.03,y1:0.01,x2:0,y2:0.04},{x1:0,y1:0.04,x2:0.03,y2:0.01},{x1:0.03,y1:0.01,x2:0.03,y2:-0.03},
      {x1:-0.04,y1:0.01,x2:0.04,y2:0.01},
      {x1:0,y1:0.04,x2:0,y2:0.05},
      // Trait sortie
      {x1:0,y1:-0.06,x2:0,y2:-0.16},
    ]},

  { id:'elec_alarme_incendie', name:'Déclencheur alarme incendie', icon:'🚨', category:'Électricité',
    segments:[
      // Boîtier rectangulaire 14×10 cm
      {x1:-0.07,y1:-0.05,x2:0.07,y2:-0.05},{x1:0.07,y1:-0.05,x2:0.07,y2:0.05},{x1:0.07,y1:0.05,x2:-0.07,y2:0.05},{x1:-0.07,y1:0.05,x2:-0.07,y2:-0.05},
      // Flèche brisée (déclencheur)
      {x1:-0.04,y1:-0.03,x2:0,y2:0.02},{x1:0,y1:0.02,x2:0.04,y2:-0.03},
      // Trait sortie
      {x1:0,y1:-0.05,x2:0,y2:-0.16},
    ]},

  // ── PLOMBERIE — APPAREILS ────────────────────────────────────────────────────

  { id:'plomb_robinet_simple', name:'Robinet simple (DN15)', icon:'🚰', category:'Plomberie',
    segments:[
      // Corps de robinet (rectangle 8×4 cm)
      {x1:-0.04,y1:-0.02,x2:0.04,y2:-0.02},{x1:0.04,y1:-0.02,x2:0.04,y2:0.02},{x1:0.04,y1:0.02,x2:-0.04,y2:0.02},{x1:-0.04,y1:0.02,x2:-0.04,y2:-0.02},
      // Papillon (symbole robinet NF)
      {x1:-0.04,y1:0,x2:-0.08,y2:-0.04},{x1:-0.04,y1:0,x2:-0.08,y2:0.04},
      {x1:0.04,y1:0,x2:0.08,y2:-0.04},{x1:0.04,y1:0,x2:0.08,y2:0.04},
      // Tige de commande (vers le haut)
      {x1:0,y1:-0.02,x2:0,y2:-0.08},{x1:-0.03,y1:-0.08,x2:0.03,y2:-0.08},
    ]},

  { id:'plomb_robinet_equerre', name:'Robinet équerre / Té', icon:'🚰', category:'Plomberie',
    segments:[
      // Corps horizontal
      {x1:-0.06,y1:-0.015,x2:0,y2:-0.015},{x1:-0.06,y1:0.015,x2:0,y2:0.015},{x1:-0.06,y1:-0.015,x2:-0.06,y2:0.015},
      // Corps vertical
      {x1:-0.015,y1:0,x2:-0.015,y2:0.06},{x1:0.015,y1:0,x2:0.015,y2:0.06},{x1:-0.015,y1:0.06,x2:0.015,y2:0.06},
      // Jonction
      {x1:0,y1:-0.015,x2:0,y2:0.015},{x1:0,y1:0,x2:-0.015,y2:0},
      // Papillon robinet
      {x1:-0.06,y1:0,x2:-0.09,y2:-0.025},{x1:-0.06,y1:0,x2:-0.09,y2:0.025},
    ]},

  { id:'plomb_clapet_anti_retour', name:'Clapet anti-retour', icon:'🚰', category:'Plomberie',
    segments:[
      // Corps 12×4 cm
      {x1:-0.06,y1:-0.02,x2:0.06,y2:-0.02},{x1:0.06,y1:-0.02,x2:0.06,y2:0.02},{x1:0.06,y1:0.02,x2:-0.06,y2:0.02},{x1:-0.06,y1:0.02,x2:-0.06,y2:-0.02},
      // Flèche sens unique
      {x1:-0.04,y1:0,x2:0.02,y2:0},
      {x1:0.02,y1:0,x2:-0.01,y2:-0.02},{x1:0.02,y1:0,x2:-0.01,y2:0.02},
      // Barrière
      {x1:0.02,y1:-0.02,x2:0.02,y2:0.02},
    ]},

  { id:'plomb_vanne_papillon', name:'Vanne papillon', icon:'🔧', category:'Plomberie',
    segments:[
      // Tuyauterie
      {x1:-0.10,y1:0,x2:-0.04,y2:0},{x1:0.04,y1:0,x2:0.10,y2:0},
      // Corps vanne (2 triangles face à face)
      {x1:-0.04,y1:-0.04,x2:-0.04,y2:0.04},{x1:-0.04,y1:-0.04,x2:0.04,y2:0},{x1:-0.04,y1:0.04,x2:0.04,y2:0},
      {x1:0.04,y1:-0.04,x2:0.04,y2:0.04},{x1:0.04,y1:-0.04,x2:-0.04,y2:0},{x1:0.04,y1:0.04,x2:-0.04,y2:0},
      // Tige de commande
      {x1:0,y1:-0.04,x2:0,y2:-0.10},{x1:-0.03,y1:-0.10,x2:0.03,y2:-0.10},
    ]},

  { id:'plomb_siphon', name:'Siphon (bonde de sol)', icon:'🕳', category:'Plomberie',
    segments:[
      // Cercle Ø 10 cm
      {x1:0.05,y1:-0.05,x2:0.05,y2:0.05},{x1:0.05,y1:0.05,x2:-0.05,y2:0.05},{x1:-0.05,y1:0.05,x2:-0.05,y2:-0.05},{x1:-0.05,y1:-0.05,x2:0.05,y2:-0.05},
      // Cercle intérieur (grille)
      {x1:0.025,y1:-0.025,x2:0.025,y2:0.025},{x1:0.025,y1:0.025,x2:-0.025,y2:0.025},{x1:-0.025,y1:0.025,x2:-0.025,y2:-0.025},{x1:-0.025,y1:-0.025,x2:0.025,y2:-0.025},
      // Croix de grille
      {x1:-0.025,y1:0,x2:0.025,y2:0},{x1:0,y1:-0.025,x2:0,y2:0.025},
      // Évacuation (sortie basse)
      {x1:-0.015,y1:0.05,x2:-0.015,y2:0.14},{x1:0.015,y1:0.05,x2:0.015,y2:0.14},{x1:-0.015,y1:0.14,x2:0.015,y2:0.14},
    ]},

  { id:'plomb_compteur_eau', name:'Compteur d'eau', icon:'💧', category:'Plomberie',
    segments:[
      // Boîtier 20×12 cm
      {x1:-0.10,y1:-0.06,x2:0.10,y2:-0.06},{x1:0.10,y1:-0.06,x2:0.10,y2:0.06},{x1:0.10,y1:0.06,x2:-0.10,y2:0.06},{x1:-0.10,y1:0.06,x2:-0.10,y2:-0.06},
      // M (Meter) intérieur
      {x1:-0.05,y1:0.03,x2:-0.05,y2:-0.03},{x1:-0.05,y1:-0.03,x2:0,y2:0.01},{x1:0,y1:0.01,x2:0.05,y2:-0.03},{x1:0.05,y1:-0.03,x2:0.05,y2:0.03},
      // Entrée / sortie tuyau
      {x1:-0.10,y1:0,x2:-0.16,y2:0},{x1:0.10,y1:0,x2:0.16,y2:0},
    ]},

  { id:'plomb_chauffe_eau', name:'Chauffe-eau électrique', icon:'🔥', category:'Plomberie',
    segments:[
      // Cuve cylindrique (rectangle arrondi simplifié) 50×80 cm
      {x1:-0.25,y1:-0.40,x2:0.25,y2:-0.40},{x1:0.25,y1:-0.40,x2:0.25,y2:0.40},{x1:0.25,y1:0.40,x2:-0.25,y2:0.40},{x1:-0.25,y1:0.40,x2:-0.25,y2:-0.40},
      // Calotte haut
      {x1:-0.25,y1:-0.32,x2:0.25,y2:-0.32},
      // Calotte bas
      {x1:-0.25,y1:0.32,x2:0.25,y2:0.32},
      // Départ ECS (haut gauche)
      {x1:-0.15,y1:-0.40,x2:-0.15,y2:-0.52},{x1:-0.20,y1:-0.52,x2:-0.10,y2:-0.52},
      // Arrivée EF (haut droite)
      {x1:0.15,y1:-0.40,x2:0.15,y2:-0.52},{x1:0.10,y1:-0.52,x2:0.20,y2:-0.52},
      // Résistance électrique (bas)
      {x1:-0.10,y1:0.20,x2:0.10,y2:0.20},{x1:-0.10,y1:0.28,x2:0.10,y2:0.28},
      {x1:-0.10,y1:0.20,x2:-0.10,y2:0.28},{x1:0.10,y1:0.20,x2:0.10,y2:0.28},
    ]},

  { id:'plomb_chaudiere', name:'Chaudière gaz / fioul', icon:'🔥', category:'Plomberie',
    segments:[
      // Boîtier 60×60 cm
      {x1:-0.30,y1:-0.30,x2:0.30,y2:-0.30},{x1:0.30,y1:-0.30,x2:0.30,y2:0.30},{x1:0.30,y1:0.30,x2:-0.30,y2:0.30},{x1:-0.30,y1:0.30,x2:-0.30,y2:-0.30},
      // Brûleur (bas)
      {x1:-0.15,y1:0.18,x2:0.15,y2:0.18},{x1:-0.15,y1:0.24,x2:0.15,y2:0.24},{x1:-0.15,y1:0.18,x2:-0.15,y2:0.24},{x1:0.15,y1:0.18,x2:0.15,y2:0.24},
      // Échangeur (lignes horizontales)
      {x1:-0.20,y1:-0.10,x2:0.20,y2:-0.10},{x1:-0.20,y1:-0.02,x2:0.20,y2:-0.02},{x1:-0.20,y1:0.06,x2:0.20,y2:0.06},
      // Départ chauffage (gauche)
      {x1:-0.30,y1:-0.15,x2:-0.40,y2:-0.15},
      // Retour chauffage (droite)
      {x1:0.30,y1:-0.15,x2:0.40,y2:-0.15},
      // Alimentation gaz (bas)
      {x1:0,y1:0.30,x2:0,y2:0.40},
    ]},

  // ── PLOMBERIE — RÉSEAUX & SYMBOLES ──────────────────────────────────────────

  { id:'plomb_colonne_chute', name:'Colonne de chute (EU/EV)', icon:'⬇', category:'Plomberie',
    segments:[
      // Cercle Ø 16 cm (section de tuyau)
      {x1:0.08,y1:-0.08,x2:0.08,y2:0.08},{x1:0.08,y1:0.08,x2:-0.08,y2:0.08},{x1:-0.08,y1:0.08,x2:-0.08,y2:-0.08},{x1:-0.08,y1:-0.08,x2:0.08,y2:-0.08},
      // Croix intérieure
      {x1:-0.08,y1:0,x2:0.08,y2:0},{x1:0,y1:-0.08,x2:0,y2:0.08},
    ]},

  { id:'plomb_tuyau_ep', name:'Tuyau EP (eaux pluviales)', icon:'🌧', category:'Plomberie',
    segments:[
      // Cercle Ø 12 cm
      {x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},{x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},
      // EP intérieur (2 traits)
      {x1:-0.03,y1:-0.03,x2:-0.03,y2:0.03},{x1:-0.03,y1:-0.03,x2:0.03,y2:-0.03},
    ]},

  { id:'plomb_regard', name:'Regard / Boîte de branchement', icon:'🔲', category:'Plomberie',
    segments:[
      // Carré 30×30 cm
      {x1:-0.15,y1:-0.15,x2:0.15,y2:-0.15},{x1:0.15,y1:-0.15,x2:0.15,y2:0.15},{x1:0.15,y1:0.15,x2:-0.15,y2:0.15},{x1:-0.15,y1:0.15,x2:-0.15,y2:-0.15},
      // Diagonales (couvercle)
      {x1:-0.15,y1:-0.15,x2:0.15,y2:0.15},{x1:0.15,y1:-0.15,x2:-0.15,y2:0.15},
    ]},

  { id:'plomb_pompe_circulateur', name:'Pompe / Circulateur', icon:'🔄', category:'Plomberie',
    segments:[
      // Tuyauteries
      {x1:-0.12,y1:0,x2:-0.06,y2:0},{x1:0.06,y1:0,x2:0.12,y2:0},
      // Corps pompe (cercle)
      {x1:0.06,y1:-0.06,x2:0.06,y2:0.06},{x1:0.06,y1:0.06,x2:-0.06,y2:0.06},{x1:-0.06,y1:0.06,x2:-0.06,y2:-0.06},{x1:-0.06,y1:-0.06,x2:0.06,y2:-0.06},
      // Flèche rotatif intérieur
      {x1:-0.03,y1:0.03,x2:0.03,y2:-0.03},
      {x1:0.03,y1:-0.03,x2:0.01,y2:-0.03},{x1:0.03,y1:-0.03,x2:0.03,y2:-0.01},
      // Moteur (trait haut)
      {x1:0,y1:-0.06,x2:0,y2:-0.12},
    ]},

  { id:'plomb_nourrice', name:'Nourrice / Collecteur', icon:'🔧', category:'Plomberie',
    segments:[
      // Corps principal 60×8 cm
      {x1:-0.30,y1:-0.04,x2:0.30,y2:-0.04},{x1:0.30,y1:-0.04,x2:0.30,y2:0.04},{x1:0.30,y1:0.04,x2:-0.30,y2:0.04},{x1:-0.30,y1:0.04,x2:-0.30,y2:-0.04},
      // 4 départs (bas)
      {x1:-0.20,y1:0.04,x2:-0.20,y2:0.14},{x1:-0.07,y1:0.04,x2:-0.07,y2:0.14},
      {x1:0.07,y1:0.04,x2:0.07,y2:0.14},{x1:0.20,y1:0.04,x2:0.20,y2:0.14},
      // Arrivée (gauche)
      {x1:-0.30,y1:0,x2:-0.40,y2:0},
    ]},

  { id:'plomb_vase_expansion', name:'Vase d'expansion', icon:'⭕', category:'Plomberie',
    segments:[
      // Cercle Ø 20 cm
      {x1:0.10,y1:-0.10,x2:0.10,y2:0.10},{x1:0.10,y1:0.10,x2:-0.10,y2:0.10},{x1:-0.10,y1:0.10,x2:-0.10,y2:-0.10},{x1:-0.10,y1:-0.10,x2:0.10,y2:-0.10},
      // Ligne horizontale médiane (membrane)
      {x1:-0.10,y1:0,x2:0.10,y2:0},
      // Hachures zone gaz (haut)
      {x1:-0.07,y1:-0.07,x2:0.07,y2:-0.07},{x1:-0.09,y1:-0.04,x2:0.09,y2:-0.04},
      // Raccord bas
      {x1:0,y1:0.10,x2:0,y2:0.18},
    ]},
];

// ─── PLAN EDITOR ──────────────────────────────────────────────────────────────
function PlanEditor({plan, onSave, onClose, T, chantiers}) {
  const canvasRef = useRef(null);
  const [segments,  setSegments]  = useState(plan.data?.segments || []);
  const [symbols,   setSymbols]   = useState(plan.data?.symbols  || []);
  const [cotes,     setCotes]     = useState(plan.data?.cotes    || []);
  const [surfaces,  setSurfaces]  = useState(plan.data?.surfaces || []);
  const [surfaceColor, setSurfaceColor] = useState('#3b82f6');
  const [polyPoints, setPolyPoints]     = useState([]);

  const historyRef = useRef([]);
  const futureRef  = useRef([]);
  const [historyLen, setHistoryLen] = useState(0);
  const [futureLen,  setFutureLen]  = useState(0);

  const pushHistory = useCallback((segs, syms, cots) => {
    historyRef.current = [...historyRef.current.slice(-29), { segments:segs, symbols:syms, cotes:cots, surfaces: Array.isArray(surfacesRef.current) ? [...surfacesRef.current] : [] }];
    futureRef.current  = [];
    setHistoryLen(historyRef.current.length);
    setFutureLen(0);
  }, []);

  const undo = useCallback(() => {
    if (!historyRef.current.length) return;
    const prev = historyRef.current[historyRef.current.length-1];
    setSegments(cur => { setSymbols(cs => { setCotes(cc => {
      futureRef.current = [{ segments:cur, symbols:cs, cotes:cc, surfaces:surfacesRef.current }, ...futureRef.current.slice(0,29)];
      setFutureLen(futureRef.current.length);
      if(prev.surfaces) setSurfaces(prev.surfaces);
      return prev.cotes;
    }); return prev.symbols; }); return prev.segments; });
    historyRef.current = historyRef.current.slice(0,-1);
    setHistoryLen(historyRef.current.length);
  }, []);

  const redo = useCallback(() => {
    if (!futureRef.current.length) return;
    const next = futureRef.current[0];
    setSegments(cur => { setSymbols(cs => { setCotes(cc => {
      historyRef.current = [...historyRef.current, { segments:cur, symbols:cs, cotes:cc, surfaces:surfacesRef.current }];
      setHistoryLen(historyRef.current.length);
      if(next.surfaces) setSurfaces(next.surfaces);
      return next.cotes;
    }); return next.symbols; }); return next.segments; });
    futureRef.current = futureRef.current.slice(1);
    setFutureLen(futureRef.current.length);
  }, []);

  const [vp, setVp] = useState(plan.data?.viewport || {x:0,y:0,scale:1});
  const [tool, setTool]             = useState('pan');
  const [lineColor, setLineColor]   = useState('#e8eaf0');
  const [lineStart, setLineStart]   = useState(null);
  const [mousePos, setMousePos]     = useState(null);
  const [saving, setSaving]         = useState(false);
  const [measurePts, setMeasurePts] = useState([]);
  const [measureDist, setMeasureDist] = useState(null);
  const [threshold, setThreshold]   = useState(plan.data?.threshold || 0.5);
  const [showThreshold, setShowThreshold] = useState(false);
  const [showHelp, setShowHelp]     = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [orthoMode, setOrthoMode]   = useState(false);
  const [rectSel, setRectSel]       = useState(null);
  const clipboardRef = useRef(null);
  const [printMode, setPrintMode] = useState(false);
  const printModeRef = useRef(false);
  const [coteFontSize, setCoteFontSize] = useState(12);
  const coteFontRef = useRef(12);
  const [showLibrary, setShowLibrary] = useState(false);
  const [autoClose, setAutoClose] = useState(true);
  const autoCloseRef = useRef(true);
  const movingSelRef = useRef(null);
  const movingCoteRef = useRef(null);
  const [planRotation, setPlanRotation] = useState(plan.data?.planRotation || 0);
  const [layers, setLayers] = useState({ segments:true, points:false, symbols:true, surfaces:true, cotes:true });
  const [symProps, setSymProps] = useState(null);

  const vpRef         = useRef(vp);
  const segmentsRef   = useRef(segments);
  const symbolsRef    = useRef(symbols);
  const cotesRef      = useRef(cotes);
  const surfacesRef   = useRef(surfaces);
  const polyPtsRef    = useRef(polyPoints);
  const surfColorRef  = useRef(surfaceColor);
  const toolRef       = useRef(tool);
  const lineStartRef  = useRef(lineStart);
  const mousePosRef   = useRef(mousePos);
  const selectedRef   = useRef(selectedIds);
  const measurePtsRef = useRef(measurePts);
  const measureDistRef= useRef(measureDist);
  const snapRef       = useRef(snapEnabled);
  const orthoRef      = useRef(orthoMode);
  const rectSelRef    = useRef(rectSel);
  const lineColorRef  = useRef(lineColor);
  const layersRef       = useRef(layers);
  const planRotRef      = useRef(planRotation);

  vpRef.current         = vp;
  segmentsRef.current   = segments;
  symbolsRef.current    = symbols;
  cotesRef.current      = cotes;
  surfacesRef.current   = surfaces;
  polyPtsRef.current    = polyPoints;
  surfColorRef.current  = surfaceColor;
  toolRef.current       = tool;
  lineStartRef.current  = lineStart;
  mousePosRef.current   = mousePos;
  selectedRef.current   = selectedIds;
  measurePtsRef.current = measurePts;
  measureDistRef.current= measureDist;
  snapRef.current       = snapEnabled;
  orthoRef.current      = orthoMode;
  rectSelRef.current    = rectSel;
  lineColorRef.current  = lineColor;
  layersRef.current     = layers;
  planRotRef.current    = planRotation;
  printModeRef.current  = printMode;
  coteFontRef.current   = coteFontSize;
  autoCloseRef.current  = autoClose;

  const toWorld = (cx, cy) => {
    const vp = vpRef.current;
    const rot = planRotRef.current * Math.PI / 180;
    const cosR = Math.cos(-rot), sinR = Math.sin(-rot);
    const W = canvasRef.current ? canvasRef.current.width  : 800;
    const H = canvasRef.current ? canvasRef.current.height : 600;
    const cx0 = W/2, cy0 = H/2;
    const dx = cx - cx0, dy = cy - cy0;
    const rx = cx0 + dx*cosR - dy*sinR;
    const ry = cy0 + dx*sinR + dy*cosR;
    return { wx: rx / vp.scale + vp.x, wy: ry / vp.scale + vp.y };
  };

  const snapToPoint = useCallback((wx, wy) => {
    if (!snapRef.current) return { wx, wy, snapped: false };
    const baseSnap = autoCloseRef.current ? 20 : 8;
    const snapDist = baseSnap / vpRef.current.scale;
    let best = null, bestD = snapDist;
    segmentsRef.current.filter(s=>!s.deleted).forEach(s => {
      [[s.x1,s.y1],[s.x2,s.y2]].forEach(([px,py]) => {
        const d = Math.sqrt((wx-px)**2+(wy-py)**2);
        if (d < bestD) { bestD=d; best={wx:px,wy:py}; }
      });
    });
    return best ? { ...best, snapped:true } : { wx, wy, snapped:false };
  }, []);

  const applyOrtho = (startX, startY, wx, wy) => {
    if (!orthoRef.current || startX==null) return {wx,wy};
    const dx = wx-startX, dy = wy-startY;
    const angle = Math.atan2(dy,dx) * 180/Math.PI;
    const snap45 = Math.round(angle/45)*45;
    const len = Math.sqrt(dx*dx+dy*dy);
    return {
      wx: startX + len*Math.cos(snap45*Math.PI/180),
      wy: startY + len*Math.sin(snap45*Math.PI/180),
    };
  };

  const render = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const W = canvas.width, H = canvas.height;
    if (!W || !H) return;

    try {
      ctx.clearRect(0,0,W,H);
      const isPrint = printModeRef.current;
      ctx.fillStyle = isPrint ? '#ffffff' : '#12151f';
      ctx.fillRect(0,0,W,H);
      const C = {
        seg:    isPrint ? (col) => {
          if (!col || col==='#7090c0' || col==='#c8d0e0') return '#1a1f2e';
          const r=parseInt(col.slice(1,3),16),g=parseInt(col.slice(3,5),16),b=parseInt(col.slice(5,7),16);
          const lum=(r*299+g*587+b*114)/1000;
          return lum>180?'#1a1f2e':col;
        } : (col) => col||'#7090c0',
        cote:   isPrint ? '#333333' : '#f5d08a',
        selC:   isPrint ? '#c05000' : '#f5a623',
        symC:   isPrint ? '#1a1f2e' : '#f5a623',
        symW:   isPrint ? '#1a4080' : '#60a0ff',
        symG:   isPrint ? '#206040' : '#80ff80',
        symA:   isPrint ? '#204060' : '#a0c0ff',
        symT:   isPrint ? '#604000' : '#f5d08a',
        txt:    isPrint ? '#1a1f2e' : '#e8eaf0',
        surfFg: isPrint ? '#333333' : null,
        grid:   isPrint ? 'rgba(0,0,0,0.06)' : 'rgba(255,255,255,0.04)',
      };

      const vp = vpRef.current;
      const rot = planRotRef.current * Math.PI / 180;
      const cosR = Math.cos(rot), sinR = Math.sin(rot);
      const cx0 = W/2, cy0 = H/2;
      const toC = (wx, wy) => {
        const sx = (wx - vp.x) * vp.scale;
        const sy = (wy - vp.y) * vp.scale;
        const dx = sx - cx0, dy = sy - cy0;
        return {
          cx: cx0 + dx*cosR - dy*sinR,
          cy: cy0 + dx*sinR + dy*cosR,
        };
      };
      const lyrs = layersRef.current;

      const gridSize = Math.max(0.1, 1/vp.scale);
      const gStep = gridSize * vp.scale;
      if (!isPrint && gStep > 15 && isFinite(gStep)) {
        ctx.strokeStyle = C.grid;
        ctx.lineWidth = 0.5;
        const ox = (-vp.x % gridSize) * vp.scale;
        const oy = (-vp.y % gridSize) * vp.scale;
        for (let x=ox;x<W;x+=gStep) { ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,H);ctx.stroke(); }
        for (let y=oy;y<H;y+=gStep) { ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(W,y);ctx.stroke(); }
      }

      if (lyrs.surfaces) surfacesRef.current.forEach(surf => {
        if (surf.deleted || surf.points.length < 3) return;
        const pts = surf.points;
        const sel = selectedRef.current.has(surf.id);
        ctx.save();
        ctx.beginPath();
        const {cx:fx,cy:fy}=toC(pts[0].x,pts[0].y);
        ctx.moveTo(fx,fy);
        for(let i=1;i<pts.length;i++){
          const{cx,cy}=toC(pts[i].x,pts[i].y);
          ctx.lineTo(cx,cy);
        }
        ctx.closePath();
        const col = surf.color||'#3b82f6';
        const r=parseInt(col.slice(1,3),16)||59,g=parseInt(col.slice(3,5),16)||130,b=parseInt(col.slice(5,7),16)||246;
        ctx.fillStyle = sel ? 'rgba(245,166,35,0.2)' : `rgba(${r},${g},${b},${surf.alpha||0.15})`;
        ctx.fill();
        ctx.strokeStyle = sel ? C.selC : (isPrint ? (C.surfFg||col) : col);
        ctx.lineWidth = sel ? 2.5 : 1.5;
        ctx.setLineDash([5,3]);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
        const cx_c = pts.reduce((a,p)=>a+p.x,0)/pts.length;
        const cy_c = pts.reduce((a,p)=>a+p.y,0)/pts.length;
        const {cx:lx,cy:ly}=toC(cx_c,cy_c);
        const area = calcSurface(pts);
        const label = area>=1 ? `${area.toFixed(2)} m²` : `${(area*10000).toFixed(0)} cm²`;
        const fontSize = Math.max(10, Math.min(14, vp.scale*0.4));
        ctx.font=`bold ${fontSize}px sans-serif`;
        ctx.textAlign='center';
        const tw=ctx.measureText(label).width+10;
        ctx.fillStyle= isPrint ? 'rgba(245,245,240,0.9)' : 'rgba(18,21,31,0.75)';
        ctx.beginPath();
        if (ctx.roundRect) { ctx.roundRect(lx-tw/2,ly-fontSize-2,tw,fontSize+8,4); }
        else { ctx.rect(lx-tw/2,ly-fontSize-2,tw,fontSize+8); }
        ctx.fill();
        ctx.fillStyle= sel ? C.selC : (isPrint ? '#333' : col);
        ctx.fillText(label,lx,ly+2);
      });

      if (lyrs.points) {
        const ptMap = new Map();
        segmentsRef.current.filter(s=>!s.deleted).forEach(s=>{
          [[s.x1,s.y1],[s.x2,s.y2]].forEach(([px,py])=>{
            const k=`${px.toFixed(4)}_${py.toFixed(4)}`;
            if(!ptMap.has(k)) ptMap.set(k,{x:px,y:py,color:s.color||'#7090c0'});
          });
        });
        ptMap.forEach(p=>{
          const {cx,cy}=toC(p.x,p.y);
          if(!isFinite(cx)||!isFinite(cy)) return;
          const r=Math.min(3, Math.max(1.5, vp.scale*0.015));
          ctx.fillStyle=p.color;
          ctx.beginPath(); ctx.arc(cx,cy,r,0,Math.PI*2); ctx.fill();
        });
      }

      if (lyrs.segments) segmentsRef.current.forEach(s => {
        if (s.deleted) return;
        const {cx:x1,cy:y1}=toC(s.x1,s.y1);
        const {cx:x2,cy:y2}=toC(s.x2,s.y2);
        if (!isFinite(x1)||!isFinite(y1)||!isFinite(x2)||!isFinite(y2)) return;
        const sel = selectedRef.current.has(s.id);
        ctx.strokeStyle = sel ? C.selC : C.seg(s.color);
        ctx.lineWidth   = sel ? 3 : (s.user ? 2 : 1.5);
        if (sel && !isPrint) { ctx.shadowColor='#f5a623'; ctx.shadowBlur=6; }
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(x2,y2); ctx.stroke();
        ctx.shadowBlur=0;
      });

      if (lyrs.cotes) cotesRef.current.forEach(c => {
        if (c.deleted) return;
        const {cx:x1,cy:y1}=toC(c.x1,c.y1);
        const {cx:x2,cy:y2}=toC(c.x2,c.y2);
        if (!isFinite(x1)||!isFinite(y1)||!isFinite(x2)||!isFinite(y2)) return;
        const sel = selectedRef.current.has(c.id);
        const dist = Math.sqrt((c.x2-c.x1)**2+(c.y2-c.y1)**2);
        const label = dist >= 1 ? `${dist.toFixed(2)} m` : `${(dist*100).toFixed(0)} cm`;
        const mx=(x1+x2)/2, my=(y1+y2)/2;
        const angle=Math.atan2(y2-y1,x2-x1);
        const perp=angle-Math.PI/2;
        const offset=(c.offset||0)+24;
        const ox=Math.cos(perp)*offset, oy=Math.sin(perp)*offset;
        ctx.strokeStyle = sel ? C.selC : C.cote;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1+ox,y1+oy); ctx.lineTo(x2+ox,y2+oy); ctx.stroke();
        const aw=10;
        [0,1].forEach(end => {
          const [bx,by] = end===0 ? [x1+ox,y1+oy] : [x2+ox,y2+oy];
          const dir = end===0 ? 1 : -1;
          ctx.beginPath();
          ctx.moveTo(bx,by);
          ctx.lineTo(bx+Math.cos(angle)*aw*dir, by+Math.sin(angle)*aw*dir);
          ctx.stroke();
        });
        [[x1,y1],[x2,y2]].forEach(([px,py]) => {
          ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(px+ox*1.2,py+oy*1.2); ctx.stroke();
        });
        ctx.save();
        ctx.translate(mx+ox, my+oy-8);
        ctx.rotate(Math.abs(angle) > Math.PI/2 ? angle+Math.PI : angle);
        const fs = coteFontRef.current;
        ctx.fillStyle = sel ? C.selC : C.cote;
        ctx.font = `bold ${fs}px sans-serif`;
        ctx.textAlign='center';
        ctx.fillStyle= isPrint ? '#f5f5f0' : '#12151f';
        const tw = ctx.measureText(label).width + 8;
        if (ctx.roundRect) { ctx.roundRect(-tw/2,-fs-2,tw,fs+6,3); } else { ctx.rect(-tw/2,-fs-2,tw,fs+6); }
        ctx.fill();
        ctx.fillStyle = sel ? C.selC : C.cote;
        ctx.fillText(label, 0, 0);
        ctx.restore();
      });

      if (lyrs.symbols) symbolsRef.current.forEach(sym => {
        if (sym.deleted) return;
        const {cx,cy}=toC(sym.x,sym.y);
        if (!isFinite(cx)||!isFinite(cy)) return;
        const sz = Math.max(12, vp.scale*0.6) * (sym.size||1);
        ctx.save();
        ctx.translate(cx,cy);
        ctx.rotate((sym.angle||0)*Math.PI/180);
        if (sym.type==='door') {
          ctx.strokeStyle=C.symC; ctx.lineWidth=2;
          ctx.beginPath(); ctx.moveTo(0,0); ctx.lineTo(sz,0);
          ctx.arc(0,0,sz,0,Math.PI/2); ctx.stroke();
        } else if (sym.type==='window') {
          ctx.strokeStyle=C.symW; ctx.lineWidth=2;
          ctx.strokeRect(-sz/2,-sz/4,sz,sz/2);
          ctx.beginPath(); ctx.moveTo(-sz/2,0); ctx.lineTo(sz/2,0); ctx.stroke();
        } else if (sym.type==='stair') {
          ctx.strokeStyle=C.symG; ctx.lineWidth=1.5;
          for (let k=0;k<4;k++) ctx.strokeRect(-sz/2+k*sz/4,-sz/2,sz/4,sz);
        } else if (sym.type==='wc') {
          ctx.strokeStyle=C.symA; ctx.lineWidth=1.5;
          ctx.beginPath(); ctx.ellipse(0,0,sz/2,sz/3,0,0,Math.PI*2); ctx.stroke();
        }
        if (sym.text && sym.type!=='text') {
          ctx.fillStyle=C.txt; ctx.font=`bold ${Math.max(10,sz*0.5)}px sans-serif`;
          ctx.textAlign='center'; ctx.fillText(sym.text,0,sz+12);
        }
        if (sym.type==='text') {
          ctx.fillStyle=C.symT; ctx.font=`bold ${Math.max(11,sz*0.6)}px sans-serif`;
          ctx.textAlign='center'; ctx.fillText(sym.text||'',0,4);
        }
        if (selectedRef.current.has(sym.id)) {
          ctx.restore();
          const {cx:scx,cy:scy}=toC(sym.x,sym.y);
          const ssz=Math.max(12,vp.scale*0.6);
          ctx.save();
          ctx.strokeStyle='#f5a623'; ctx.lineWidth=1.5; ctx.setLineDash([4,3]);
          ctx.strokeRect(scx-ssz-4,scy-ssz-4,ssz*2+8,ssz*2+8);
          ctx.setLineDash([]);
          ctx.fillStyle='#f5a623';
          ctx.beginPath(); ctx.arc(scx,scy-ssz-14,5,0,Math.PI*2); ctx.fill();
          ctx.strokeStyle='#f5a623'; ctx.lineWidth=1;
          ctx.beginPath(); ctx.moveTo(scx,scy-ssz-4); ctx.lineTo(scx,scy-ssz-10); ctx.stroke();
          ctx.fillStyle='#5b8af5';
          ctx.fillRect(scx+ssz,scy+ssz,8,8);
          ctx.restore();
        } else {
          ctx.restore();
        }
      });

      const ls=lineStartRef.current, mp=mousePosRef.current;
      if (toolRef.current==='line' && ls && mp) {
        let {wx,wy}=toWorld(mp.cx,mp.cy);
        const ortho=applyOrtho(ls.x,ls.y,wx,wy);
        wx=ortho.wx; wy=ortho.wy;
        const snapped=snapToPoint(wx,wy);
        const ex=(snapped.wx-vp.x)*vp.scale, ey=(snapped.wy-vp.y)*vp.scale;
        const sx=(ls.x-vp.x)*vp.scale, sy=(ls.y-vp.y)*vp.scale;
        ctx.strokeStyle=lineColorRef.current; ctx.lineWidth=2; ctx.setLineDash([6,4]);
        ctx.beginPath(); ctx.moveTo(sx,sy); ctx.lineTo(ex,ey); ctx.stroke();
        ctx.setLineDash([]);
        if (snapped.snapped) {
          ctx.strokeStyle='#50c878'; ctx.lineWidth=2;
          ctx.beginPath(); ctx.arc(ex,ey,7,0,Math.PI*2); ctx.stroke();
        }
        ctx.fillStyle='#5b8af5';
        ctx.beginPath(); ctx.arc(sx,sy,4,0,Math.PI*2); ctx.fill();
        const {wx:lwx,wy:lwy}=toWorld(ex,ey);
        const lineDist=Math.sqrt((lwx-ls.x)**2+(lwy-ls.y)**2);
        if(lineDist>0.001){
          const dimLabel=lineDist>=1?`${lineDist.toFixed(3)} m`:`${(lineDist*100).toFixed(1)} cm`;
          const midCx=(sx+ex)/2, midCy=(sy+ey)/2;
          ctx.save();
          ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
          const dw=ctx.measureText(dimLabel).width+10;
          ctx.fillStyle='rgba(91,138,245,0.85)';
          ctx.beginPath(); ctx.roundRect?ctx.roundRect(midCx-dw/2,midCy-22,dw,18,4):ctx.rect(midCx-dw/2,midCy-22,dw,18); ctx.fill();
          ctx.fillStyle='#ffffff';
          ctx.fillText(dimLabel, midCx, midCy-8);
          ctx.restore();
        }
      }

      const mpts=measurePtsRef.current;
      if (toolRef.current==='cote' && mpts.length===1 && mp) {
        const {cx:x1,cy:y1}=toC(mpts[0].x,mpts[0].y);
        ctx.strokeStyle='#f5d08a'; ctx.lineWidth=2; ctx.setLineDash([4,4]);
        ctx.beginPath(); ctx.moveTo(x1,y1); ctx.lineTo(mp.cx,mp.cy); ctx.stroke();
        ctx.setLineDash([]);
        const {wx,wy}=toWorld(mp.cx,mp.cy);
        const d=Math.sqrt((wx-mpts[0].x)**2+(wy-mpts[0].y)**2);
        const dLabel=d>=1?`${d.toFixed(3)} m`:`${(d*100).toFixed(1)} cm`;
        const midCx=(x1+mp.cx)/2, midCy=(y1+mp.cy)/2;
        ctx.save();
        ctx.font='bold 13px sans-serif'; ctx.textAlign='center';
        const dw2=ctx.measureText(dLabel).width+10;
        ctx.fillStyle='rgba(245,208,138,0.9)';
        ctx.beginPath(); if(ctx.roundRect)ctx.roundRect(midCx-dw2/2,midCy-22,dw2,18,4);else ctx.rect(midCx-dw2/2,midCy-22,dw2,18); ctx.fill();
        ctx.fillStyle='#1a1f2e';
        ctx.fillText(dLabel, midCx, midCy-8);
        ctx.restore();
      }

      const rs=rectSelRef.current;
      if (rs) {
        const rx=Math.min(rs.x1,rs.x2), ry=Math.min(rs.y1,rs.y2);
        const rw=Math.abs(rs.x2-rs.x1), rh=Math.abs(rs.y2-rs.y1);
        ctx.strokeStyle='#5b8af5'; ctx.lineWidth=1.5; ctx.setLineDash([5,3]);
        ctx.fillStyle='rgba(91,138,245,0.08)';
        ctx.fillRect(rx,ry,rw,rh);
        ctx.strokeRect(rx,ry,rw,rh);
        ctx.setLineDash([]);
      }

      const ppts = polyPtsRef.current, mp2 = mousePosRef.current;
      if (toolRef.current==='surface' && ppts.length>0) {
        if (mp2 && ppts.length>=1) {
          const lastPt=ppts[ppts.length-1];
          const {wx:mpwx,wy:mpwy}=toWorld(mp2.cx,mp2.cy);
          const segD=Math.sqrt((mpwx-lastPt.x)**2+(mpwy-lastPt.y)**2);
          if (segD>0.001) {
            const sLabel=segD>=1?`${segD.toFixed(3)} m`:`${(segD*100).toFixed(1)} cm`;
            ctx.save();
            ctx.font='bold 12px sans-serif'; ctx.textAlign='center';
            const sw=ctx.measureText(sLabel).width+10;
            ctx.fillStyle='rgba(80,200,120,0.85)';
            ctx.beginPath(); if(ctx.roundRect)ctx.roundRect(mp2.cx-sw/2+12,mp2.cy-32,sw,18,4);else ctx.rect(mp2.cx-sw/2+12,mp2.cy-32,sw,18); ctx.fill();
            ctx.fillStyle='#fff';
            ctx.fillText(sLabel,mp2.cx+12,mp2.cy-18);
            ctx.restore();
          }
        }
        ctx.save();
        ctx.strokeStyle=surfColorRef.current; ctx.lineWidth=2; ctx.setLineDash([4,3]);
        ctx.beginPath();
        const{cx:px0,cy:py0}=toC(ppts[0].x,ppts[0].y);
        ctx.moveTo(px0,py0);
        for(let i=1;i<ppts.length;i++){const{cx,cy}=toC(ppts[i].x,ppts[i].y);ctx.lineTo(cx,cy);}
        if(mp2) ctx.lineTo(mp2.cx,mp2.cy);
        ctx.stroke();
        ctx.setLineDash([]);
        ppts.forEach((p,i)=>{
          const{cx,cy}=toC(p.x,p.y);
          ctx.fillStyle=i===0?'#f5a623':surfColorRef.current;
          ctx.beginPath(); ctx.arc(cx,cy,i===0?6:4,0,Math.PI*2); ctx.fill();
          if(i===0&&ppts.length>=3){
            ctx.strokeStyle='#f5a623'; ctx.lineWidth=2;
            ctx.beginPath(); ctx.arc(cx,cy,10,0,Math.PI*2); ctx.stroke();
          }
        });
        if(ppts.length>=2){
          const r=parseInt(surfColorRef.current.slice(1,3),16);
          const g=parseInt(surfColorRef.current.slice(3,5),16);
          const b=parseInt(surfColorRef.current.slice(5,7),16);
          ctx.beginPath();
          ctx.moveTo(px0,py0);
          for(let i=1;i<ppts.length;i++){const{cx,cy}=toC(ppts[i].x,ppts[i].y);ctx.lineTo(cx,cy);}
          ctx.closePath();
          ctx.fillStyle=`rgba(${r},${g},${b},0.08)`;
          ctx.fill();
          const area=calcSurface(ppts);
          if(area>0.001&&mp2){
            const areaLabel=area>=1?`${area.toFixed(2)} m²`:`${(area*10000).toFixed(0)} cm²`;
            ctx.fillStyle=surfColorRef.current; ctx.font='bold 13px sans-serif'; ctx.textAlign='left';
            ctx.fillText(`≈ ${areaLabel}`, mp2.cx+12, mp2.cy-8);
          }
        }
        ctx.restore();
      }

      if (movingSelRef.current && mousePosRef.current) {
        ctx.fillStyle='rgba(91,138,245,0.7)';
        ctx.font='bold 11px sans-serif'; ctx.textAlign='center';
        ctx.fillText('⊹ Déplacement en cours — relâcher pour poser', W/2, 22);
      }

      if (orthoRef.current) {
        ctx.fillStyle='rgba(80,200,120,0.85)';
        ctx.font='bold 11px sans-serif';
        ctx.textAlign='left';
        ctx.fillText('ORTHO', 10, H-10);
      }
      if (snapRef.current) {
        ctx.fillStyle='rgba(91,138,245,0.85)';
        ctx.font='bold 11px sans-serif';
        ctx.textAlign='left';
        ctx.fillText('SNAP', orthoRef.current ? 70 : 10, H-10);
      }

    } catch(e) { console.error('Render error:',e); }
  }, []);

  useEffect(() => { render(); });

  useEffect(() => {
    const handler = (e) => {
      if (e.target.tagName==='INPUT'||e.target.tagName==='TEXTAREA') return;
      if ((e.ctrlKey||e.metaKey) && e.key==='z' && !e.shiftKey) { e.preventDefault(); undo(); }
      if (((e.ctrlKey||e.metaKey)&&e.key==='y')||((e.ctrlKey||e.metaKey)&&e.shiftKey&&e.key==='z')) { e.preventDefault(); redo(); }
      if (e.key==='Delete'||e.key==='Backspace') {
        if (selectedRef.current.size>0) {
          pushHistory(segmentsRef.current, symbolsRef.current, cotesRef.current);
          const ids=selectedRef.current;
          setSegments(s=>s.map(x=>ids.has(x.id)?{...x,deleted:true}:x));
          setSymbols(s=>s.map(x=>ids.has(x.id)?{...x,deleted:true}:x));
          setCotes(s=>s.map(x=>ids.has(x.id)?{...x,deleted:true}:x));
          setSurfaces(s=>s.map(x=>ids.has(x.id)?{...x,deleted:true}:x));
          setSelectedIds(new Set());
        }
      }
      if (e.key==='Escape') { setSelectedIds(new Set()); setLineStart(null); setMeasurePts([]); setMeasureDist(null); setRectSel(null); setPolyPoints([]); }
      if (e.key==='o'||e.key==='O') setOrthoMode(v=>!v);
      if (e.key==='r'||e.key==='R') setPlanRotation(v=>(v+15)%360);
      if ((e.ctrlKey||e.metaKey)&&e.key==='p') { e.preventDefault(); setPrintMode(v=>!v); }
      if (e.key==='R'&&e.shiftKey)  setPlanRotation(0);
      if (e.key==='s'||e.key==='S') setSnapEnabled(v=>!v);
      if ((e.ctrlKey||e.metaKey)&&e.key==='c') {
        e.preventDefault();
        if (selectedRef.current.size>0) {
          const ids=selectedRef.current;
          clipboardRef.current = {
            segments: segmentsRef.current.filter(s=>ids.has(s.id)&&!s.deleted),
            symbols:  symbolsRef.current.filter(s=>ids.has(s.id)&&!s.deleted),
            cotes:    cotesRef.current.filter(s=>ids.has(s.id)&&!s.deleted),
            surfaces: surfacesRef.current.filter(s=>ids.has(s.id)&&!s.deleted),
          };
        }
      }
      if ((e.ctrlKey||e.metaKey)&&e.key==='v') {
        e.preventDefault();
        const cb=clipboardRef.current;
        if (cb) {
          const offset=30/vpRef.current.scale;
          const newSegs  = cb.segments.map(s=>({...s,x1:s.x1+offset,y1:s.y1+offset,x2:s.x2+offset,y2:s.y2+offset,id:Date.now()+Math.random()}));
          const newSyms  = cb.symbols.map(s=>({...s,x:s.x+offset,y:s.y+offset,id:Date.now()+Math.random()}));
          const newCotes = cb.cotes.map(s=>({...s,x1:s.x1+offset,y1:s.y1+offset,x2:s.x2+offset,y2:s.y2+offset,id:Date.now()+Math.random()}));
          const newSurfs = cb.surfaces.map(s=>({...s,points:s.points.map(p=>({x:p.x+offset,y:p.y+offset})),id:Date.now()+Math.random()}));
          pushHistory(segmentsRef.current,symbolsRef.current,cotesRef.current);
          setSegments(s=>[...s,...newSegs]);
          setSymbols(s=>[...s,...newSyms]);
          setCotes(s=>[...s,...newCotes]);
          setSurfaces(s=>[...s,...newSurfs]);
          setSelectedIds(new Set([...newSegs,...newSyms,...newCotes,...newSurfs].map(x=>x.id)));
          clipboardRef.current = { segments:newSegs, symbols:newSyms, cotes:newCotes, surfaces:newSurfs };
        }
      }
      if ((e.ctrlKey||e.metaKey)&&e.key==='d') {
        e.preventDefault();
        if (selectedRef.current.size>0) {
          const offset=20/vpRef.current.scale;
          const ids=selectedRef.current;
          const newSegs  = segmentsRef.current.filter(s=>ids.has(s.id)&&!s.deleted).map(s=>({...s,x1:s.x1+offset,y1:s.y1+offset,x2:s.x2+offset,y2:s.y2+offset,id:Date.now()+Math.random()}));
          const newSyms  = symbolsRef.current.filter(s=>ids.has(s.id)&&!s.deleted).map(s=>({...s,x:s.x+offset,y:s.y+offset,id:Date.now()+Math.random()}));
          const newCotes = cotesRef.current.filter(s=>ids.has(s.id)&&!s.deleted).map(s=>({...s,x1:s.x1+offset,y1:s.y1+offset,x2:s.x2+offset,y2:s.y2+offset,id:Date.now()+Math.random()}));
          const newSurfs = surfacesRef.current.filter(s=>ids.has(s.id)&&!s.deleted).map(s=>({...s,points:s.points.map(p=>({x:p.x+offset,y:p.y+offset})),id:Date.now()+Math.random()}));
          pushHistory(segmentsRef.current,symbolsRef.current,cotesRef.current);
          setSegments(s=>[...s,...newSegs]);
          setSymbols(s=>[...s,...newSyms]);
          setCotes(s=>[...s,...newCotes]);
          setSurfaces(s=>[...s,...newSurfs]);
          setSelectedIds(new Set([...newSegs,...newSyms,...newCotes,...newSurfs].map(x=>x.id)));
        }
      }
      if (e.key==='a'&&(e.ctrlKey||e.metaKey)) {
        e.preventDefault();
        const allIds=new Set([
          ...segmentsRef.current.filter(s=>!s.deleted).map(s=>s.id),
          ...symbolsRef.current.filter(s=>!s.deleted).map(s=>s.id),
          ...cotesRef.current.filter(s=>!s.deleted).map(s=>s.id),
        ]);
        setSelectedIds(allIds);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const container = canvas.parentElement; if (!container) return;
    let rafId = null;
    const resize = () => {
      if (rafId) cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(() => {
        const w=container.clientWidth, h=container.clientHeight;
        if (w>0&&h>0&&(canvas.width!==w||canvas.height!==h)) {
          canvas.width=w; canvas.height=h; render();
        }
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(container);
    resize();
    return () => { observer.disconnect(); if(rafId) cancelAnimationFrame(rafId); };
  }, []);

  const fitView = useCallback(() => {
    const canvas = canvasRef.current; if (!canvas) return;
    const segs  = segmentsRef.current.filter(s=>!s.deleted);
    const syms  = symbolsRef.current.filter(s=>!s.deleted);
    const bounds = getBounds(segs, syms);
    if (bounds.w===0&&bounds.h===0) return;
    const pad=0.1;
    const scaleX=canvas.width/(bounds.w*(1+pad*2));
    const scaleY=canvas.height/(bounds.h*(1+pad*2));
    const scale=Math.min(scaleX,scaleY);
    if (!isFinite(scale)||scale<=0) return;
    setVp({ x:bounds.minX-bounds.w*pad, y:bounds.minY-bounds.h*pad, scale });
  }, []);

  useEffect(() => { if (segments.length>0) fitView(); }, []);

  const dragRef    = useRef(null);
  const rectRef    = useRef(null);
  const midDragRef = useRef(null);

  const getEventPos = (e) => {
    const canvas=canvasRef.current;
    if (!canvas) return {cx:0,cy:0};
    const rect=canvas.getBoundingClientRect();
    const clientX=e.touches?e.touches[0].clientX:e.clientX;
    const clientY=e.touches?e.touches[0].clientY:e.clientY;
    return { cx:clientX-rect.left, cy:clientY-rect.top };
  };

  const onMouseDown = (e) => {
    if (!canvasRef.current) return;
    if (e.button===1) {
      e.preventDefault();
      const pos=getEventPos(e);
      const v=vpRef.current;
      midDragRef.current={startCx:pos.cx,startCy:pos.cy,startVx:v.x,startVy:v.y};
      return;
    }
    const pos=getEventPos(e);
    const {wx,wy}=toWorld(pos.cx,pos.cy);

    if (tool==='pan') {
      const v=vpRef.current;
      dragRef.current={startCx:pos.cx,startCy:pos.cy,startVx:v.x,startVy:v.y};

    } else if (tool==='select') {
      const hitThresh=10/vpRef.current.scale;
      let hitExisting=false;
      if (selectedRef.current.size>0) {
        const ids=selectedRef.current;
        for (const s of segmentsRef.current.filter(x=>!x.deleted&&ids.has(x.id))) {
          const dx=s.x2-s.x1,dy=s.y2-s.y1,len2=dx*dx+dy*dy;
          if(!len2) continue;
          const t=Math.max(0,Math.min(1,((wx-s.x1)*dx+(wy-s.y1)*dy)/len2));
          if(Math.sqrt((s.x1+t*dx-wx)**2+(s.y1+t*dy-wy)**2)<hitThresh){hitExisting=true;break;}
        }
        if(!hitExisting) for (const s of symbolsRef.current.filter(x=>!x.deleted&&ids.has(x.id))) {
          if(Math.sqrt((wx-s.x)**2+(wy-s.y)**2)<Math.max(0.8,(12/vpRef.current.scale)*(s.size||1))){hitExisting=true;break;}
        }
        if(!hitExisting) for (const s of cotesRef.current.filter(x=>!x.deleted&&ids.has(x.id))) {
          const dx=s.x2-s.x1,dy=s.y2-s.y1,len2=dx*dx+dy*dy;
          if(!len2) continue;
          const t=Math.max(0,Math.min(1,((wx-s.x1)*dx+(wy-s.y1)*dy)/len2));
          if(Math.sqrt((s.x1+t*dx-wx)**2+(s.y1+t*dy-wy)**2)<hitThresh){hitExisting=true;break;}
        }
        if(!hitExisting) for (const s of surfacesRef.current.filter(x=>!x.deleted&&ids.has(x.id))) {
          const pts=s.points; let inside=false;
          for(let i=0,j=pts.length-1;i<pts.length;j=i++){
            if(((pts[i].y>wy)!=(pts[j].y>wy))&&(wx<(pts[j].x-pts[i].x)*(wy-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x)) inside=!inside;
          }
          if(inside){hitExisting=true;break;}
        }
      }
      let coteDragHit = null;
      if (selectedRef.current.size === 1) {
        const selId = [...selectedRef.current][0];
        const selCote = cotesRef.current.find(c=>c.id===selId&&!c.deleted);
        if (selCote) {
          const angle = Math.atan2(selCote.y2-selCote.y1, selCote.x2-selCote.x1);
          const perp = angle - Math.PI/2;
          const offset = (selCote.offset||0)+24;
          const midX = (selCote.x1+selCote.x2)/2 + Math.cos(perp)*offset;
          const midY = (selCote.y1+selCote.y2)/2 + Math.sin(perp)*offset;
          const hitR = 20/vpRef.current.scale;
          if (Math.sqrt((wx-midX)**2+(wy-midY)**2) < hitR) {
            coteDragHit = { id:selId, origOffset:selCote.offset||0,
              startWx:wx, startWy:wy,
              perpX:Math.cos(perp), perpY:Math.sin(perp) };
          }
        }
      }
      if (coteDragHit) {
        movingCoteRef.current = coteDragHit;
        return;
      }
      if (hitExisting) {
        movingSelRef.current = {
          startWx: wx, startWy: wy,
          origSegs:  segmentsRef.current.map(s=>({...s})),
          origSyms:  symbolsRef.current.map(s=>({...s})),
          origCotes: cotesRef.current.map(s=>({...s})),
          origSurfs: surfacesRef.current.map(s=>({...s,points:s.points?[...s.points.map(p=>({...p}))]:[]})),
        };
        return;
      }
      rectRef.current={ cx:pos.cx, cy:pos.cy, moved:false };
      let hit=null;
      for (const c of cotesRef.current.filter(x=>!x.deleted)) {
        const dx=c.x2-c.x1,dy=c.y2-c.y1,len2=dx*dx+dy*dy;
        if (!len2) continue;
        const t=Math.max(0,Math.min(1,((wx-c.x1)*dx+(wy-c.y1)*dy)/len2));
        const px=c.x1+t*dx-wx,py=c.y1+t*dy-wy;
        if (Math.sqrt(px*px+py*py)<hitThresh) { hit=c.id; break; }
      }
      if (!hit) for (const s of segmentsRef.current.filter(x=>!x.deleted)) {
        const dx=s.x2-s.x1,dy=s.y2-s.y1,len2=dx*dx+dy*dy;
        if (!len2) continue;
        const t=Math.max(0,Math.min(1,((wx-s.x1)*dx+(wy-s.y1)*dy)/len2));
        const px=s.x1+t*dx-wx,py=s.y1+t*dy-wy;
        if (Math.sqrt(px*px+py*py)<hitThresh) { hit=s.id; break; }
      }
      if (!hit) for (const sym of symbolsRef.current.filter(x=>!x.deleted)) {
        const hitR = Math.max(0.8, (12 / vpRef.current.scale) * (sym.size||1));
        const d = Math.sqrt((wx-sym.x)**2+(wy-sym.y)**2);
        if (d < hitR) { hit=sym.id; break; }
      }
      if (!hit) for (const surf of surfacesRef.current.filter(x=>!x.deleted)) {
        const pts=surf.points; let inside=false;
        for(let i=0,j=pts.length-1;i<pts.length;j=i++){
          if(((pts[i].y>wy)!=(pts[j].y>wy))&&(wx<(pts[j].x-pts[i].x)*(wy-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x))
            inside=!inside;
        }
        if(inside){hit=surf.id;break;}
      }
      if (hit) {
        setSelectedIds(prev => {
          const n=new Set(prev);
          if (e.shiftKey) { n.has(hit)?n.delete(hit):n.add(hit); }
          else { n.clear(); n.add(hit); }
          return n;
        });
        const hitSym = symbolsRef.current.find(s=>s.id===hit&&!s.deleted);
        if (hitSym) {
          setSymProps({id:hitSym.id,x:hitSym.x,y:hitSym.y,
            angle:hitSym.angle||0, size:hitSym.size||1,
            type:hitSym.type, text:hitSym.text||''});
        } else {
          setSymProps(null);
        }
        rectRef.current=null;
      } else {
        setSymProps(null);
      }

    } else if (tool==='delete') {
      const hitThresh=10/vpRef.current.scale;
      let bestId=null,bestDist=Infinity;
      [...segmentsRef.current.filter(s=>!s.deleted),...cotesRef.current.filter(s=>!s.deleted)].forEach(s=>{
        const dx=s.x2-s.x1,dy=s.y2-s.y1,len2=dx*dx+dy*dy;
        if(!len2) return;
        const t=Math.max(0,Math.min(1,((wx-s.x1)*dx+(wy-s.y1)*dy)/len2));
        const px=s.x1+t*dx-wx,py=s.y1+t*dy-wy;
        const d=Math.sqrt(px*px+py*py);
        if(d<hitThresh&&d<bestDist){bestDist=d;bestId=s.id;}
      });
      if(!bestId){
        for(const sym of symbolsRef.current.filter(s=>!s.deleted)){
          const hitR=Math.max(0.8,(12/vpRef.current.scale)*(sym.size||1));
          if(Math.sqrt((wx-sym.x)**2+(wy-sym.y)**2)<hitR){bestId=sym.id;break;}
        }
      }
      if(!bestId){
        for(const surf of surfacesRef.current.filter(s=>!s.deleted)){
          const pts=surf.points; let inside=false;
          for(let i=0,j=pts.length-1;i<pts.length;j=i++){
            if(((pts[i].y>wy)!==(pts[j].y>wy))&&(wx<(pts[j].x-pts[i].x)*(wy-pts[i].y)/(pts[j].y-pts[i].y)+pts[i].x))
              inside=!inside;
          }
          if(inside){bestId=surf.id;break;}
        }
      }
      if(bestId){
        pushHistory(segmentsRef.current,symbolsRef.current,cotesRef.current);
        setSegments(s=>s.map(x=>x.id===bestId?{...x,deleted:true}:x));
        setCotes(s=>s.map(x=>x.id===bestId?{...x,deleted:true}:x));
        setSurfaces(s=>s.map(x=>x.id===bestId?{...x,deleted:true}:x));
        setSymbols(s=>s.map(x=>x.id===bestId?{...x,deleted:true}:x));
      }

    } else if (tool==='line') {
      let lx=wx,ly=wy;
      if (lineStartRef.current) {
        const o=applyOrtho(lineStartRef.current.x,lineStartRef.current.y,lx,ly);
        lx=o.wx; ly=o.wy;
      }
      const s=snapToPoint(lx,ly);
      lx=s.wx; ly=s.wy;
      if (!lineStartRef.current) {
        setLineStart({x:lx,y:ly});
      } else {
        const newSeg={x1:lineStartRef.current.x,y1:lineStartRef.current.y,x2:lx,y2:ly,
          color:lineColorRef.current,layer:'user',user:true,id:Date.now()+Math.random()};
        pushHistory(segments,symbols,cotes);
        setSegments(s=>[...s,newSeg]);
        setLineStart({x:lx,y:ly});
      }

    } else if (tool==='cote') {
      const s=snapToPoint(wx,wy);
      if (measurePtsRef.current.length===0) {
        setMeasurePts([{x:s.wx,y:s.wy}]);
        setMeasureDist(null);
      } else {
        const es=snapToPoint(wx,wy);
        const newCote={x1:measurePtsRef.current[0].x,y1:measurePtsRef.current[0].y,
          x2:es.wx,y2:es.wy,id:Date.now()+Math.random()};
        pushHistory(segments,symbols,cotes);
        setCotes(c=>[...c,newCote]);
        setMeasurePts([]);
        setMeasureDist(null);
      }

    } else if (['door','window','stair','wc'].includes(tool)) {
      pushHistory(segments,symbols,cotes);
      setSymbols(s=>[...s,{x:wx,y:wy,type:tool,angle:0,id:Date.now()+Math.random()}]);

    } else if (tool==='text') {
      const txt=prompt('Texte à afficher sur le plan :');
      if (txt?.trim()) {
        pushHistory(segments,symbols,cotes);
        setSymbols(s=>[...s,{x:wx,y:wy,type:'text',text:txt.trim(),id:Date.now()+Math.random()}]);
      }

    } else if (tool==='surface') {
      const s=snapToPoint(wx,wy);
      const cur=polyPtsRef.current;
      if(cur.length>=3){
        const first=cur[0];
        const dx=first.x-s.wx, dy=first.y-s.wy;
        const distClose=Math.sqrt(dx*dx+dy*dy);
        const closeThresh=12/vpRef.current.scale;
        if(distClose<closeThresh){
          pushHistory(segments,symbols,cotes);
          setSurfaces(prev=>[...prev,{
            id:Date.now()+Math.random(),
            points:[...cur],
            color:surfColorRef.current,
            alpha:0.15,
          }]);
          setPolyPoints([]);
          return;
        }
      }
      setPolyPoints(prev=>[...prev,{x:s.wx,y:s.wy}]);
    }
  };

  const onMouseMove = (e) => {
    const pos=getEventPos(e);
    setMousePos(pos);

    const midDrag=midDragRef.current;
    if (midDrag) {
      const scale=vpRef.current.scale;
      const rot=planRotRef.current*Math.PI/180;
      const cosR=Math.cos(-rot), sinR=Math.sin(-rot);
      const rawDx=(pos.cx-midDrag.startCx)/scale;
      const rawDy=(pos.cy-midDrag.startCy)/scale;
      const dx=rawDx*cosR-rawDy*sinR;
      const dy=rawDx*sinR+rawDy*cosR;
      setVp(v=>({...v,x:midDrag.startVx-dx,y:midDrag.startVy-dy}));
      return;
    }
    const drag=dragRef.current;
    if (drag && toolRef.current==='pan') {
      const scale=vpRef.current.scale;
      const rot=planRotRef.current*Math.PI/180;
      const cosR=Math.cos(-rot), sinR=Math.sin(-rot);
      const rawDx=(pos.cx-drag.startCx)/scale;
      const rawDy=(pos.cy-drag.startCy)/scale;
      const dx=rawDx*cosR-rawDy*sinR;
      const dy=rawDx*sinR+rawDy*cosR;
      setVp(v=>({...v,x:drag.startVx-dx,y:drag.startVy-dy}));
      return;
    }
    const mc = movingCoteRef.current;
    if (mc) {
      const {wx:cwx, wy:cwy} = toWorld(pos.cx, pos.cy);
      const dx = cwx - mc.startWx, dy = cwy - mc.startWy;
      const proj = dx*mc.perpX + dy*mc.perpY;
      const newOffset = mc.origOffset + proj;
      setCotes(arr => arr.map(c => c.id===mc.id ? {...c, offset:newOffset} : c));
      return;
    }
    const mv = movingSelRef.current;
    if (mv) {
      const {wx:cwx, wy:cwy} = toWorld(pos.cx, pos.cy);
      const ddx = cwx - mv.startWx;
      const ddy = cwy - mv.startWy;
      const ids = selectedRef.current;
      setSegments(mv.origSegs.map(s=>ids.has(s.id)&&!s.deleted
        ?{...s,x1:s.x1+ddx,y1:s.y1+ddy,x2:s.x2+ddx,y2:s.y2+ddy}:s));
      setSymbols(mv.origSyms.map(s=>ids.has(s.id)&&!s.deleted
        ?{...s,x:s.x+ddx,y:s.y+ddy}:s));
      setCotes(mv.origCotes.map(s=>ids.has(s.id)&&!s.deleted
        ?{...s,x1:s.x1+ddx,y1:s.y1+ddy,x2:s.x2+ddx,y2:s.y2+ddy}:s));
      setSurfaces(mv.origSurfs.map(s=>ids.has(s.id)&&!s.deleted
        ?{...s,points:s.points.map(p=>({x:p.x+ddx,y:p.y+ddy}))}:s));
      return;
    }
    if (rectRef.current && toolRef.current==='select') {
      rectRef.current.moved=true;
      setRectSel({x1:rectRef.current.cx,y1:rectRef.current.cy,x2:pos.cx,y2:pos.cy});
    }
  };

  const onMouseUp = (e) => {
    midDragRef.current=null;
    dragRef.current=null;
    if (movingCoteRef.current) {
      movingCoteRef.current = null;
      return;
    }
    if (movingSelRef.current) {
      const mv = movingSelRef.current;
      historyRef.current = [...historyRef.current.slice(-29), {
        segments: mv.origSegs, symbols: mv.origSyms,
        cotes: mv.origCotes, surfaces: mv.origSurfs,
      }];
      futureRef.current = [];
      setHistoryLen(historyRef.current.length);
      setFutureLen(0);
      movingSelRef.current = null;
      return;
    }
    const rs=rectSelRef.current;
    if (rectRef.current?.moved && rs) {
      const vp=vpRef.current;
      const rx1=Math.min(rs.x1,rs.x2)/vp.scale+vp.x;
      const rx2=Math.max(rs.x1,rs.x2)/vp.scale+vp.x;
      const ry1=Math.min(rs.y1,rs.y2)/vp.scale+vp.y;
      const ry2=Math.max(rs.y1,rs.y2)/vp.scale+vp.y;
      const inRect=(x,y)=>x>=rx1&&x<=rx2&&y>=ry1&&y<=ry2;
      const ids=new Set();
      segmentsRef.current.filter(s=>!s.deleted).forEach(s=>{
        if(inRect(s.x1,s.y1)&&inRect(s.x2,s.y2)) ids.add(s.id);
      });
      cotesRef.current.filter(s=>!s.deleted).forEach(s=>{
        if(inRect(s.x1,s.y1)&&inRect(s.x2,s.y2)) ids.add(s.id);
      });
      symbolsRef.current.filter(s=>!s.deleted).forEach(s=>{
        if(inRect(s.x,s.y)) ids.add(s.id);
      });
      surfacesRef.current.filter(s=>!s.deleted).forEach(s=>{
        if(s.points.every(p=>inRect(p.x,p.y))) ids.add(s.id);
      });
      if (e.shiftKey) setSelectedIds(prev=>{const n=new Set([...prev,...ids]);return n;});
      else setSelectedIds(ids);
    }
    rectRef.current=null;
    setRectSel(null);
  };

  const onMouseLeave = () => {
    dragRef.current=null; midDragRef.current=null;
    movingCoteRef.current=null;
    if (movingSelRef.current) {
      const mv = movingSelRef.current;
      setSegments(mv.origSegs);
      setSymbols(mv.origSyms);
      setCotes(mv.origCotes);
      setSurfaces(mv.origSurfs);
      movingSelRef.current = null;
    }
  };

  const onWheel = (e) => {
    e.preventDefault();
    const pos=getEventPos(e);
    const {wx,wy}=toWorld(pos.cx,pos.cy);
    const factor=e.deltaY<0?1.15:0.87;
    setVp(v=>{
      const ns=Math.max(0.01,Math.min(1000,v.scale*factor));
      const rot=planRotRef.current*Math.PI/180;
      const canvas=canvasRef.current;
      const cx0=canvas?canvas.width/2:400, cy0=canvas?canvas.height/2:300;
      const pdx=pos.cx-cx0, pdy=pos.cy-cy0;
      const cosNR=Math.cos(-rot), sinNR=Math.sin(-rot);
      const unrotX=cx0+pdx*cosNR-pdy*sinNR;
      const unrotY=cy0+pdx*sinNR+pdy*cosNR;
      return {scale:ns, x:wx-unrotX/ns, y:wy-unrotY/ns};
    });
  };

  const importDXF = (e) => {
    const file=e.target.files[0]; if(!file) return;
    const reader=new FileReader();
    reader.onload=(ev)=>{
      const {points,segments:segs}=parseDXF(ev.target.result);
      let finalSegs=segs;
      if(segs.length===0&&points.length>0) finalSegs=autoConnect(points,threshold);
      pushHistory(segments,symbols,cotes);
      setSegments(finalSegs); setSymbols([]); setCotes([]);
      setTimeout(fitView,50);
    };
    reader.readAsText(file,'utf-8');
    e.target.value='';
  };

  const [showImportModal, setShowImportModal] = useState(false);
  const [importablePlans, setImportablePlans] = useState([]);
  const [importLoading, setImportLoading] = useState(false);

  const openImportModal = async () => {
    setImportLoading(true);
    const {data} = await supabase.from('plans').select('id,name,thumbnail,updated_at').order('updated_at',{ascending:false});
    setImportablePlans((data||[]).filter(p=>p.id!==plan.id));
    setImportLoading(false);
    setShowImportModal(true);
  };

  const importFromPlan = (srcPlan) => {
    const d = srcPlan.data||{};
    const reId = arr => (arr||[]).map(x=>({...x, id:Date.now()+Math.random(),
      ...(x.points?{points:x.points.map(p=>({...p}))}:{})}));
    const newSegs  = reId(d.segments);
    const newSyms  = reId(d.symbols);
    const newCotes = reId(d.cotes);
    const newSurfs = reId(d.surfaces);
    pushHistory(segmentsRef.current, symbolsRef.current, cotesRef.current);
    setSegments(s=>[...s,...newSegs]);
    setSymbols(s=>[...s,...newSyms]);
    setCotes(s=>[...s,...newCotes]);
    setSurfaces(s=>[...s,...newSurfs]);
    setSelectedIds(new Set([...newSegs,...newSyms,...newCotes,...newSurfs].map(x=>x.id)));
    setShowImportModal(false);
    setTimeout(fitView, 50);
  };

  const handleSave = async () => {
    setSaving(true);
    const canvas=canvasRef.current;
    const thumb=canvas?canvas.toDataURL('image/png',0.3):'';
    const data={segments,symbols,cotes,surfaces,viewport:vp,threshold,planRotation};
    await supabase.from('plans').update({data,thumbnail:thumb,updated_at:new Date().toISOString()}).eq('id',plan.id);
    setSaving(false);
    onSave({...plan,data,thumbnail:thumb});
  };

  const exportPNG = (forPrint=false) => {
    const canvas=canvasRef.current; if(!canvas) return;
    if (forPrint) {
      printModeRef.current=true; render();
      setTimeout(()=>{
        const a=document.createElement('a');
        a.href=canvas.toDataURL('image/png');
        a.download=(plan.name||'plan')+'-impression.png';
        a.click();
        printModeRef.current=false; render();
      },50);
    } else {
      const a=document.createElement('a');
      a.href=canvas.toDataURL('image/png');
      a.download=(plan.name||'plan')+'.png';
      a.click();
    }
  };

  const exportPDF = (forPrint=false) => {
    const canvas=canvasRef.current; if(!canvas) return;
    const doExport = () => {
      const dataUrl=canvas.toDataURL('image/png');
      const w=window.open('','_blank');
      w.document.write(`<!DOCTYPE html><html><head><title>${plan.name}</title>
    <style>@page{size:A3 landscape;margin:10mm}body{margin:0}img{width:100%;height:auto}</style>
    </head><body><img src="${dataUrl}"/></body></html>`);
      w.document.close(); setTimeout(()=>w.print(),500);
      if (forPrint) { printModeRef.current=false; render(); }
    };
    if (forPrint) { printModeRef.current=true; render(); setTimeout(doExport,50); }
    else doExport();
  };

  const segCount=segments.filter(s=>!s.deleted).length;
  const symCount=symbols.filter(s=>!s.deleted).length;
  const coteCount=cotes.filter(c=>!c.deleted).length;
  const surfCount=surfaces.filter(s=>!s.deleted).length;
  const selCount=selectedIds.size;

  const TOOLS = [
    {id:'pan',    icon:'✋', label:'Déplacer (clic molette fonctionne dans tous les modes)'},
    {id:'select', icon:'⬚',  label:'Sélectionner / Transformer (clic simple, glisser = rectangle, Shift = ajouter)'},
    {id:'delete', icon:'✕',  label:'Supprimer au clic (clic molette pour se déplacer)'},
    {id:'line',   icon:'╱',  label:'Tracer une ligne (double-clic pour terminer, O = ortho, S = snap)'},
    {id:'cote',   icon:'↔',  label:'Ajouter une cote'},
    {id:'door',   icon:'🚪', label:'Porte'},
    {id:'window', icon:'⬜', label:'Fenêtre'},
    {id:'text',   icon:'T',  label:'Texte'},
    {id:'surface',icon:'⬡',  label:'Surface — cliquer les points, clic sur le 1er point pour fermer'},
  ];

  const btnStyle=(id)=>({
    display:'flex',alignItems:'center',justifyContent:'center',
    width:38,height:38,borderRadius:8,border:'none',cursor:'pointer',
    fontSize:15,transition:'all .12s',
    background:tool===id?'#5b8af5':'rgba(255,255,255,0.06)',
    color:tool===id?'#fff':'#9aa5c0',
  });

  return (
    <div style={{display:'flex',flexDirection:'column',flex:1,minHeight:0,background:'#12151f',position:'relative'}}>

      {/* ── Toolbar ── */}
      <div style={{display:'flex',alignItems:'center',gap:6,padding:'8px 14px',
        background:'#1e2336',borderBottom:'1px solid rgba(255,255,255,0.08)',flexShrink:0,flexWrap:'wrap'}}>

        <button onClick={onClose} style={{background:'transparent',border:'1px solid rgba(255,255,255,0.15)',
          borderRadius:8,padding:'5px 12px',color:'#9aa5c0',fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>
          ← Retour
        </button>
        <div style={{fontSize:14,fontWeight:700,color:'#e8eaf0'}}>{plan.name}</div>
        <div style={{fontSize:11,color:'#5b6a8a'}}>{segCount} seg · {symCount} sym · {coteCount} cotes · {surfCount} zones</div>
        {selCount>0&&<div style={{fontSize:11,color:'#f5a623',fontWeight:700}}>{selCount} sélectionné{selCount>1?'s':''}</div>}

        <div style={{height:22,width:1,background:'rgba(255,255,255,0.1)',margin:'0 2px'}}/>

        {TOOLS.map(t=>(
          <button key={t.id} title={t.label} onClick={()=>{setTool(t.id);setLineStart(null);setMeasurePts([]);setMeasureDist(null);setRectSel(null);}} style={btnStyle(t.id)}>
            {t.icon}
          </button>
        ))}

        <div style={{height:22,width:1,background:'rgba(255,255,255,0.1)',margin:'0 2px'}}/>

        <div style={{display:'flex',gap:4,alignItems:'center'}}>
          {LINE_COLORS.map(c=>(
            <button key={c.value} title={c.label} onClick={()=>setLineColor(c.value)} style={{
              width:20,height:20,borderRadius:'50%',border:`2px solid ${lineColor===c.value?'#fff':'transparent'}`,
              background:c.value,cursor:'pointer',padding:0,transition:'all .1s',
              transform:lineColor===c.value?'scale(1.25)':'scale(1)',
            }}/>
          ))}
        </div>

        {tool==='surface'&&(
          <div style={{display:'flex',gap:4,alignItems:'center',padding:'3px 8px',
            background:'rgba(255,255,255,0.04)',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)'}}>
            <span style={{fontSize:11,color:'#9aa5c0',marginRight:2}}>Zone :</span>
            {SURFACE_COLORS.map(c=>(
              <button key={c.value} title={c.label} onClick={()=>setSurfaceColor(c.value)} style={{
                width:20,height:20,borderRadius:4,border:`2px solid ${surfaceColor===c.value?'#fff':'transparent'}`,
                background:c.value,cursor:'pointer',padding:0,transition:'all .1s',
                transform:surfaceColor===c.value?'scale(1.25)':'scale(1)',
              }}/>
            ))}
            {polyPoints.length>0&&(
              <span style={{fontSize:11,color:'#f5a623',marginLeft:4,fontWeight:700}}>
                {polyPoints.length} pts — clic sur ⭕ 1er pt pour fermer
              </span>
            )}
          </div>
        )}

        {selCount>0&&(
          <button title="Recolorer la sélection" onClick={()=>{
            pushHistory(segments,symbols,cotes);
            const ids=selectedIds;
            setSegments(s=>s.map(x=>ids.has(x.id)?{...x,color:lineColor}:x));
          }} style={{...btnStyle('recolor'),width:'auto',padding:'0 10px',fontSize:11,fontWeight:700}}>
            🎨 Recolorer
          </button>
        )}

        <div style={{height:22,width:1,background:'rgba(255,255,255,0.1)',margin:'0 2px'}}/>

        <div style={{display:'flex',alignItems:'center',gap:4,padding:'3px 6px',
          background:'rgba(255,255,255,0.04)',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)'}}>
          <span style={{fontSize:11,color:'#9aa5c0'}}>↻</span>
          <button onClick={()=>setPlanRotation(v=>(v-15+360)%360)} title="Pivoter -15°" style={{
            background:'rgba(255,255,255,0.06)',border:'none',borderRadius:5,
            width:24,height:24,cursor:'pointer',color:'#9aa5c0',fontSize:13,fontFamily:'inherit'}}>−</button>
          <span style={{fontSize:11,color:'#f5a623',fontWeight:700,minWidth:28,textAlign:'center'}}>{planRotation}°</span>
          <button onClick={()=>setPlanRotation(v=>(v+15)%360)} title="Pivoter +15° (R)" style={{
            background:'rgba(255,255,255,0.06)',border:'none',borderRadius:5,
            width:24,height:24,cursor:'pointer',color:'#9aa5c0',fontSize:13,fontFamily:'inherit'}}>+</button>
          <button onClick={()=>setPlanRotation(0)} title="Réinitialiser rotation" style={{
            background:'rgba(255,255,255,0.06)',border:'none',borderRadius:5,
            width:24,height:24,cursor:'pointer',color:'#9aa5c0',fontSize:11,fontFamily:'inherit'}}>⊙</button>
        </div>

        <div style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',
          background:'rgba(255,255,255,0.04)',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)'}}>
          <span style={{fontSize:10,color:'#9aa5c0',marginRight:2}}>CALQUES</span>
          {[
            {k:'segments', icon:'╱', label:'Lignes'},
            {k:'points',   icon:'·', label:'Points de relevé'},
            {k:'symbols',  icon:'🚪', label:'Symboles'},
            {k:'surfaces', icon:'⬡', label:'Surfaces'},
            {k:'cotes',    icon:'↔', label:'Cotes'},
          ].map(({k,icon,label})=>(
            <button key={k} title={`${layers[k]?'Masquer':'Afficher'} ${label}`}
              onClick={()=>setLayers(l=>({...l,[k]:!l[k]}))} style={{
              background: layers[k]?'rgba(91,138,245,0.25)':'rgba(255,255,255,0.04)',
              border:`1px solid ${layers[k]?'rgba(91,138,245,0.5)':'rgba(255,255,255,0.08)'}`,
              borderRadius:5,width:26,height:26,cursor:'pointer',
              fontSize:13,opacity:layers[k]?1:0.35,transition:'all .15s',
              display:'flex',alignItems:'center',justifyContent:'center',
            }}>{icon}</button>
          ))}
        </div>

        <button title={`Snap aux points ${snapEnabled?'ON':'OFF'} (S)`} onClick={()=>setSnapEnabled(v=>!v)} style={{
          ...btnStyle('snap'), background:snapEnabled?'rgba(91,138,245,0.3)':'rgba(255,255,255,0.06)',
          width:'auto',padding:'0 10px',fontSize:11,fontWeight:700,
          color:snapEnabled?'#8ab4ff':'#9aa5c0',border:`1px solid ${snapEnabled?'rgba(91,138,245,0.5)':'transparent'}`,
        }}>⊕ SNAP</button>

        <button title={`Ortho 0/45/90° ${orthoMode?'ON':'OFF'} (O)`} onClick={()=>setOrthoMode(v=>!v)} style={{
          ...btnStyle('ortho'), background:orthoMode?'rgba(80,200,120,0.3)':'rgba(255,255,255,0.06)',
          width:'auto',padding:'0 10px',fontSize:11,fontWeight:700,
          color:orthoMode?'#7ee8a2':'#9aa5c0',border:`1px solid ${orthoMode?'rgba(80,200,120,0.5)':'transparent'}`,
        }}>⊞ ORTHO</button>

        <label style={{display:'flex',alignItems:'center',gap:5,padding:'6px 11px',
          background:'rgba(91,138,245,0.15)',border:'1px solid rgba(91,138,245,0.3)',
          borderRadius:8,color:'#a0b8ff',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
          📂 DXF
          <input type='file' accept='.dxf' style={{display:'none'}} onChange={importDXF}/>
        </label>

        <button onClick={()=>setShowThreshold(s=>!s)} style={{...btnStyle('thr'),width:'auto',padding:'0 8px',fontSize:11}}>
          ⚙ {threshold}m
        </button>
        {showThreshold&&(
          <div style={{display:'flex',alignItems:'center',gap:5,background:'rgba(255,255,255,0.06)',borderRadius:8,padding:'5px 10px'}}>
            <span style={{fontSize:11,color:'#9aa5c0'}}>Seuil:</span>
            <input type='number' value={threshold} min='0.01' max='10' step='0.05'
              onChange={e=>setThreshold(parseFloat(e.target.value)||0.5)}
              style={{width:55,background:'rgba(255,255,255,0.08)',border:'1px solid rgba(255,255,255,0.15)',
                borderRadius:5,padding:'3px 6px',color:'#e8eaf0',fontFamily:'inherit',fontSize:13}}/>
            <span style={{fontSize:11,color:'#5b6a8a'}}>m</span>
          </div>
        )}

        <div style={{flex:1}}/>

        <button title="Ajuster la vue (tout afficher)" onClick={fitView} style={{...btnStyle('fit'),fontSize:14}}>⊙</button>
        <button title="Tout sélectionner (Ctrl+A)" onClick={()=>{
          const allIds=new Set([...segments.filter(s=>!s.deleted).map(s=>s.id),...symbols.filter(s=>!s.deleted).map(s=>s.id),...cotes.filter(s=>!s.deleted).map(s=>s.id),...surfaces.filter(s=>!s.deleted).map(s=>s.id)]);
          setSelectedIds(allIds);
        }} style={{...btnStyle('sela'),fontSize:13}}>⊞</button>
        <button title="Annuler Ctrl+Z" onClick={undo} disabled={historyLen===0} style={{...btnStyle('u'),fontSize:16,opacity:historyLen===0?0.3:1}}>⟲</button>
        <button title="Rétablir Ctrl+Y" onClick={redo} disabled={futureLen===0}  style={{...btnStyle('r'),fontSize:16,opacity:futureLen===0?0.3:1}}>⟳</button>
        <button title="Aide raccourcis ?" onClick={()=>setShowHelp(h=>!h)} style={{...btnStyle('h'),fontSize:14,background:showHelp?'rgba(255,194,0,0.2)':'rgba(255,255,255,0.06)'}}>?</button>

        <button onClick={()=>setPrintMode(v=>!v)} title="Basculer fond blanc pour impression (Ctrl+P)"
          style={{...btnStyle('print'),
            background:printMode?'rgba(255,255,255,0.9)':'rgba(255,255,255,0.06)',
            color:printMode?'#1a1f2e':'#9aa5c0',border:`1px solid ${printMode?'rgba(255,255,255,0.5)':'transparent'}`,
            width:'auto',padding:'0 10px',fontSize:11,fontWeight:700}}>
          🖨 {printMode?'Impression ON':'Impression'}
        </button>

        <div style={{display:'flex',alignItems:'center',gap:4,padding:'3px 8px',
          background:'rgba(255,255,255,0.04)',borderRadius:8,border:'1px solid rgba(255,255,255,0.08)'}}>
          <span style={{fontSize:10,color:'#9aa5c0'}}>↔ Police</span>
          <button onClick={()=>setCoteFontSize(v=>Math.max(7,v-1))} style={{
            background:'rgba(255,255,255,0.06)',border:'none',borderRadius:4,
            width:20,height:20,cursor:'pointer',color:'#9aa5c0',fontSize:12,fontFamily:'inherit'}}>−</button>
          <span style={{fontSize:11,color:'#f5a623',fontWeight:700,minWidth:22,textAlign:'center'}}>{coteFontSize}</span>
          <button onClick={()=>setCoteFontSize(v=>Math.min(24,v+1))} style={{
            background:'rgba(255,255,255,0.06)',border:'none',borderRadius:4,
            width:20,height:20,cursor:'pointer',color:'#9aa5c0',fontSize:12,fontFamily:'inherit'}}>+</button>
        </div>

        <button title={`Fermeture auto des écarts ${autoClose?'ON':'OFF'}`} onClick={()=>setAutoClose(v=>!v)} style={{
          ...btnStyle('ac'), background:autoClose?'rgba(80,200,120,0.3)':'rgba(255,255,255,0.06)',
          width:'auto',padding:'0 8px',fontSize:11,fontWeight:700,
          color:autoClose?'#7ee8a2':'#9aa5c0',border:`1px solid ${autoClose?'rgba(80,200,120,0.5)':'transparent'}`,
        }}>⊂ GAP</button>

        <button onClick={()=>setShowLibrary(true)} title="Bibliothèque de symboles DXF" style={{
          background:'rgba(245,166,35,0.15)',border:'1px solid rgba(245,166,35,0.3)',
          borderRadius:8,padding:'6px 11px',color:'#f5a623',fontFamily:'inherit',
          fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
          📚 Bibliothèque
        </button>

        <button onClick={openImportModal} title="Importer les éléments d'un autre plan" style={{
          background:'rgba(91,138,245,0.15)',border:'1px solid rgba(91,138,245,0.3)',
          borderRadius:8,padding:'6px 12px',color:'#a0b8ff',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer',whiteSpace:'nowrap'}}>
          ⎘ Importer plan
        </button>

        <button onClick={()=>exportPNG()} style={{background:'rgba(80,200,120,0.15)',border:'1px solid rgba(80,200,120,0.3)',
          borderRadius:8,padding:'6px 12px',color:'#7ee8a2',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ PNG</button>
        <button onClick={()=>exportPNG(true)} style={{background:'rgba(80,200,120,0.2)',border:'1px solid rgba(80,200,120,0.4)',
          borderRadius:8,padding:'6px 12px',color:'#7ee8a2',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer'}}>🖨 PNG</button>
        <button onClick={()=>exportPDF()} style={{background:'rgba(245,166,35,0.15)',border:'1px solid rgba(245,166,35,0.3)',
          borderRadius:8,padding:'6px 12px',color:'#f5a623',fontFamily:'inherit',fontSize:12,fontWeight:600,cursor:'pointer'}}>↓ PDF</button>
        <button onClick={()=>exportPDF(true)} style={{background:'rgba(245,166,35,0.2)',border:'1px solid rgba(245,166,35,0.4)',
          borderRadius:8,padding:'6px 12px',color:'#f5a623',fontFamily:'inherit',fontSize:12,fontWeight:700,cursor:'pointer'}}>🖨 PDF</button>
        <button onClick={handleSave} disabled={saving} style={{background:'#5b8af5',border:'none',borderRadius:8,
          padding:'6px 16px',color:'#fff',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer',opacity:saving?.6:1}}>
          {saving?'…':'💾 Sauvegarder'}
        </button>
      </div>

      {/* ── Panneau aide ── */}
      {showHelp&&(
        <div style={{background:'#1a1f2e',borderBottom:'1px solid rgba(255,255,255,0.08)',
          padding:'10px 18px',display:'flex',flexWrap:'wrap',gap:'8px 28px',flexShrink:0}}>
          {[
            ['Molette','Zoom'],['Clic molette + glisser','Se déplacer (tous modes)'],
            ['Ctrl+Z / Ctrl+Y','Annuler / Rétablir'],['Suppr / Backspace','Supprimer sélection'],
            ['Échap','Désélectionner / Annuler'],['O','Toggle Ortho 0/45/90°'],
            ['S','Toggle Snap aux points'],['Ctrl+A','Tout sélectionner'],
            ['Ctrl+C / Ctrl+V','Copier / Coller la sélection (V multiple = décalé)'],
            ['Ctrl+P','Basculer mode impression (fond blanc)'],
            ['⊂ GAP (toolbar)','Fermeture auto des petits écarts de lignes'],
            ['Ctrl+D','Dupliquer immédiat'],['Glisser sélection','Déplacer les éléments sélectionnés'],
            ['Shift+clic','Ajouter à la sélection'],
            ['Outil Ligne','Clic = point, re-clic = chaîne, Échap = fin'],
            ['Outil Cote','Clic 1er point → clic 2ème point = cote fixée'],
            ['Outil Surface','Clic = points du polygone, clic sur ⭕ 1er point = fermer'],
            ['R','Pivoter le plan +15° (Shift+R = réinitialiser)'],
            ['Clic symbole','Ouvre le panneau rotation/taille/position'],
          ].map(([k,v])=>(
            <div key={k} style={{display:'flex',gap:6,alignItems:'center'}}>
              <code style={{background:'rgba(255,255,255,0.1)',borderRadius:4,padding:'2px 7px',fontSize:11,color:'#f5a623',fontWeight:700}}>{k}</code>
              <span style={{fontSize:12,color:'#9aa5c0'}}>{v}</span>
            </div>
          ))}
        </div>
      )}

      {/* ── Panneau propriétés symbole ── */}
      {symProps&&(
        <div style={{
          position:'fixed',top:80,right:24,zIndex:1000,
          background:'#1e2336',border:'1px solid rgba(255,255,255,0.12)',
          borderRadius:12,padding:16,width:220,
          boxShadow:'0 8px 32px rgba(0,0,0,0.5)',
        }}>
          <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:12}}>
            <span style={{fontSize:13,fontWeight:700,color:'#e8eaf0'}}>
              {symProps.type==='door'?'🚪 Porte':symProps.type==='window'?'⬜ Fenêtre':symProps.type==='text'?'T Texte':'Symbole'}
            </span>
            <button onClick={()=>setSymProps(null)} style={{background:'transparent',border:'none',color:'#5b6a8a',cursor:'pointer',fontSize:16}}>✕</button>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'#5b6a8a',marginBottom:5}}>Rotation</div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <input type='range' min={0} max={359} step={5} value={symProps.angle}
                onChange={e=>{
                  const a=parseInt(e.target.value);
                  setSymProps(p=>({...p,angle:a}));
                  setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,angle:a}:x));
                }}
                style={{flex:1,accentColor:'#5b8af5'}}/>
              <span style={{fontSize:12,color:'#f5a623',fontWeight:700,minWidth:34}}>{symProps.angle}°</span>
            </div>
            <div style={{display:'flex',gap:4,marginTop:4}}>
              {[0,45,90,135,180,270].map(a=>(
                <button key={a} onClick={()=>{
                  setSymProps(p=>({...p,angle:a}));
                  setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,angle:a}:x));
                }} style={{
                  background:symProps.angle===a?'#5b8af5':'rgba(255,255,255,0.06)',
                  border:'none',borderRadius:4,padding:'2px 5px',
                  color:symProps.angle===a?'#fff':'#9aa5c0',fontSize:10,cursor:'pointer',fontFamily:'inherit',
                }}>{a}°</button>
              ))}
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'#5b6a8a',marginBottom:5}}>Taille</div>
            <div style={{display:'flex',alignItems:'center',gap:6}}>
              <input type='range' min={0.2} max={5} step={0.1} value={symProps.size||1}
                onChange={e=>{
                  const sz=parseFloat(e.target.value);
                  setSymProps(p=>({...p,size:sz}));
                  setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,size:sz}:x));
                }}
                style={{flex:1,accentColor:'#5b8af5'}}/>
              <span style={{fontSize:12,color:'#f5a623',fontWeight:700,minWidth:34}}>×{(symProps.size||1).toFixed(1)}</span>
            </div>
          </div>
          <div style={{marginBottom:10}}>
            <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'#5b6a8a',marginBottom:5}}>Position</div>
            <div style={{display:'flex',gap:6}}>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:'#5b6a8a',marginBottom:2}}>X</div>
                <input type='number' step={0.1} value={parseFloat(symProps.x.toFixed(2))}
                  onChange={e=>{
                    const v=parseFloat(e.target.value)||0;
                    setSymProps(p=>({...p,x:v}));
                    setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,x:v}:x));
                  }}
                  style={{width:'100%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',
                    borderRadius:5,padding:'4px 6px',color:'#e8eaf0',fontFamily:'inherit',fontSize:11,boxSizing:'border-box'}}/>
              </div>
              <div style={{flex:1}}>
                <div style={{fontSize:9,color:'#5b6a8a',marginBottom:2}}>Y</div>
                <input type='number' step={0.1} value={parseFloat(symProps.y.toFixed(2))}
                  onChange={e=>{
                    const v=parseFloat(e.target.value)||0;
                    setSymProps(p=>({...p,y:v}));
                    setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,y:v}:x));
                  }}
                  style={{width:'100%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',
                    borderRadius:5,padding:'4px 6px',color:'#e8eaf0',fontFamily:'inherit',fontSize:11,boxSizing:'border-box'}}/>
              </div>
            </div>
          </div>
          {(symProps.type==='text'||symProps.type==='door'||symProps.type==='window')&&(
            <div style={{marginBottom:4}}>
              <div style={{fontSize:10,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:'#5b6a8a',marginBottom:5}}>Étiquette</div>
              <input type='text' value={symProps.text||''} placeholder="ex: Porte 90cm"
                onChange={e=>{
                  const v=e.target.value;
                  setSymProps(p=>({...p,text:v}));
                  setSymbols(s=>s.map(x=>x.id===symProps.id?{...x,text:v}:x));
                }}
                style={{width:'100%',background:'rgba(255,255,255,0.06)',border:'1px solid rgba(255,255,255,0.1)',
                  borderRadius:5,padding:'6px 8px',color:'#e8eaf0',fontFamily:'inherit',fontSize:12,boxSizing:'border-box'}}/>
            </div>
          )}
        </div>
      )}

      {/* ── Modal bibliothèque ── */}
      {showLibrary&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:2000,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={()=>setShowLibrary(false)}>
          <div style={{background:'#1e2336',borderRadius:14,padding:24,width:580,maxHeight:'85vh',
            overflow:'hidden',display:'flex',flexDirection:'column',border:'1px solid rgba(255,255,255,0.12)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:8}}>
              <div style={{fontSize:18,fontWeight:800,color:'#e8eaf0'}}>📚 Bibliothèque de symboles</div>
              <button onClick={()=>setShowLibrary(false)} style={{background:'transparent',border:'none',color:'#5b6a8a',fontSize:20,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{fontSize:12,color:'#5b6a8a',marginBottom:16}}>
              Cliquer sur un symbole pour l'insérer au centre de la vue. Il sera sélectionné — tu peux le déplacer immédiatement.
            </div>
            <div style={{flex:1,overflowY:'auto'}}>
              {['Sanitaires','Ouvertures','Structure','Mobilier','Équipements généraux','Électricité','Plomberie'].map(cat=>{
                const items=DXF_LIBRARY.filter(x=>x.category===cat);
                if(!items.length) return null;
                return(
                  <div key={cat} style={{marginBottom:20}}>
                    <div style={{fontSize:11,fontWeight:700,letterSpacing:2,textTransform:'uppercase',
                      color:'#5b6a8a',marginBottom:10,paddingBottom:6,borderBottom:'1px solid rgba(255,255,255,0.06)'}}>{cat}</div>
                    <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(130px,1fr))',gap:8}}>
                      {items.map(sym=>(
                        <button key={sym.id} onClick={()=>{
                          const canvas=canvasRef.current;
                          const cx=canvas?canvas.width/2:400, cy=canvas?canvas.height/2:300;
                          const {wx,wy}=toWorld(cx,cy);
                          const allX=sym.segments.flatMap(s=>[s.x1,s.x2]);
                          const allY=sym.segments.flatMap(s=>[s.y1,s.y2]);
                          const minX=Math.min(...allX),maxX=Math.max(...allX);
                          const minY=Math.min(...allY),maxY=Math.max(...allY);
                          const offX=wx-(minX+maxX)/2, offY=wy-(minY+maxY)/2;
                          const newSegs=sym.segments.map(s=>({
                            x1:s.x1+offX,y1:s.y1+offY,x2:s.x2+offX,y2:s.y2+offY,
                            color:'#e8eaf0',layer:'library',user:true,id:Date.now()+Math.random()
                          }));
                          pushHistory(segmentsRef.current,symbolsRef.current,cotesRef.current);
                          setSegments(s=>[...s,...newSegs]);
                          setSelectedIds(new Set(newSegs.map(s=>s.id)));
                          setShowLibrary(false);
                        }} style={{
                          background:'rgba(255,255,255,0.04)',border:'1px solid rgba(255,255,255,0.08)',
                          borderRadius:10,padding:'12px 8px',cursor:'pointer',
                          display:'flex',flexDirection:'column',alignItems:'center',gap:6,
                          fontFamily:'inherit',color:'#e8eaf0',transition:'all .15s',
                        }}
                        onMouseEnter={e=>{e.currentTarget.style.background='rgba(91,138,245,0.2)';e.currentTarget.style.borderColor='rgba(91,138,245,0.4)';}}
                        onMouseLeave={e=>{e.currentTarget.style.background='rgba(255,255,255,0.04)';e.currentTarget.style.borderColor='rgba(255,255,255,0.08)';}}>
                          <span style={{fontSize:26}}>{sym.icon}</span>
                          <span style={{fontSize:11,fontWeight:600,textAlign:'center',lineHeight:1.3}}>{sym.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── Modal import plan ── */}
      {showImportModal&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.75)',zIndex:2000,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}
          onClick={()=>setShowImportModal(false)}>
          <div style={{background:'#1e2336',borderRadius:14,padding:24,width:500,maxHeight:'80vh',
            overflow:'hidden',display:'flex',flexDirection:'column',border:'1px solid rgba(255,255,255,0.12)'}}
            onClick={e=>e.stopPropagation()}>
            <div style={{display:'flex',justifyContent:'space-between',alignItems:'center',marginBottom:16}}>
              <div style={{fontSize:18,fontWeight:800,color:'#e8eaf0'}}>⎘ Importer depuis un plan</div>
              <button onClick={()=>setShowImportModal(false)} style={{background:'transparent',border:'none',color:'#5b6a8a',fontSize:20,cursor:'pointer'}}>✕</button>
            </div>
            <div style={{fontSize:13,color:'#5b6a8a',marginBottom:16}}>
              Les éléments du plan sélectionné seront fusionnés dans le plan actuel. Ils seront sélectionnés après import, tu pourras les déplacer.
            </div>
            {importLoading&&<div style={{color:'#5b6a8a',textAlign:'center',padding:32}}>Chargement…</div>}
            <div style={{flex:1,overflowY:'auto',display:'flex',flexDirection:'column',gap:10}}>
              {importablePlans.map(p=>(
                <div key={p.id} style={{display:'flex',alignItems:'center',gap:12,padding:'10px 14px',
                  background:'rgba(255,255,255,0.04)',borderRadius:10,border:'1px solid rgba(255,255,255,0.08)',
                  cursor:'pointer',transition:'background .15s'}}
                  onMouseEnter={e=>e.currentTarget.style.background='rgba(91,138,245,0.15)'}
                  onMouseLeave={e=>e.currentTarget.style.background='rgba(255,255,255,0.04)'}
                  onClick={()=>importFromPlan(p)}>
                  {p.thumbnail
                    ?<img src={p.thumbnail} style={{width:64,height:48,objectFit:'contain',borderRadius:6,background:'#12151f',flexShrink:0}}/>
                    :<div style={{width:64,height:48,background:'#12151f',borderRadius:6,display:'flex',alignItems:'center',justifyContent:'center',fontSize:22,flexShrink:0}}>📐</div>
                  }
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontSize:14,fontWeight:700,color:'#e8eaf0',marginBottom:2}}>{p.name}</div>
                    <div style={{fontSize:11,color:'#5b6a8a'}}>
                      Modifié {new Date(p.updated_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                    </div>
                  </div>
                  <div style={{color:'#a0b8ff',fontSize:13,fontWeight:700,flexShrink:0}}>Importer →</div>
                </div>
              ))}
              {!importLoading&&importablePlans.length===0&&(
                <div style={{color:'#5b6a8a',textAlign:'center',padding:32}}>Aucun autre plan disponible.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ── Canvas ── */}
      <div style={{flex:1,position:'relative',minHeight:0,background:'#12151f',overflow:'hidden'}}>
        <canvas ref={canvasRef}
          style={{position:'absolute',top:0,left:0,right:0,bottom:0,width:'100%',height:'100%',
            background:'#12151f',display:'block',touchAction:'none',
            cursor:tool==='pan'?(dragRef.current?'grabbing':'grab')
              :tool==='select'?'crosshair'
              :tool==='delete'?'not-allowed'
              :tool==='line'?'crosshair'
              :'default'}}
          onMouseDown={onMouseDown}
          onMouseMove={onMouseMove}
          onMouseUp={onMouseUp}
          onMouseLeave={onMouseLeave}
          onWheel={onWheel}
          onTouchStart={onMouseDown}
          onTouchMove={onMouseMove}
          onTouchEnd={onMouseUp}
          onContextMenu={e=>e.preventDefault()}
        />
      </div>

      {/* ── Status bar ── */}
      <div style={{padding:'4px 14px',background:'#1a1f2e',borderTop:'1px solid rgba(255,255,255,0.06)',
        fontSize:11,color:'#5b6a8a',display:'flex',gap:16,flexShrink:0,flexWrap:'wrap'}}>
        <span>Outil : <strong style={{color:'#9aa5c0'}}>{TOOLS.find(t=>t.id===tool)?.label?.split('(')[0]||tool}</strong></span>
        {tool==='line'&&lineStart&&<span style={{color:'#a0b8ff'}}>Clic = point suivant · Échap = terminer</span>}
        {tool==='cote'&&measurePts.length===0&&<span>Clic sur le 1er point de la cote</span>}
        {tool==='cote'&&measurePts.length===1&&<span style={{color:'#f5d08a'}}>Clic sur le 2ème point</span>}
        {tool==='select'&&<span>Clic = sélectionner · Glisser = rectangle · Shift = ajouter · Suppr = effacer</span>}
        {tool==='surface'&&polyPoints.length===0&&<span style={{color:'#a0e0a0'}}>Clic = 1er point de la zone</span>}
        {tool==='surface'&&polyPoints.length>0&&<span style={{color:'#a0e0a0'}}>{polyPoints.length} points — clic sur ⭕ pour fermer · Échap = annuler</span>}
        {selCount>0&&<span style={{color:'#f5a623'}}>{selCount} élément{selCount>1?'s':''} sélectionné{selCount>1?'s':''} — Suppr pour effacer</span>}
        <span style={{marginLeft:'auto'}}>Clic molette = déplacer · Scroll = zoom · ? = raccourcis</span>
      </div>
    </div>
  );
}


// ─── PAGE PLANS ───────────────────────────────────────────────────────────────
function PagePlans({T, chantiers}) {
  const [plans, setPlans]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [editingPlan, setEditingPlan] = useState(null);
  const [showNew, setShowNew]       = useState(false);
  const [newName, setNewName]       = useState('');
  const [newChantier, setNewChantier] = useState('');
  const [creating, setCreating]     = useState(false);

  const loadPlans = async () => {
    setLoading(true);
    const {data} = await supabase.from('plans').select('*').order('updated_at',{ascending:false});
    setPlans(data||[]);
    setLoading(false);
  };

  useEffect(()=>{ loadPlans(); },[]);

  const createPlan = async () => {
    if (!newName.trim()) return;
    setCreating(true);
    const {data} = await supabase.from('plans').insert({
      name:newName.trim(), chantier_id:newChantier,
      data:{segments:[],symbols:[],viewport:{x:0,y:0,scale:1},threshold:0.5},
      thumbnail:'',
    }).select().single();
    if (data) { setPlans(p=>[data,...p]); setEditingPlan(data); }
    setNewName(''); setNewChantier(''); setShowNew(false); setCreating(false);
  };

  const deletePlan = async (id) => {
    if (!confirm('Supprimer ce plan définitivement ?')) return;
    await supabase.from('plans').delete().eq('id',id);
    setPlans(p=>p.filter(x=>x.id!==id));
  };

  const onSave = (updated) => {
    setPlans(p=>p.map(x=>x.id===updated.id?updated:x));
  };

  if (editingPlan) return (
    <div style={{flex:1,display:'flex',flexDirection:'column',minHeight:0,overflow:'hidden',width:'100%'}}>
      <PlanEditorErrorBoundary onClose={()=>{ setEditingPlan(null); loadPlans(); }}>
        <PlanEditor plan={editingPlan} onSave={onSave}
          onClose={()=>{ setEditingPlan(null); loadPlans(); }}
          T={T} chantiers={chantiers}/>
      </PlanEditorErrorBoundary>
    </div>
  );

  return (
    <div className="page-padding" style={{flex:1,overflowY:'auto',padding:'28px 32px'}}>
      <div style={{display:'flex',alignItems:'flex-start',justifyContent:'space-between',marginBottom:28,flexWrap:'wrap',gap:16}}>
        <div>
          <div style={{fontSize:36,fontWeight:800,letterSpacing:1,marginBottom:4,color:T.text}}>Plans</div>
          <div style={{fontSize:15,color:T.textSub}}>Relevés DXF annotés par chantier</div>
        </div>
        <button onClick={()=>setShowNew(true)} style={{background:T.accent,color:'#fff',border:'none',
          borderRadius:10,padding:'11px 22px',fontFamily:'inherit',fontSize:14,fontWeight:700,cursor:'pointer'}}>
          + Nouveau plan
        </button>
      </div>

      {showNew&&(
        <div style={{position:'fixed',inset:0,background:'rgba(0,0,0,0.7)',zIndex:500,
          display:'flex',alignItems:'center',justifyContent:'center',padding:16}}>
          <div style={{background:T.modal,borderRadius:14,padding:28,width:420,border:`1px solid ${T.border}`}}>
            <div style={{fontSize:20,fontWeight:800,marginBottom:20,color:T.text}}>Nouveau plan</div>
            <div style={{marginBottom:14}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:T.textMuted,marginBottom:6}}>Nom</div>
              <input value={newName} onChange={e=>setNewName(e.target.value)} autoFocus
                onKeyDown={e=>e.key==='Enter'&&createPlan()}
                placeholder="Ex: RDC — Alfred Falloux"
                style={{width:'100%',background:T.fieldBg,border:`1px solid ${T.fieldBorder}`,borderRadius:8,
                  padding:'10px 12px',color:T.text,fontFamily:'inherit',fontSize:14,outline:'none'}}/>
            </div>
            <div style={{marginBottom:22}}>
              <div style={{fontSize:11,fontWeight:700,letterSpacing:1,textTransform:'uppercase',color:T.textMuted,marginBottom:6}}>Chantier associé</div>
              <select value={newChantier} onChange={e=>setNewChantier(e.target.value)}
                style={{width:'100%',background:'#1e2336',border:`1px solid ${T.fieldBorder}`,borderRadius:8,
                  padding:'10px 12px',color:'#e8eaf0',fontFamily:'inherit',fontSize:14,outline:'none'}}>
                <option value="" style={{background:'#1e2336'}}>— Aucun —</option>
                {chantiers.map(c=><option key={c.id} value={c.id} style={{background:'#1e2336'}}>{c.nom}</option>)}
              </select>
            </div>
            <div style={{display:'flex',gap:10,justifyContent:'flex-end'}}>
              <button onClick={()=>setShowNew(false)} style={{background:'transparent',border:`1px solid ${T.border}`,
                borderRadius:8,padding:'9px 18px',color:T.textSub,fontFamily:'inherit',fontSize:13,cursor:'pointer'}}>Annuler</button>
              <button onClick={createPlan} disabled={creating||!newName.trim()} style={{background:T.accent,color:'#fff',
                border:'none',borderRadius:8,padding:'9px 20px',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer',
                opacity:(!newName.trim()||creating)?0.5:1}}>
                {creating?'Création…':'Créer'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading&&<div style={{color:T.textMuted,fontSize:15,padding:32}}>Chargement…</div>}

      {!loading&&plans.length===0&&(
        <div style={{background:T.card,border:`1px dashed ${T.border}`,borderRadius:14,
          padding:'48px 32px',textAlign:'center',maxWidth:520,margin:'0 auto'}}>
          <div style={{fontSize:48,marginBottom:16}}>📐</div>
          <div style={{fontSize:18,fontWeight:700,marginBottom:10,color:T.text}}>Aucun plan pour l'instant</div>
          <div style={{fontSize:14,color:T.textSub,lineHeight:1.8,marginBottom:24}}>
            Crée un plan, importe un fichier .DXF, et l'outil reliera automatiquement les points entre eux. Tu pourras ensuite ajouter des portes, fenêtres, annotations et exporter en PNG ou PDF.
          </div>
          <button onClick={()=>setShowNew(true)} style={{background:T.accent,color:'#fff',border:'none',
            borderRadius:10,padding:'12px 24px',fontFamily:'inherit',fontSize:14,fontWeight:700,cursor:'pointer'}}>
            + Créer mon premier plan
          </button>
        </div>
      )}

      {!loading&&plans.length>0&&(
        <div style={{display:'grid',gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))',gap:16}}>
          {plans.map(plan=>{
            const ch=chantiers.find(c=>c.id===plan.chantier_id);
            const segCount=plan.data?.segments?.filter(s=>!s.deleted)?.length||0;
            const symCount=plan.data?.symbols?.filter(s=>!s.deleted)?.length||0;
            return (
              <div key={plan.id} style={{background:T.surface,border:`1px solid ${T.border}`,
                borderRadius:14,overflow:'hidden',transition:'all .15s'}}
                onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent;e.currentTarget.style.transform='translateY(-2px)';e.currentTarget.style.boxShadow='0 8px 24px rgba(0,0,0,0.2)';}}
                onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border;e.currentTarget.style.transform='none';e.currentTarget.style.boxShadow='none';}}>

                <div onClick={()=>setEditingPlan(plan)} style={{cursor:'pointer',height:160,
                  background:'#12151f',overflow:'hidden',display:'flex',alignItems:'center',justifyContent:'center',
                  borderBottom:`1px solid ${T.border}`}}>
                  {plan.thumbnail
                    ? <img src={plan.thumbnail} style={{width:'100%',height:'100%',objectFit:'contain'}} alt=""/>
                    : <div style={{textAlign:'center'}}>
                        <div style={{fontSize:40,marginBottom:8}}>📐</div>
                        <div style={{fontSize:12,color:T.textMuted}}>Cliquer pour ouvrir</div>
                      </div>
                  }
                </div>

                <div style={{padding:'14px 16px'}}>
                  {ch&&<div style={{display:'inline-flex',alignItems:'center',gap:5,
                    background:ch.couleur+'33',border:`1px solid ${ch.couleur}55`,
                    borderRadius:5,padding:'2px 8px',fontSize:11,fontWeight:700,color:ch.couleur==='#fff'?'#333':ch.couleur,
                    marginBottom:6}}>{ch.nom}</div>}
                  <div style={{fontSize:15,fontWeight:700,color:T.text,marginBottom:4}}>{plan.name}</div>
                  <div style={{fontSize:12,color:T.textMuted}}>{segCount} segments · {symCount} symboles</div>
                  <div style={{fontSize:11,color:T.textMuted,marginTop:3}}>
                    Modifié {new Date(plan.updated_at).toLocaleDateString('fr-FR',{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}
                  </div>
                </div>

                <div style={{padding:'10px 16px',borderTop:`1px solid ${T.sectionDivider}`,
                  display:'flex',gap:8,justifyContent:'flex-end',flexWrap:'wrap'}}>
                  <button onClick={()=>setEditingPlan(plan)} style={{background:T.accent,color:'#fff',
                    border:'none',borderRadius:7,padding:'6px 16px',fontFamily:'inherit',fontSize:13,fontWeight:700,cursor:'pointer'}}>
                    Ouvrir
                  </button>
                  <button onClick={async()=>{
                    const nom=prompt(`Nom du nouveau plan (copie de "${plan.name}") :`, `${plan.name} — copie`);
                    if(!nom?.trim()) return;
                    const srcData=plan.data||{};
                    const reId=arr=>(arr||[]).map(x=>({...x,id:Date.now()+Math.random(),
                      ...(x.points?{points:x.points.map(p=>({...p}))}:{})}));
                    const newData={
                      segments: reId(srcData.segments),
                      symbols:  reId(srcData.symbols),
                      cotes:    reId(srcData.cotes),
                      surfaces: reId(srcData.surfaces),
                      viewport: srcData.viewport,
                      threshold: srcData.threshold,
                      planRotation: srcData.planRotation||0,
                    };
                    const{data:created}=await supabase.from('plans').insert({
                      name:nom.trim(), chantier_id:'',
                      data:newData, thumbnail:plan.thumbnail||'',
                    }).select().single();
                    if(created){ setPlans(p=>[created,...p]); setEditingPlan(created); }
                  }} title="Dupliquer ce plan (avant/après, copie, variante…)" style={{
                    background:'rgba(91,138,245,0.15)',border:'1px solid rgba(91,138,245,0.3)',
                    borderRadius:7,padding:'6px 12px',color:'#a0b8ff',
                    fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>
                    ⎘ Dupliquer
                  </button>
                  <button onClick={()=>deletePlan(plan.id)} style={{background:'transparent',
                    border:'1px solid rgba(224,92,92,0.3)',borderRadius:7,padding:'6px 12px',
                    color:'#e05c5c',fontFamily:'inherit',fontSize:12,cursor:'pointer'}}>
                    🗑
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default PagePlans;
