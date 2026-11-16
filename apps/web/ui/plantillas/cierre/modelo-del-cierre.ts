import type { CierreParaLaPantalla } from "../../../../../src/capacidades/experiencia/vista-del-cierre";
import type { ClaveDeTexto } from "../../../../../src/capacidades/vocabulario/catalogo";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { fechaCivilDesdeTexto } from "../../../../../src/primitivas/tiempo/fecha-civil";
import { fechaParaMostrar } from "../../../../../src/primitivas/tiempo/fecha-para-mostrar";
import { instanteParaMostrar } from "../../../../../src/primitivas/tiempo/instante-para-mostrar";
import type { TonoDeEstado } from "../../componentes/Insignia";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { nombreDelTipo } from "../caja/modelo-de-medios-de-pago";

/**
 * El modelo de vista de «Cierre del día» (maqueta aceptada `cierre-del-dia.html`, tres pasos; `Pedernal-docs/11-especificaciones/conceptos/pantalla-cierre-del-dia.md`): de lo que entrega
 * la composición (`cargarElCierre`), lo que se ve en cada paso. Puro: sin React ni servidor. Los textos salen del catálogo (`cierre.*`, con su fuente en `catalogo-cierre.ts`); no se arma
 * ningún texto nuevo acá, solo se eligen y se unen los aprobados como lo hace la maqueta. Todo nace cerrado:
 *  - un control solo se muestra si tiene su texto aprobado (`TEXTO_DE_CONTROL`); los tres de stock NO se muestran en esta primera versión (DDD:183: no tienen texto aprobado); cualquier
 *    OTRO control sin texto hace fallar el modelo entero (`CONTROL_SIN_TEXTO`): no se esconde algo que impide cerrar o hay que reconocer, y la pantalla sale con el genérico;
 *  - un estado de jornada que la pantalla no conoce hace fallar el modelo; `SIN_ACTIVIDAD` se ve como «Abierta» (la jornada nace con la primera actividad: «Empezar el cierre»
 *    recibe el genérico del servidor) y no ofrece nada más;
 *  - los botones salen apagados sin el permiso de su acción (`AccionesDelCierre`): una ayuda, el servidor decide al enviar.
 */

/** Qué botones se ofrecen activos hoy, según lo que el SERVIDOR deja hacer (`servidor/modulos.ts`). Sin permisos leídos, todo apagado. */
export type AccionesDelCierre = Readonly<{
  empezar: boolean;
  cancelar: boolean;
  cerrar: boolean;
  corregirMedio: boolean;
  /** Declarar el total de un medio y dar el «Conforme general» (la misma acción, `declaraciones_de_total.registrar`). */
  declarar: boolean;
}>;

/**
 * El texto aprobado de cada control de caja y de ventas, por la clave que le da el servidor. Una prueba (`test/web/modelo-del-cierre.test.ts`) la compara con los controles que declaran los
 * módulos: un control nuevo de caja o de ventas sin texto no pasa.
 */
export const TEXTO_DE_CONTROL = {
  "caja.sesiones_sin_cerrar": "cierre.control.sesiones_sin_cerrar",
  "caja.diferencia_de_arqueo": "cierre.control.diferencia_de_arqueo",
  "caja.conciliacion_por_medio": "cierre.control.conciliacion_por_medio",
  "caja.cobrado_contra_ticket": "cierre.control.cobrado_contra_ticket",
  "caja.cobros_corregidos": "cierre.control.cobros_corregidos",
  "caja.ajustes_a_jornadas_cerradas": "cierre.control.ajustes_a_jornadas_cerradas",
  "ventas.cuentas_abiertas": "cierre.control.cuentas_abiertas",
  "ventas.tickets_por_cobrar": "cierre.control.tickets_por_cobrar",
  "ventas.cortesias": "cierre.control.cortesias",
  "ventas.anulaciones": "cierre.control.anulaciones",
  "ventas.correcciones": "cierre.control.correcciones",
  "ventas.pendientes_de_facturar": "cierre.control.pendientes_de_facturar",
} as const satisfies Readonly<Record<string, ClaveDeTexto>>;

