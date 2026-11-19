import type { ClaveAccion } from "../modulos/catalogo";
import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * LA FICHA DE LA PANTALLA «COBRAR» DEL MOSTRADOR (DDD:174: toda pantalla nueva nace con ficha). Es la vista de cobro dentro de la venta rápida (`/ventas/venta-rapida`): la barra de la venta (aviso de caja y «Cobrar»),
 * la vista «Cobro», la vista «Resultado» y el cuadro de «Anular». Declara los archivos, los botones con la acción de permiso que cada uno envía, los estados y cada texto con SU uso y SU fuente. Es solo una declaración:
 * la comprueba `test/web/ficha-de-cobrar.test.ts` contra el catálogo de textos y el de permisos. No crea acciones ni permisos.
 * Previene: un botón o un texto que nadie aprobó, y una acción de permiso que se mueve sin que la ficha lo note.
 *
 * DIFERENCIAS CON LA MAQUETA (`venta-rapida-v4.html`; la maqueta manda: cada desvío lleva su fundamento y lo decide el dueño):
 *  1. «Abrir caja»: la maqueta lo lleva a una pantalla «Abrir caja» con «Fondo inicial» dentro de la venta; acá es un enlace a la pantalla de Caja (`/caja`), solo para quien puede abrirla (`sesiones_caja.abrir`; DEC-0502).
 *     Fundamento: la pantalla de Caja ya existe y es el único lugar que abre sesiones. Costo de cambiarlo: un PR aparte (PR-3c). SUPUESTO (DEC-0770), lo decide el dueño.
 *  2. «El precio cambió»: la maqueta lo avisa en la cuenta; el servidor no distingue ese rechazo y todo rechazo de negocio sale como «No se pudo cobrar. No se cobró nada.». Necesita un código público nuevo.
 *  3. «Sin elegir» en la cuenta de cobro, sin «= $ …» bajo el importe, «Enviando…» en el botón y sin edición con un envío sin respuesta: conservados (DDD:298, aceptados por el dueño el 18/11).
 *  4. Datos del cobro (cupón, últimos 4, marca, cuotas, DNI): todos «(opcional)»; el sistema registra y no bloquea por un dato que falta (criterio permisivo del dueño, 18/11/2026).
 *  5. Con el día en cierre o cerrado las tarjetas de producto se apagan (maqueta `bloqueaAgregar`): es la integridad de la jornada, no un control de la empresa.
 */

type FuenteDeTexto = Readonly<{ decidio: string; donde: string }>;
type TextoDeFicha = Readonly<{ usos: readonly string[]; fuente: FuenteDeTexto }>;
type BotonDeFicha = Readonly<{
  id: string;
  texto: ClaveDeTexto;
  hace:
    | Readonly<{ navega: string }>
    | Readonly<{ envia: ClaveAccion }>
    | "abre-la-vista"
    | "vuelve"
    | "abre-el-cuadro"
    | "agrega-una-fila";
  /** Qué se ve sin el permiso o sin caja: el botón apagado es solo una ayuda; decide el servidor. */
  sinPermiso: "APAGADO" | "AUSENTE";
}>;

export type FichaDeCobrar = Readonly<{
  archivos: readonly string[];
  rutas: readonly string[];
  botones: readonly BotonDeFicha[];
  /** Todo rechazo de negocio del cobro sale como «No se pudo cobrar. No se cobró nada.»; el resto, con el genérico. */
  estados: Readonly<Record<"RECHAZO_DEL_COBRO" | "SIN_CAJA" | "SIN_PERMISO", string>>;
  textos: Readonly<Partial<Record<ClaveDeTexto, TextoDeFicha>>>;
  estadoDeLaFicha: "EN_CONSTRUCCION" | "TERMINADA";
}>;

const DE_LA_MAQUETA: FuenteDeTexto = {
  decidio:
    "el dueño, 09/11/2026 (aprobó la versión anterior de la venta rápida), 15/11/2026 (aceptó los textos propuestos, fila 171) y 18/11/2026 (regla «manda la maqueta», fila 294); decisiones-del-dueno-2026-11.md",
  donde:
    "Pedernal-docs 10-ux-ui/prototipos-gastronomia/venta-rapida-v4.html (vCobro, vResultado, vDlg, franjaCaja); DEC-0500 y DEC-0769",
};
const USO = "apps/web/ui/plantillas/cobrar/";

