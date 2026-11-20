/**
 * Los textos de la carta pública (C-2): lo que lee el comensal. En su archivo para que `catalogo.ts` no pase el tope de líneas; `CATALOGO_DE_TEXTOS` los suma con un spread.
 */
export const TEXTOS_DE_CARTA_PUBLICA = {
  // Carta pública (C-2): lo que lee el comensal. La interfaz recibe estos textos ya resueltos.
  "vidriera.letra.etiqueta": { porDefecto: "Letra" },
  "vidriera.letra.grupo": { porDefecto: "Tamaño de la letra" },
  "vidriera.letra.normal": { porDefecto: "Letra normal" },
  "vidriera.letra.grande": { porDefecto: "Letra grande" },
  "vidriera.letra.muy_grande": { porDefecto: "Letra muy grande" },
  "vidriera.buscar.etiqueta": { porDefecto: "Buscar en la carta" },
  "vidriera.buscar.un_resultado": { porDefecto: "1 resultado" },
  "vidriera.buscar.resultados": { porDefecto: "{cantidad} resultados", marcadores: ["cantidad"] },
  "vidriera.buscar.sin_resultados": {
    porDefecto: "No hay nada que diga «{texto}».",
    largoMaximo: 120,
    marcadores: ["texto"],
  },
  "vidriera.buscar.limpiar": { porDefecto: "Limpiar búsqueda" },
  "vidriera.indice.titulo": { porDefecto: "Secciones" },
  "vidriera.indice.ir": { porDefecto: "Ir al índice de secciones" },
  "vidriera.producto.agotado": { porDefecto: "Agotado" },
  "vidriera.producto.precios": { porDefecto: "Precios" },
  "vidriera.producto.cerrar": { porDefecto: "Cerrar" },
  "vidriera.producto.volver": { porDefecto: "Volver a la carta" },
  "vidriera.producto.ver_toda": { porDefecto: "Ver toda la carta" },
  "vidriera.producto.compartir": { porDefecto: "Compartir" },
  "vidriera.producto.enlace_copiado": { porDefecto: "Enlace copiado" },
  "vidriera.producto.enlace_no_copiado": {
    porDefecto: "No se pudo copiar el enlace. Probá de nuevo.",
    largoMaximo: 120,
  },
  "vidriera.producto.no_esta": { porDefecto: "Este producto ya no está en la carta." },
  "vidriera.pie.iva": { porDefecto: "Los precios incluyen IVA." },
} as const;