/** Los controles que el servidor da y esta versión NO muestra (DDD:183, DEC-0514): los tres de stock, que solo informan y no tienen texto aprobado. */
export const CONTROLES_QUE_NO_SE_MUESTRAN: ReadonlySet<string> = new Set([
  "stock.conteos_abiertos",
  "stock.existencias_negativas",
  "stock.lotes_vencidos_con_existencia",
]);

export type ControlVisto = Readonly<{
  /** La clave del control del servidor: con ella se manda el reconocimiento. */
  clave: string;
  modulo: string;
  rotulo: string;
  cantidad: number;
  /** Las filas de «Cobrado contra el ticket» («Ticket 7 · Diferencia $ 2.000,00»); vacío en los demás. */
  detalle: readonly string[];
  /** Solo con el día cerrado y el control reconocido: «Reconocido por … · …». */
  constancia: string | null;
  /** La observación con que se reconoció (solo cerrada). */
  observacion: string | null;
}>;

export type LineaVista = Readonly<{
  /** Estable: el medio y la cuenta. */
  clave: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  titulo: string;
  cuenta: string | null;
  registrado: string;
  /** Solo si hubo correcciones (si valen cero, la fila no se dibuja). */
  correcciones: string | null;
  /** El efectivo (contado por billetes) y los medios ya declarados muestran su total; el resto se declara en el campo. */
  declarado: string | null;
  /** Se puede escribir el total (no es efectivo) y declarar. */
  declarable: boolean;
  /** El texto decimal canónico del total declarado, para precargar el campo (`""` si no hay). */
  declaradoCanonico: string;
  diferencia: string;
  tonoDeDiferencia: "peligro" | "aviso" | "neutro";
}>;

export type CobroVisto = Readonly<{
  cobroId: string;
  importe: string;
  /** El medio y la cuenta VIGENTES: el diálogo «Corregir medio» no ofrece el mismo par. */
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  medio: string;
  registradoPor: string | null;
  puedeCorregir: boolean;
  corregidoPor: string | null;
  motivo: string | null;
}>;

export type MedioVisto = Readonly<{
  medioDePagoId: string;
  titulo: string;
  /** Las cuentas activas de la sucursal que el medio admite (`id` y nombre). Vacío si el medio no lleva cuenta. */
  cuentas: readonly Readonly<{ id: string; nombre: string }>[];
}>;

export type ModeloDelCierre = Readonly<{
  fechaDeNegocio: string;
  fecha: string;
  estado: "ABIERTA" | "EN_AUDITORIA" | "CERRADA";
  etiquetaDeEstado: string;
  tonoDeEstado: TonoDeEstado;
  /** La franja «Cerrada»: «persona · fecha y hora» (solo con el día cerrado y la persona conocida). */
  cerradaPor: string | null;
  huella: string;
  bloquean: readonly ControlVisto[];
  porReconocer: readonly ControlVisto[];
  informan: readonly ControlVisto[];
  lineas: readonly LineaVista[] | null;
  cobros: readonly CobroVisto[] | null;
  hayMasCobros: boolean;
  medios: readonly MedioVisto[];
  acciones: AccionesDelCierre;
}>;

export type ErrorDelModelo = "FECHA_INVALIDA" | "ESTADO_DESCONOCIDO" | "CONTROL_SIN_TEXTO";

const ESTADO_DE_LA_PANTALLA = {
  SIN_ACTIVIDAD: "ABIERTA",
  ABIERTA: "ABIERTA",
  EN_AUDITORIA: "EN_AUDITORIA",
  CERRADA: "CERRADA",
} as const;

const ETIQUETA_DE_ESTADO = {
  ABIERTA: "cierre.estado.abierta",
  EN_AUDITORIA: "cierre.estado.en_auditoria",
  CERRADA: "cierre.estado.cerrada",
} as const satisfies Readonly<Record<ModeloDelCierre["estado"], ClaveDeTexto>>;