export const FICHA_DE_COBRAR = {
  archivos: [
    "apps/web/app/s/app/(operacion)/ventas/venta-rapida/page.tsx",
    "apps/web/app/s/app/acciones-de-cobrar.ts",
    "apps/web/servidor/cobrar.ts",
    "apps/web/ui/plantillas/venta/PantallaDeVentaRapida.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/PantallaDeCobro.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/FilaDeCobro.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/DatosDelMedio.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/ResultadoDelCobro.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/AnularElTicket.cliente.tsx",
    "apps/web/ui/plantillas/cobrar/modelo-de-cobro.ts",
    "apps/web/ui/plantillas/cobrar/textos-de-cobrar.ts",
  ],
  rutas: ["/ventas/venta-rapida"],
  botones: [
    {
      id: "cobrar-de-la-barra",
      texto: "ventas.cobro.cobrar",
      hace: "abre-la-vista",
      sinPermiso: "APAGADO",
    },
    {
      id: "abrir-caja",
      texto: "caja.sesion.abrir",
      hace: { navega: "/caja" },
      sinPermiso: "AUSENTE",
    },
    {
      id: "volver-a-la-cuenta",
      texto: "ventas.cobro.volver_a_la_cuenta",
      hace: "vuelve",
      sinPermiso: "APAGADO",
    },
    {
      id: "agregar-otro-medio",
      texto: "ventas.cobro.agregar_otro_medio",
      hace: "agrega-una-fila",
      sinPermiso: "APAGADO",
    },
    {
      id: "cobrar",
      texto: "ventas.cobro.cobrar",
      hace: { envia: "tickets.cobrar" },
      sinPermiso: "APAGADO",
    },
    {
      id: "volver-al-cobro",
      texto: "ventas.cobro.volver_al_cobro",
      hace: "vuelve",
      sinPermiso: "APAGADO",
    },
    { id: "anular", texto: "ventas.ticket.anular", hace: "abre-el-cuadro", sinPermiso: "APAGADO" },
    {
      id: "anular-ok",
      texto: "ventas.ticket.anular",
      hace: { envia: "tickets.corregir" },
      sinPermiso: "APAGADO",
    },
    { id: "nueva-venta", texto: "ventas.venta.nueva", hace: "vuelve", sinPermiso: "APAGADO" },
  ],
  estados: {
    RECHAZO_DEL_COBRO: "ventas.cobro.no_se_pudo",
    SIN_CAJA: "ventas.cobro.abri_la_caja",
    SIN_PERMISO: "ventas.error.accion_no_permitida",
  },
  textos: {
    "ventas.cobro.cobrar": {
      usos: [`${USO}textos-de-cobrar.ts`, "botón de la barra y de la vista"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.titulo": { usos: ["título de la vista de cobro"], fuente: DE_LA_MAQUETA },
    "ventas.cobro.volver_a_la_cuenta": {
      usos: ["«‹» de la barra de la vista"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.resultado": { usos: ["título de la vista de resultado"], fuente: DE_LA_MAQUETA },
    "ventas.cobro.no_se_pudo": {
      usos: ["aviso del resultado de un rechazo"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.volver_al_cobro": {
      usos: ["botón del resultado de un rechazo"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.cobro.abri_la_caja": { usos: ["aviso de la barra de la venta"], fuente: DE_LA_MAQUETA },
    "ventas.cobro.agregar_otro_medio": { usos: ["botón de la vista"], fuente: DE_LA_MAQUETA },
    "ventas.ticket.anular": {
      usos: ["botón del resultado", "título y botón del cuadro"],
      fuente: DE_LA_MAQUETA,
    },
    "ventas.venta.nueva": { usos: ["botón del resultado"], fuente: DE_LA_MAQUETA },
    "ventas.error.accion_no_permitida": {
      usos: ["aviso de la barra y errores sueltos"],
      fuente: DE_LA_MAQUETA,
    },
    "caja.sesion.abrir": { usos: ["enlace del aviso de la barra"], fuente: DE_LA_MAQUETA },
  },
  estadoDeLaFicha: "EN_CONSTRUCCION",
} as const satisfies FichaDeCobrar;
