import type { FichaDePantalla } from "./ficha-de-mesas";

/**
 * LAS FICHAS DE LOS FORMULARIOS DE MOVIMIENTOS DE STOCK (STK-B2, FP-STK-04 a FP-STK-07; DDD:174): Entrada, Salida, Transferir, Ajustar y Anular. Comparten un formulario (`FormularioDeMovimiento.cliente.tsx`) y
 * una pantalla armadora; cada una declara su ruta, su permiso, su botón y sus textos con uso y fuente. «Registrar» y «Anular» salen apagados sin permiso (el servidor igual decide). Los errores salen con el
 * genérico salvo los que tienen texto propio (cantidad inválida, detalle requerido, transferencia al mismo depósito, el control de negativos). Previene: un botón o un texto que nadie aprobó.
 */

const MAQUETA = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la tabla «Textos nuevos» de la maqueta `stock.html`; decisión D125 de Pedernal-docs 11-especificaciones/decisiones-del-dueno-2026-11.md)",
  donde:
    "Pedernal-docs 10-ux-ui, maqueta stock.html (tabla «Textos nuevos», filas «Acciones», «Motivos» y «Errores y avisos»)",
} as const;
const NUEVOS = {
  decidio:
    "por delegación del dueño (fila 173) el orquestador aceptó «Artículo» (N-01); «Falta» (N-15) lo aprobó el dueño el 25/11/2026 (fila 449); «Sobra» lo aprobó el dueño el 15/11/2026 (DEC-1024)",
  donde:
    "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md (N-01, N-15 y «Sobra»); arquitectura/decisiones/registro/DEC-1024.json",
} as const;
const YA_APROBADO = {
  decidio:
    "el dueño, 09/11/2026 y 12/11/2026 (maqueta de productos aprobada); por delegación (fila 173) el orquestador acepta los textos ya aprobados",
  donde: "Pedernal-docs 11-especificaciones/dia-uno-stock-inventario-de-textos-2026-11-25.md §1.7",
} as const;

const ARCHIVOS = [
  "apps/web/pantallas/pantalla-de-movimiento.tsx",
  "apps/web/ui/plantillas/stock/movimientos/FormularioDeMovimiento.cliente.tsx",
  "apps/web/ui/plantillas/stock/movimientos/modelo-de-formularios.ts",
] as const;
const USO = "FormularioDeMovimiento.cliente.tsx";
const COMUNES = {
  "stock.accion.cantidad": { usos: [USO], fuente: MAQUETA },
  "stock.accion.registrar": { usos: [USO + " (botón)"], fuente: MAQUETA },
  "catalogo.accion.cancelar": { usos: [USO], fuente: YA_APROBADO },
  "stock.error.cantidad_invalida": {
    usos: ["cantidad que no es mayor que cero o con demasiados decimales"],
    fuente: MAQUETA,
  },
  "stock.error.sin_permiso": { usos: ["todo otro rechazo"], fuente: MAQUETA },
} as const;

