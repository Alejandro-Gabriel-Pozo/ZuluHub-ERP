import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LAS PANTALLAS DE NOTAS DEL PROVEEDOR (DDD:174: toda pantalla nueva nace con ficha; NOTAS-2c-1). Dos rutas nuevas: «Notas de la factura» (`/compras/facturas/[id]/notas`, pantalla 9 de la maqueta de Diseño 2) y
 * «Cargar una nota del proveedor» (`/compras/facturas/[id]/notas/nueva?clase=credito|debito`, pantalla 10), más lo que cambia en la ficha de la compra y en el detalle de la factura (el enlace «Notas de crédito», «Saldada por
 * notas» y el enlace «Pagar» oculto con neto cero). La comprueba `test/web/ficha-de-notas-de-compras.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos. Previene: un botón o un texto que nadie
 * aprobó, y una ruta que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`servicios-y-bienes-de-uso.html`, borrador: la maqueta manda y cada desvío lleva su fundamento; aceptadas por el orquestador el 26/11/2026):
 *  1. «Importe a pagar» es el neto del servidor (total menos notas de crédito): la nota de débito se paga aparte y NO entra (decisión del dueño Q-3, 25/11/2026; DEC-COM-010). La maqueta lo sumaba.
 *  2. Se omiten «Qué cambia al guardar» y «Bienes ya dados de alta» (sin texto aprobado; el segundo es de ACT-2) y los botones «Cargar nota de crédito/débito» van en la lista, no en el pie.
 *  3. La factura que la nota corrige viene fija de la ruta (sin selector) y una sola alícuota por nota; sumar filas pide un texto («Agregar») que nadie aprobó.
 *  4. El «Pagar» del dueño (26/11/2026, fila 13): con el neto en cero el enlace no se ofrece (el servidor sigue rechazando con el genérico); solo en la ficha de la compra (N1 y N2), el único lugar donde hoy hay «Pagar».
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace: Readonly<{ navega: string }> | Readonly<{ envia: ClaveAccion }>;
  /** Sin permiso el botón no se ofrece (denegar por defecto); el servidor vuelve a decidir al actuar. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeNotasDeCompras = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  /** La acción que exige la lectura de cada ruta. */
  accesos: Readonly<Record<string, readonly ClaveAccion[]>>;
  botones: readonly BotonDeFicha[];
  /** El error y la falta de permiso salen con el mensaje genérico aprobado; el que tiene texto propio es el de la nota ya descontada por un pago. */
  estados: Readonly<
    Record<
      "VIGENTE" | "ANULADA" | "SALDADA_POR_NOTAS" | "SALDO_A_FAVOR" | "SIN_PERMISO" | "ERROR",
      ClaveDeTexto
    >
  >;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño: confirmó el 26/11/2026 «Saldada por notas», «Saldo a favor» y el texto de la nota ya descontada (filas 12, 14 y 15, DEC-COM-014); las etiquetas simples las aceptó el orquestador por delegación (DEC-COM-012) y los dos rótulos de dinero los aprobó el dueño el 26/11/2026 (DEC-COM-013)",
  donde:
    "Pedernal-docs 11-especificaciones/briefs/maquetas/servicios-y-bienes-de-uso.html (pantallas 9 y 10) y briefs/notas-servicios-activos/PR-NOTAS-1-notas-de-credito-y-debito-con-pagos.md; decisiones-del-dueno-2026-11.md filas 173 y 174",
};
const USO = "apps/web/ui/plantillas/compras/notas/";

export const FICHA_DE_NOTAS_DE_COMPRAS = {
  archivos: [
    "apps/web/app/s/app/(operacion)/compras/facturas/[id]/notas/page.tsx",
    "apps/web/app/s/app/(operacion)/compras/facturas/[id]/notas/nueva/page.tsx",
    "apps/web/app/s/app/acciones-de-notas.ts",
    "apps/web/servidor/notas.ts",
    "apps/web/ui/plantillas/compras/rutas-de-compras.ts",
    "apps/web/ui/plantillas/compras/notas/FormularioDeCargarNota.cliente.tsx",
    "apps/web/ui/plantillas/compras/notas/PantallaDeNotas.tsx",
    "apps/web/ui/plantillas/compras/notas/modelo-de-notas.ts",
    "apps/web/ui/plantillas/compras/notas/modelo-de-pedido-de-nota.ts",
    "apps/web/ui/plantillas/compras/notas/textos-de-notas.ts",
    "src/composicion/entradas-de-notas.ts",
    "src/composicion/notas-web.ts",
  ],
  rutas: ["/compras/facturas/[id]/notas", "/compras/facturas/[id]/notas/nueva"],
  accesos: {
    "/compras/facturas/[id]/notas": [
      "notas_de_credito_de_proveedor.ver",
      "notas_de_debito_de_proveedor.ver",
    ],
    "/compras/facturas/[id]/notas/nueva": [
      "notas_de_credito_de_proveedor.registrar",
      "notas_de_debito_de_proveedor.registrar",
    ],
  },
  botones: [
    {
      id: "cargar-nota-de-credito",
      texto: "compras.factura.cargar_nota_de_credito",
      hace: { navega: "/compras/facturas/[id]/notas/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "cargar-nota-de-debito",
      texto: "compras.notas.cargar_nota_de_debito",
      hace: { navega: "/compras/facturas/[id]/notas/nueva" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar-nota-de-credito",
      texto: "catalogo.accion.guardar",
      hace: { envia: "notas_de_credito_de_proveedor.registrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "guardar-nota-de-debito",
      texto: "catalogo.accion.guardar",
      hace: { envia: "notas_de_debito_de_proveedor.registrar" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-nota-de-credito",
      texto: "ventas.ticket.anular",
      hace: { envia: "notas_de_credito_de_proveedor.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "anular-nota-de-debito",
      texto: "ventas.ticket.anular",
      hace: { envia: "notas_de_debito_de_proveedor.anular" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "enlace-a-las-notas",
      texto: "compras.factura.notas_de_credito",
      hace: { navega: "/compras/facturas/[id]/notas" },
      sinPermiso: "AUSENTE",
    },
  ],
  estados: {
    VIGENTE: "compras.notas.vigente",
    ANULADA: "compras.orden.anulada",
    SALDADA_POR_NOTAS: "compras.notas.saldada_por_notas",
    SALDO_A_FAVOR: "compras.notas.saldo_a_favor",
    SIN_PERMISO: "compras.error.sin_permiso",
    ERROR: "compras.error.sin_permiso",
  },
  textos: {
    "compras.notas.titulo": {
      usos: [`${USO}textos-de-notas.ts`, "título de «Notas de la factura»"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.cargar_titulo": {
      usos: [`${USO}textos-de-notas.ts`, "título de «Cargar una nota del proveedor»"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.total_de_la_factura": {
      usos: ["rótulo del total de la factura en «Notas de la factura»"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.creditos_vigentes": {
      usos: ["rótulo de lo que acreditan las notas de crédito vigentes"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.debitos_vinculados": {
      usos: ["rótulo de lo que suman las notas de débito vinculadas"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.importe_a_pagar": {
      usos: ["rótulo del neto de la factura que calcula el servidor"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.todavia_se_puede_acreditar": {
      usos: ["rótulo del tope de lo acreditable en «Cargar nota de crédito»"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.saldada_por_notas": {
      usos: [
        "estado de la factura con neto cero, en «Notas de la factura» y en la ficha de la compra",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.saldo_a_favor": {
      usos: ["estado de la factura con un pago mayor que el neto de hoy (informativo)"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.cargar_nota_de_debito": {
      usos: ["botón de «Notas de la factura» hacia la carga de una nota de débito"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.vigente": {
      usos: ["estado de una nota vigente"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.notas.total_de_la_nota": {
      usos: ["rótulo del total que dice el papel de la nota"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.error.nota_con_pago": {
      usos: ["error al anular una nota de crédito que un pago ya descontó"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.cargar_nota_de_credito": {
      usos: ["botón de «Notas de la factura» hacia la carga de una nota de crédito"],
      fuente: DE_LA_MAQUETA,
    },
    "compras.factura.notas_de_credito": {
      usos: [
        "enlace de la ficha de la compra y del detalle de la factura hacia «Notas de la factura»",
      ],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.ticket.anular": {
      usos: ["botón de la hoja de anular una nota"],
      fuente: DE_LA_MAQUETA,
    },
    "catalogo.accion.guardar": { usos: ["botón que guarda la nota"], fuente: DE_LA_MAQUETA },
    "compras.orden.anulada": { usos: ["estado de una nota anulada"], fuente: DE_LA_MAQUETA },
    "compras.error.sin_permiso": {
      usos: ["cualquier error de las pantallas (el genérico, interfaz sobria)"],
      fuente: DE_LA_MAQUETA,
    },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeNotasDeCompras;
