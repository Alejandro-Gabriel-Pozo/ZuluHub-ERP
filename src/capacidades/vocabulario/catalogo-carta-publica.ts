import type { UsoDeTexto } from "./uso-y-fuente-de-texto";

const USO_EN_EL_LIBRO: UsoDeTexto = {
  como: "FUNCION",
  archivo: "apps/web/ui/plantillas/vidriera/PlantillaLibro.tsx",
  nombre: "PlantillaLibro",
};

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
  // «Conectá tu cuenta de fotos» (cuentas de imagen declaradas, 0102): PROPUESTA de la sesión de construcción, pendiente del OK del dueño (DEC-CAT-001). CD-2 y CD-4 no están; los errores son el genérico aprobado.
  "catalogo.cuentas_de_fotos.titulo": {
    porDefecto: "Conectá tu cuenta de fotos",
    fuente: { decision: "DEC-CAT-001" },
  },
  "catalogo.cuentas_de_fotos.cuenta": {
    porDefecto: "Pegá el nombre de tu cuenta",
    usos: [{ como: "DATO", dato: "cuenta-de-foto" }],
    fuente: { decision: "DEC-CAT-001" },
  },
  // Capa Libro (L1+L2a): inventario aceptado por el orquestador, ver DEC-CAT-003.
  "vidriera.libro.desliza": {
    porDefecto: "Desliza para ver el menú",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.indice": {
    porDefecto: "Índice",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.seccion_n_de_m": {
    porDefecto: "Sección {n} de {m}",
    marcadores: ["n", "m"],
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.anterior": {
    porDefecto: "Anterior",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.siguiente": {
    porDefecto: "Siguiente",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.ver_como_lista": {
    porDefecto: "Ver como lista",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
  "vidriera.libro.ver_como_libro": {
    porDefecto: "Ver como libro",
    usos: [USO_EN_EL_LIBRO],
    fuente: { decision: "DEC-CAT-003" },
  },
} as const;