const TONO_DE_ESTADO = {
  ABIERTA: "exito",
  EN_AUDITORIA: "aviso",
  CERRADA: "exito",
} as const satisfies Readonly<Record<ModeloDelCierre["estado"], TonoDeEstado>>;

const esCero = (monto: string): boolean => /^-?0+(\.0+)?$/.test(monto);

/** El texto de un control de la tabla aprobada; `null` si el control no está. */
function claveDeTextoDe(clave: string): ClaveDeTexto | null {
  return Object.hasOwn(TEXTO_DE_CONTROL, clave)
    ? TEXTO_DE_CONTROL[clave as keyof typeof TEXTO_DE_CONTROL]
    : null;
}

/** «Reconocido por {persona} · {fecha y hora}», o `null` si la persona no se conoce (no se inventa un nombre). */
const lineaDeQuien = (
  clave: ClaveDeTexto,
  quien: string | null,
  cuando: string | null,
): string | null =>
  quien === null || cuando === null
    ? null
    : texto({}, clave, { persona: quien, cuando: instanteParaMostrar(new Date(cuando)) });

function armarLosControles(
  cierre: CierreParaLaPantalla,
):
  | Readonly<{ ok: true; controles: readonly (ControlVisto & Readonly<{ severidad: string }>)[] }>
  | Readonly<{ ok: false }> {
  const filasDeTicket = (cierre.conciliacion?.cobradoContraTicket ?? []).map((t) =>
    t.ticketNumero === null
      ? `${texto({}, "cierre.conciliacion.diferencia")} ${formatearImporte(t.diferencia)}`
      : `${texto({}, "cierre.ticket_numero", { numero: String(t.ticketNumero) })} · ${texto({}, "cierre.conciliacion.diferencia")} ${formatearImporte(t.diferencia)}`,
  );
  const controles: (ControlVisto & Readonly<{ severidad: string }>)[] = [];
  for (const c of cierre.controles) {
    if (c.cantidad <= 0 || CONTROLES_QUE_NO_SE_MUESTRAN.has(c.clave)) continue;
    const clave = claveDeTextoDe(c.clave);
    if (clave === null) return { ok: false };
    controles.push({
      clave: c.clave,
      modulo: c.modulo,
      severidad: c.severidad,
      rotulo: texto({}, clave),
      cantidad: c.cantidad,
      detalle: c.clave === "caja.cobrado_contra_ticket" ? filasDeTicket : [],
      constancia: c.reconocido
        ? lineaDeQuien("cierre.reconocido_por", c.reconocidoPor, c.reconocidoEn)
        : null,
      observacion: c.reconocido ? c.texto : null,
    });
  }
  return { ok: true, controles };
}

const nombreDelMedio = (tipo: string, nombre: string | null): string =>
  nombre ?? nombreDelTipo(tipo);

function armarLaLinea(
  l: NonNullable<CierreParaLaPantalla["conciliacion"]>["lineas"][number],
): LineaVista {
  const declarable = l.estadoDeConteo !== "CONTADO";
  const conDato = l.estadoDeConteo === "CONTADO" || l.estadoDeConteo === "DECLARADO";
  let diferencia = texto({}, "cierre.conciliacion.sin_dato");
  if (l.estadoDeConteo === "CONFORME") diferencia = texto({}, "cierre.conciliacion.conforme");
  else if (l.diferencia !== null) diferencia = formatearImporte(l.diferencia);
  const negativa = l.diferencia !== null && l.diferencia.startsWith("-");
  return {
    clave: `${l.medioDePagoId}|${l.cuentaDeCobroId ?? ""}`,
    medioDePagoId: l.medioDePagoId,
    cuentaDeCobroId: l.cuentaDeCobroId,
    titulo: nombreDelMedio(l.medioTipo, l.medioNombre),
    cuenta: l.cuentaNombre,
    registrado: formatearImporte(l.registrado),
    correcciones: esCero(l.correcciones) ? null : formatearImporte(l.correcciones),
    declarado: conDato && l.declarado !== null ? formatearImporte(l.declarado) : null,
    declarable,
    declaradoCanonico: l.estadoDeConteo === "DECLARADO" && l.declarado !== null ? l.declarado : "",
    diferencia,
    tonoDeDiferencia:
      l.diferencia === null || esCero(l.diferencia) ? "neutro" : negativa ? "peligro" : "aviso",
  };
}