export const FICHA_DE_ENTRADA = {
  archivos: [...ARCHIVOS, "apps/web/app/s/app/(operacion)/stock/movimientos/entrada/page.tsx"],
  rutas: ["/stock/movimientos/entrada"],
  titulo: "stock.accion.entrada",
  acceso: "stock.ver",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "stock.registrar_entrada" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    ...COMUNES,
    "stock.accion.entrada": { usos: ["título de la pantalla"], fuente: MAQUETA },
    "stock.pantalla.depositos": { usos: [USO + " (rótulo del depósito)"], fuente: MAQUETA },
    "stock.accion.articulo": { usos: [USO], fuente: NUEVOS },
    "stock.accion.motivo": { usos: [USO], fuente: MAQUETA },
    "stock.accion.costo_por_unidad": {
      usos: [USO + " (solo con el motivo Compra)"],
      fuente: MAQUETA,
    },
    "catalogo.campo.opcional": { usos: [USO + " (ayuda del costo)"], fuente: YA_APROBADO },
    "stock.accion.detalle": { usos: [USO], fuente: MAQUETA },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_SALIDA = {
  archivos: [...ARCHIVOS, "apps/web/app/s/app/(operacion)/stock/movimientos/salida/page.tsx"],
  rutas: ["/stock/movimientos/salida"],
  titulo: "stock.accion.salida",
  acceso: "stock.ver",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "stock.registrar_salida" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    ...COMUNES,
    "stock.accion.salida": { usos: ["título de la pantalla"], fuente: MAQUETA },
    "stock.pantalla.depositos": { usos: [USO + " (rótulo del depósito)"], fuente: MAQUETA },
    "stock.accion.articulo": { usos: [USO], fuente: NUEVOS },
    "stock.accion.motivo": { usos: [USO], fuente: MAQUETA },
    "stock.accion.detalle": { usos: [USO], fuente: MAQUETA },
    "stock.error.control_avisa": {
      usos: ["el servidor avisa que va a quedar en negativo (no aparece con el nivel «Permitir»)"],
      fuente: MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_TRANSFERIR = {
  archivos: [...ARCHIVOS, "apps/web/app/s/app/(operacion)/stock/movimientos/transferir/page.tsx"],
  rutas: ["/stock/movimientos/transferir"],
  titulo: "stock.accion.transferir",
  acceso: "stock.ver",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "stock.transferir" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    ...COMUNES,
    "stock.accion.transferir": { usos: ["título de la pantalla"], fuente: MAQUETA },
    "stock.accion.origen": { usos: [USO], fuente: MAQUETA },
    "stock.accion.destino": { usos: [USO], fuente: MAQUETA },
    "stock.accion.articulo": { usos: [USO], fuente: NUEVOS },
    "stock.error.transferencia_al_mismo_deposito": {
      usos: ["origen y destino iguales"],
      fuente: MAQUETA,
    },
    "stock.error.control_avisa": {
      usos: ["el servidor avisa que va a quedar en negativo (no aparece con el nivel «Permitir»)"],
      fuente: MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_AJUSTAR = {
  archivos: [...ARCHIVOS, "apps/web/app/s/app/(operacion)/stock/movimientos/ajustar/page.tsx"],
  rutas: ["/stock/movimientos/ajustar"],
  titulo: "stock.accion.ajustar",
  acceso: "stock.ver",
  botones: [
    {
      id: "registrar",
      texto: "stock.accion.registrar",
      hace: { envia: "stock.ajustar" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    ...COMUNES,
    "stock.accion.ajustar": {
      usos: ["título de la pantalla y rótulo del sentido"],
      fuente: MAQUETA,
    },
    "stock.pantalla.depositos": { usos: [USO + " (rótulo del depósito)"], fuente: MAQUETA },
    "stock.accion.articulo": { usos: [USO], fuente: NUEVOS },
    "stock.ajuste.sobra": { usos: [USO + " (sentido: suma)"], fuente: NUEVOS },
    "stock.ajuste.falta": { usos: [USO + " (sentido: resta)"], fuente: NUEVOS },
    "stock.accion.detalle": { usos: [USO + " (obligatorio)"], fuente: MAQUETA },
    "stock.error.detalle_requerido": { usos: ["ajustar o anular sin detalle"], fuente: MAQUETA },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;

export const FICHA_DE_ANULAR = {
  archivos: [...ARCHIVOS, "apps/web/app/s/app/(operacion)/stock/movimientos/[id]/anular/page.tsx"],
  rutas: ["/stock/movimientos/[id]/anular"],
  titulo: "stock.accion.anular",
  acceso: "stock.ver",
  botones: [
    {
      id: "anular",
      texto: "stock.accion.anular",
      hace: { envia: "stock.anular" },
      sinPermiso: "APAGADO",
    },
  ],
  estados: { ERROR: "GENERICO", SIN_PERMISO: "GENERICO" },
  textos: {
    "stock.accion.anular": { usos: ["título de la pantalla y botón"], fuente: MAQUETA },
    "stock.accion.detalle": { usos: [USO + " (obligatorio)"], fuente: MAQUETA },
    "catalogo.accion.cancelar": { usos: [USO], fuente: YA_APROBADO },
    "stock.error.detalle_requerido": { usos: ["anular sin detalle"], fuente: MAQUETA },
    "stock.error.sin_permiso": {
      usos: ["todo otro rechazo (ya anulado, no anulable, inexistente)"],
      fuente: MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDePantalla;
