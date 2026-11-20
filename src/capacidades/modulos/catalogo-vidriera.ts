/**
 * La carta: una vista publicada del catálogo, que es otro módulo comercial pero lo implementa el
 * mismo código (`modulos/catalogo`). Sola, sin stock ni ventas, es la vidriera (§F8). La publicación
 * en línea (QR) es un extra de pago: lo decide la perilla `vidriera_por_qr`, que se declara cuando se
 * construya la carta; las tres acciones `*_en_linea` y `renovar_enlace` ya se clasifican acá.
 */
export const MODULO_DE_VIDRIERA = {
  estado: "en_desarrollo",
  obligatorio: false,
  requiere: ["catalogo"],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/catalogo"],
  acciones: {
    "vidrieras.ver": { capacidad: null, efecto: "LECTURA" },
    "vidrieras.marcar_disponibilidad": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.ocultar_en_empresa": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.publicar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.retirar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "vidrieras.publicar_en_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.renovar_enlace": { capacidad: null, efecto: "CREA_AMPLIA" },
    "vidrieras.retirar_de_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "vidrieras.administrar_portal": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