/** De lo que entrega la composición al modelo de la pantalla, o el motivo por el que no se puede armar (la pantalla sale con el genérico). */
export function armarElModeloDelCierre(
  cierre: CierreParaLaPantalla,
  acciones: AccionesDelCierre,
): ModeloDelCierre | Readonly<{ error: ErrorDelModelo }> {
  const fecha = fechaCivilDesdeTexto(cierre.fechaDeNegocio);
  if (!fecha.ok) return { error: "FECHA_INVALIDA" };
  if (!Object.hasOwn(ESTADO_DE_LA_PANTALLA, cierre.estado)) return { error: "ESTADO_DESCONOCIDO" };
  const estado = ESTADO_DE_LA_PANTALLA[cierre.estado];
  const controles = armarLosControles(cierre);
  if (!controles.ok) return { error: "CONTROL_SIN_TEXTO" };
  const de = (severidad: string) => controles.controles.filter((c) => c.severidad === severidad);
  return {
    fechaDeNegocio: cierre.fechaDeNegocio,
    fecha: fechaParaMostrar(fecha.valor),
    estado,
    etiquetaDeEstado: texto({}, ETIQUETA_DE_ESTADO[estado]),
    tonoDeEstado: TONO_DE_ESTADO[estado],
    cerradaPor: lineaDeQuien("cierre.cerrada_por", cierre.cerradaPor, cierre.cerradaEn),
    huella: cierre.huella,
    bloquean: de("BLOQUEA"),
    porReconocer: de("RECONOCIBLE"),
    informan: de("INFORMA"),
    lineas: cierre.conciliacion === null ? null : cierre.conciliacion.lineas.map(armarLaLinea),
    cobros:
      cierre.cobros === null
        ? null
        : cierre.cobros.cobros.map((c) => ({
            cobroId: c.cobroId,
            importe: formatearImporte(c.importe),
            medioDePagoId: c.medioDePagoId,
            cuentaDeCobroId: c.cuentaDeCobroId,
            medio:
              c.cuentaNombre === null
                ? nombreDelMedio(c.medioTipo, c.medioNombre)
                : `${nombreDelMedio(c.medioTipo, c.medioNombre)} · ${c.cuentaNombre}`,
            registradoPor: c.registradoPor,
            puedeCorregir: c.correccionPosible && acciones.corregirMedio,
            corregidoPor:
              c.ultimaCorreccion === null
                ? null
                : lineaDeQuien(
                    "cierre.corregido_por",
                    c.ultimaCorreccion.por,
                    c.ultimaCorreccion.en,
                  ),
            motivo: c.ultimaCorreccion === null ? null : c.ultimaCorreccion.motivo,
          })),
    hayMasCobros: cierre.cobros !== null && cierre.cobros.hayMas,
    medios: cierre.medios.map((m) => ({
      medioDePagoId: m.medioDePagoId,
      titulo: nombreDelMedio(m.tipo, m.nombre),
      cuentas: m.cuentas.map((c) => ({ id: c.cuentaDeCobroId, nombre: c.nombre })),
    })),
    acciones,
  };
}

/** `true` si lo que devolvió `armarElModeloDelCierre` es un error. */
export const esErrorDelModelo = (
  resultado: ModeloDelCierre | Readonly<{ error: ErrorDelModelo }>,
): resultado is Readonly<{ error: ErrorDelModelo }> => "error" in resultado;
