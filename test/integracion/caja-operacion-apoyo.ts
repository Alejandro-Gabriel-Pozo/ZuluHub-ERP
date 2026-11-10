import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { ImporteJson } from "../../src/primitivas/dinero/importe";
import {
  crearCasosDeUsoDeCierre,
  huellaDeControles,
  type EntradaDeJornada,
} from "../../src/modulos/cierre/publico";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  REGLAS_DE_CAJA,
  crearMundoDeCaja,
  type armarCaja,
  type crearEntornoDeCaja,
  type MundoDeCaja,
  type OpcionesDeMundoDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import type { TxDePrueba } from "./entorno";

/**
 * Apoyo de las pruebas de integración de la OPERACIÓN de caja (E3, tramo 5): abrir, cerrar, movimientos, ajustes, anulaciones y las
 * consultas, con una base real y los roles limitados. El plan lleva `caja` y `cierre` (la jornada la gobierna `cierre`). El reloj es el
 * de cada contexto: las asignaciones de plan nacen vigentes según el reloj de la base, así que los instantes de prueba son SIEMPRE
 * posteriores a «ahora» (`instanteLocal` cuenta días hacia adelante).
 */

export const pesos = (monto: string): ImporteJson => ({ moneda: "ARS", monto });
export const CERO = pesos("0.00");

/** Una clave de idempotencia con la forma que pide la base, distinta cada vez. */
export const claveNueva = (): string => randomUUID();

/**
 * El instante UTC en que, en Buenos Aires (UTC-3, sin horario de verano), es `hora` (`HH:MM`) del día de `dias` días después de hoy
 * (en Buenos Aires). Con `dias >= 1` es siempre posterior a «ahora»: sirve para armar contextos de fecha fija relativa.
 */
export function instanteLocal(dias: number, hora: string, ahora: Date = new Date()): Date {
  const localAhora = new Date(ahora.getTime() - 3 * 3_600_000);
  const dia = new Date(
    Date.UTC(localAhora.getUTCFullYear(), localAhora.getUTCMonth(), localAhora.getUTCDate() + dias),
  );
  const [h, min] = hora.split(":").map(Number) as [number, number];
  return new Date(dia.getTime() + (h + 3) * 3_600_000 + min * 60_000);
}

/** La fecha de negocio `YYYY-MM-DD` de un instante con corte 00:00 en Buenos Aires. */
export const fechaLocal = (instante: Date): string =>
  new Date(instante.getTime() - 3 * 3_600_000).toISOString().slice(0, 10);

export const conAhora = (ctx: ContextoOperativo, ahora: Date): ContextoOperativo => ({
  ...ctx,
  ahora,
});

export type EntornoDeOperacion = ReturnType<typeof crearEntornoDeCaja>;

export type MundoDeOperacion = MundoDeCaja &
  Readonly<{
    /** La caja «Caja 1» de la sucursal, ya creada. */
    cajaId: string;
  }>;

/** Arma el mundo: empresa con `caja` y `cierre`, su gerente y la «Caja 1» de la sucursal (creada por el comando). */
export async function crearMundoDeOperacion(
  entornoBase: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
  caja: ReturnType<typeof armarCaja>,
  opciones: OpcionesDeMundoDeCaja = {},
): Promise<MundoDeOperacion> {
  const m = await crearMundoDeCaja(entornoBase, dueno, { plan: ["caja", "cierre"], ...opciones });
  const asegurada = await caja.casos.asegurarCajaPorDefecto(
    // La persona del mundo (gerente u otro rol con alcance); un operador sin alcance no puede, la caja la crea el dueño.
    m.ctx(),
    { sucursalId: m.sucursal },
  );
  if (asegurada.ok) return { ...m, cajaId: asegurada.valor.cajaId };
  const { rows } = await dueno.query<{ id: string }>(
    "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 1') returning id",
    [m.empresa, m.sucursal],
  );
  return { ...m, cajaId: rows[0]?.id as string };
}

/** Los casos de uso del cierre del día sobre las mismas transacciones, sin aportes (las jornadas cerradas de las pruebas). */
export function armarCierreDeJornada(entorno: EntornoDeOperacion) {
  return crearCasosDeUsoDeCierre<TxDeCajaDePrueba>({
    transacciones: entorno,
    reglas: REGLAS_DE_CAJA,
    aportes: [],
  });
}

/** Cierra la jornada de la sucursal y fecha: iniciar la auditoría y cerrar, sin controles que reconocer. */
export async function cerrarLaJornada(
  cierre: ReturnType<typeof armarCierreDeJornada>,
  ctx: ContextoOperativo,
  entrada: EntradaDeJornada,
): Promise<void> {
  const iniciada = await cierre.iniciarAuditoria(ctx, entrada);
  if (!iniciada.ok)
    throw new Error(`no se pudo iniciar la auditoría: ${JSON.stringify(iniciada.error)}`);
  const cerrada = await cierre.cerrarJornada(ctx, {
    ...entrada,
    huellaVista: huellaDeControles([]),
    reconocimientos: [],
    observacion: null,
  });
  if (!cerrada.ok)
    throw new Error(`no se pudo cerrar la jornada: ${JSON.stringify(cerrada.error)}`);
}
