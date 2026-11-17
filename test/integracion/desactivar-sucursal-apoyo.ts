import type pg from "pg";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { crearAporteDeCaja } from "../../src/modulos/caja/publico";
import { crearGanchoDeCierreAlDesactivar } from "../../src/modulos/cierre/publico";
import type { EntradaDeJornada } from "../../src/modulos/cierre/publico";
import type { SucursalId } from "../../src/primitivas/identificadores/marca";
import {
  REGLAS_DE_CAJA,
  SIN_TICKETS,
  armarEmpresasConGanchos,
  otraSucursalDeCaja,
  type TxDeCajaDePrueba,
} from "./caja-configuracion-apoyo";
import {
  claveNueva,
  conAhora,
  fechaLocal,
  instanteLocal,
  pesos,
  type MundoDeOperacion,
} from "./caja-operacion-apoyo";

/**
 * Apoyo de las pruebas de «desactivar una sucursal con la jornada abierta» (decisión 178; E3, tramo 9): los casos de uso de empresas con el
 * gancho REAL del cierre y el aporte REAL de caja (como los registra la composición), el contexto del día de la prueba y la lectura del
 * estado de la jornada y de la sucursal con el dueño de la base (que evade RLS).
 */

/** Los casos de uso de empresas con el gancho del cierre y el aporte de caja, sobre las transacciones dadas. */
export function armarEmpresasConCierre(entorno: TransaccionesDePostgres<TxDeCajaDePrueba>) {
  return armarEmpresasConGanchos(entorno, [], REGLAS_DE_CAJA, [
    crearGanchoDeCierreAlDesactivar({
      reglas: REGLAS_DE_CAJA,
      aportes: [crearAporteDeCaja({ tickets: SIN_TICKETS })],
    }),
  ]);
}

/** El instante de la prueba: mañana a las 10:00 en Buenos Aires (corte 00:00), más los minutos dados. */
const enElDia = (minutos = 0, dias = 1): Date =>
  new Date(instanteLocal(dias, "10:00").getTime() + minutos * 60_000);
export const fechaDelDia = (dias = 1): string => fechaLocal(instanteLocal(dias, "10:00"));
export const ctxDelDia = (
  m: Pick<MundoDeOperacion, "ctx">,
  minutos = 0,
  dias = 1,
): ContextoOperativo => conAhora(m.ctx(), enElDia(minutos, dias));
export const entradaDelDia = (
  m: Pick<MundoDeOperacion, "sucursal">,
  dias = 1,
): EntradaDeJornada => ({ sucursalId: m.sucursal, fechaDeNegocio: fechaDelDia(dias) });

/** Para poder desactivar la sucursal del mundo hace falta otra activa en la empresa. */
export const sumarOtraSucursal = (
  dueno: pg.Client,
  m: Pick<MundoDeOperacion, "empresa">,
  n: string,
) => otraSucursalDeCaja(dueno, m.empresa, `Otra ${n}`);

export type FilaDeJornada = Readonly<{
  estado: string;
  auditoria_iniciada_por: string | null;
  auditoria_iniciada_en: Date | null;
  cerrada_por: string | null;
  cerrada_en: Date | null;
  huella_de_cierre: string | null;
}>;

export async function jornadaDe(
  dueno: pg.Client,
  empresa: string,
  sucursal: SucursalId | string,
  fecha: string,
): Promise<FilaDeJornada | null> {
  const { rows } = await dueno.query<FilaDeJornada>(
    `select estado, auditoria_iniciada_por, auditoria_iniciada_en, cerrada_por, cerrada_en, huella_de_cierre
       from jornada_de_sucursal where empresa_id = $1 and sucursal_id = $2 and fecha_negocio = $3`,
    [empresa, sucursal, fecha],
  );
  return rows[0] ?? null;
}

export async function sucursalActiva(
  dueno: pg.Client,
  empresa: string,
  sucursal: string,
): Promise<boolean> {
  const { rows } = await dueno.query<{ activa: boolean }>(
    "select activa from sucursal where empresa_id = $1 and id = $2",
    [empresa, sucursal],
  );
  return rows[0]?.activa === true;
}

export async function contarSesiones(dueno: pg.Client, empresa: string, sucursal: string) {
  const { rows } = await dueno.query<{ n: string }>(
    "select count(*) as n from sesion_caja s join caja c on c.empresa_id = s.empresa_id and c.id = s.caja_id where s.empresa_id = $1 and c.sucursal_id = $2",
    [empresa, sucursal],
  );
  return Number(rows[0]?.n);
}

export async function contarAuditorias(dueno: pg.Client, empresa: string, accion: string) {
  const { rows } = await dueno.query<{ n: string }>(
    "select count(*) as n from auditoria_empresa where empresa_id = $1 and accion = $2",
    [empresa, accion],
  );
  return Number(rows[0]?.n);
}

export const entradaDeAbrir = (m: MundoDeOperacion) => ({
  claveDeIdempotencia: claveNueva(),
  sucursalId: m.sucursal,
  cajaId: m.cajaId,
  fondoInicial: pesos("100.00"),
});
