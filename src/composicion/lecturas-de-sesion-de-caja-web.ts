import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  CANTIDAD_MAXIMA_DE_BILLETES,
  DENOMINACIONES_DE_BILLETES,
  type EstadoDeCaja,
  type TipoDeMedio,
} from "../modulos/caja/publico";
import type { ImporteJson } from "../primitivas/dinero/importe";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { entradaDeSesionDeCaja } from "./entradas-de-sesion-de-caja";
import { accionDeCaja } from "./errores-de-caja";
import type { DependenciasDeSesionDeCajaWeb } from "./sesion-de-caja-web";

/**
 * Lo que la pantalla «Caja» del mostrador LEE (maqueta `caja.html`): el estado de la caja de la sucursal con la jornada de hoy, la sesión abierta con su esperado y sus movimientos,
 * el resumen de la última sesión cerrada y lo que hay que contar para cerrar. Son lecturas: no escriben ni auditan. Las acciones están en `sesion-de-caja-web.ts` (mismas reglas allí).
 */

/** Un medio (y su cuenta, si la tiene) con lo que debería haber: lo que la pantalla muestra y lo que el conteo tiene que cubrir. */
export type LineaEsperadaParaLaPantalla = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
}>;

export type MovimientoParaLaPantalla = Readonly<{
  id: string;
  clase: string;
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  /** Con signo: entra > 0, sale < 0. */
  importe: ImporteJson;
  motivo: string | null;
  /** La anulación lleva el id del movimiento que anula. */
  anulaA: string | null;
  /** El id de la anulación de este movimiento, si ya se anuló. */
  anuladoPor: string | null;
  registradoEn: string;
  /** El id de la persona (el nombre lo pone otra pieza). */
  registradoPor: string;
  /** Lo calcula el servidor con la misma regla que la anulación y el permiso real de quien mira: la pantalla no decide. */
  anulablePorElActor: boolean;
}>;

export type SesionAbiertaParaLaPantalla = Readonly<{
  sesionId: string;
  /** La jornada con que se abrió (no cambia aunque se modifique el corte). */
  fechaDeNegocio: string;
  horaDeCorte: string;
  /** El esperado por medio y cuenta: la suma exacta de lo registrado en la sesión (fondo y anulaciones incluidos). */
  lineas: readonly LineaEsperadaParaLaPantalla[];
  movimientos: readonly MovimientoParaLaPantalla[];
  /** `true`: hay más movimientos que los que entran en una página. */
  hayMasMovimientos: boolean;
}>;

export type LineaDeArqueoParaLaPantalla = Readonly<{
  medioDePagoId: string;
  medioTipo: TipoDeMedio;
  medioNombre: string | null;
  cuentaDeCobroId: string | null;
  cuentaNombre: string | null;
  esperado: ImporteJson;
  /** Efectivo: billetes + monedas; demás medios: el total declarado; `null` si la línea quedó conforme. */
  contado: ImporteJson | null;
  conforme: boolean;
  /** contado − esperado; `null` si es conforme. */
  diferencia: ImporteJson | null;
}>;

export type UltimaSesionParaLaPantalla = Readonly<{
  sesionId: string;
  fechaDeNegocio: string;
  cerradaEn: string | null;
  observacion: string | null;
  arqueo: readonly LineaDeArqueoParaLaPantalla[];
}>;

export type CajaParaLaPantalla = Readonly<{
  cajaId: string;
  nombre: string;
  estado: EstadoDeCaja;
  /** La sesión sigue abierta después de su jornada. */
  jornadaVencida: boolean;
  /** Solo con la caja abierta o en cierre. */
  sesion: SesionAbiertaParaLaPantalla | null;
  /** Solo con la caja sin sesión: la última que se cerró, o `null` si nunca se cerró. */
  ultimaSesion: UltimaSesionParaLaPantalla | null;
}>;

export type LaCajaParaLaPantalla = Readonly<{
  /** La jornada de hoy de la sucursal; si no está `ABIERTA` (auditoría o cerrada), abrir una caja se rechaza. */
  jornadaActual: Readonly<{ fechaDeNegocio: string; estado: string }>;
  cajas: readonly CajaParaLaPantalla[];
}>;

export type ConteoParaLaPantalla = Readonly<{
  sesionId: string;
  estado: EstadoDeCaja | "CERRADA";
  /** Las líneas que tiene que cubrir el cierre; la del efectivo (`contarConBilletes`) se cuenta SIEMPRE por billetes y monedas y no admite «conforme». */
  lineas: readonly (LineaEsperadaParaLaPantalla & Readonly<{ contarConBilletes: boolean }>)[];
  /** Los billetes que se cuentan, de mayor a menor, y la cantidad máxima de cada uno: lo dice el dominio, la pantalla no los repite. */
  denominaciones: readonly number[];
  cantidadMaximaDeBilletes: number;
}>;

type Lectura<D> = () => Promise<Resultado<D, unknown>>;

/** Una lectura de la pantalla (sin pedido que leer): corre las consultas, traduce el error y no escribe nada. */
function leerLaPantalla<D>(
  d: DependenciasDeSesionDeCajaWeb,
  trabajo: Lectura<D>,
): Promise<Respuesta<D>> {
  return accionDeCaja(
    d.respuesta,
    {},
    () => ok({}),
    () => trabajo(),
    (dato) => dato,
  );
}

