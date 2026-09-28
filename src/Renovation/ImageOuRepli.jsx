// Photo d'article, ou repli visible quand la photo n'existe pas.
//
// Le catalogue SIDER (28/09/2026) donne une adresse de photo à chaque article,
// construite sur le modèle media.sider.biz/images/400/<référence>_i_1.jpg. Or
// environ 3 articles sur 4 n'ont pas de photo à cette adresse (réponse 404,
// mesuré sur 100 articles tirés au hasard). Une image introuvable ne doit pas
// laisser une case vide ni une icône cassée : on affiche le repli, comme pour
// un article sans photo.
import React, { useState } from "react";

export default function ImageOuRepli({ src, alt, style, repli, ...autres }) {
  const [introuvable, setIntrouvable] = useState(false);
  if (!src || introuvable) return repli;
  return <img src={src} alt={alt} loading="lazy" style={style} onError={() => setIntrouvable(true)} {...autres}/>;
}