const jsonDe = (l: LineaEsperadaParaLaPantalla): LineaEsperadaParaLaPantalla => ({
  medioDePagoId: l.medioDePagoId,
  medioTipo: l.medioTipo,
  medioNombre: l.medioNombre,
  cuentaDeCobroId: l.cuentaDeCobroId,
  cuentaNombre: l.cuentaNombre,
  esperado: l.esperado,
});

/**
 * Lo que muestra la pantalla «Caja» de la sucursal con la que trabaja la persona: la jornada de hoy y, por cada caja activa, su estado; con sesión (abierta o en cierre), lo que debería
 * haber y los movimientos; sin sesión, el resumen de la última que se cerró. Es una LECTURA: no escribe ni audita. Varias consultas, cada una con su permiso (`cajas.ver`) y su alcance;
 * si una falla, falla toda (nada a medias).
 */
export function cargarLaCaja(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<LaCajaParaLaPantalla>> {
  return leerLaPantalla(d, async () => {
    const consultas = d.consultas();
    const estado = await consultas.estadoDeLaCaja(contexto, { sucursalId });
    if (!estado.ok) return estado;
    const cajas: CajaParaLaPantalla[] = [];
    for (const c of estado.valor.cajas) {
      const base = {
        cajaId: c.cajaId,
        nombre: c.nombre,
        estado: c.estado,
        jornadaVencida: c.jornadaVencida,
      };
      if (c.sesionId === null) {
        const ultima = await consultas.ultimaSesionDeLaCaja(contexto, { cajaId: c.cajaId });
        if (!ultima.ok) return ultima;
        cajas.push({
          ...base,
          sesion: null,
          ultimaSesion:
            ultima.valor === null
              ? null
              : {
                  sesionId: ultima.valor.sesion.id,
                  fechaDeNegocio: ultima.valor.sesion.fechaDeNegocio,
                  cerradaEn: ultima.valor.sesion.cerradaEn,
                  observacion: ultima.valor.observacion,
                  arqueo: ultima.valor.arqueo.map((l) => ({
                    medioDePagoId: l.medioDePagoId,
                    medioTipo: l.medioTipo,
                    medioNombre: l.medioNombre,
                    cuentaDeCobroId: l.cuentaDeCobroId,
                    cuentaNombre: l.cuentaNombre,
                    esperado: l.esperado,
                    contado: l.contado,
                    conforme: l.conforme,
                    diferencia: l.diferencia,
                  })),
                },
        });
        continue;
      }
      const resumen = await consultas.resumenDeSesion(contexto, { sesionId: c.sesionId });
      if (!resumen.ok) return resumen;
      const movimientos = await consultas.movimientosDeSesion(contexto, { sesionId: c.sesionId });
      if (!movimientos.ok) return movimientos;
      const ficha = await consultas.fichaDeSesion(contexto, { sesionId: c.sesionId });
      if (!ficha.ok) return ficha;
      cajas.push({
        ...base,
        ultimaSesion: null,
        sesion: {
          sesionId: c.sesionId,
          fechaDeNegocio: resumen.valor.sesion.fechaDeNegocio,
          horaDeCorte: ficha.valor.horaDeCorte,
          lineas: resumen.valor.lineas.map(jsonDe),
          movimientos: movimientos.valor.movimientos.map((m) => ({
            id: m.id,
            clase: m.clase,
            medioDePagoId: m.medioDePagoId,
            medioTipo: m.medioTipo,
            medioNombre: m.medioNombre,
            cuentaDeCobroId: m.cuentaDeCobroId,
            cuentaNombre: m.cuentaNombre,
            importe: m.importe,
            motivo: m.motivo,
            anulaA: m.anulaA,
            anuladoPor: m.anuladoPor,
            registradoEn: m.registradoEn,
            registradoPor: m.registradoPor,
            anulablePorElActor: m.anulablePorElActor,
          })),
          hayMasMovimientos: movimientos.valor.siguiente !== null,
        },
      });
    }
    return ok({
      jornadaActual: {
        fechaDeNegocio: estado.valor.jornadaActual.fechaDeNegocio,
        estado: estado.valor.jornadaActual.estado,
      },
      cajas,
    });
  });
}

/** Lo que hay que contar para cerrar una sesión (pantalla «Contar»). Lectura: no escribe; la cuenta definitiva la recalcula `cerrarLaCaja` en el servidor. */
export function cargarElConteo(
  d: DependenciasDeSesionDeCajaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ConteoParaLaPantalla>> {
  return accionDeCaja(
    d.respuesta,
    crudo,
    entradaDeSesionDeCaja,
    (entrada) => d.consultas().prepararCierre(contexto, { sesionId: entrada.sesionId }),
    (cierre) => ({
      sesionId: cierre.sesionId,
      estado: cierre.estado,
      lineas: cierre.lineas.map((l) => ({ ...jsonDe(l), contarConBilletes: l.contarConBilletes })),
      denominaciones: DENOMINACIONES_DE_BILLETES,
      cantidadMaximaDeBilletes: CANTIDAD_MAXIMA_DE_BILLETES,
    }),
  );
}
