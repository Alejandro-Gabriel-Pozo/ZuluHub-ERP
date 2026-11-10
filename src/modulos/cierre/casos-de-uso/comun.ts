import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import {
  impideCerrar,
  type AporteAlCierreDelDia,
  type JornadaRef,
  type ReferenciaOpaca,
} from "../aporte-al-cierre";
import {
  claveDeJornada,
  leerDelAporte,
  type AporteNoDisponible,
  type EntradaDeJornada,
  type ErrorDeClaveDeJornada,
} from "../comun";
import type { ClaveDeJornada } from "../persistencia/repositorio-de-jornadas";
import type { TxDeCierre } from "./contrato";

/** Lo que impide empezar a contar el día, con lo que la pantalla necesita para llevar a quien cierra al detalle. */
export type ImpedimentoDeJornada = Readonly<{
  modulo: string;
  clave: string;
  cantidad: number;
  referencias: readonly ReferenciaOpaca[];
}>;

export type ErrorPrevio = MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDeClaveDeJornada;

export type Preparado = Readonly<{
  clave: ClaveDeJornada;
  /** La persona del contexto: todo cambio de estado deja quién lo hizo. */
  persona: PersonaId;
  /** Los módulos de la empresa, leídos en esta transacción junto con el permiso. */
  datos: DatosDelActor;
}>;

/**
 * Lo previo común a todo caso de uso que cambia la jornada, en el orden de siempre: el guard (la acción que declara el caso), que la
 * empresa opere, la persona del contexto (sin persona no hay quién deje constancia: `SIN_PERMISO`), el alcance de sucursal (el
 * operador solo opera en las suyas) y la validación de la entrada (una sucursal que no es un UUID no puede existir; la fecha es
 * una fecha civil real). Devuelve la clave de la jornada.
 */
export async function prepararCaso(
  tx: TxDeCierre,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
  entrada: EntradaDeJornada,
): Promise<Resultado<Preparado, ErrorPrevio>> {
  const cargado: { datos?: DatosDelActor } = {};
  const permiso = await exigirAccion(reglas, accion, async () => {
    cargado.datos = await tx.autorizacion.delActor(contexto);
    return cargado.datos;
  });
  if (!permiso.ok) return permiso;
  const { empresaId } = contexto;
  const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
  if (!opera.ok) return opera;
  if (contexto.personaId === null || cargado.datos === undefined) return err("SIN_PERMISO");
  const clave = claveDeJornada(empresaId, entrada);
  if (!clave.ok) return clave;
  const alcance = exigirSucursal(
    await tx.autorizacion.sucursalesDelActor(contexto),
    clave.valor.sucursal,
  );
  if (!alcance.ok) return alcance;
  return ok({ clave: clave.valor, persona: contexto.personaId, datos: cargado.datos });
}

/** Lo que impide empezar a contar el día: los controles `BLOQUEA` con hallazgos que entregan los `impedimentos` de cada aporte. */
export async function leerImpedimentos<T>(
  tx: T,
  aportes: readonly AporteAlCierreDelDia<T>[],
  jornada: JornadaRef,
): Promise<Resultado<readonly ImpedimentoDeJornada[], AporteNoDisponible>> {
  const impedimentos: ImpedimentoDeJornada[] = [];
  for (const aporte of aportes) {
    const leidos = await leerDelAporte(aporte, () => aporte.impedimentos(tx, jornada));
    if (!leidos.ok) return leidos;
    for (const control of leidos.valor.filter(impideCerrar)) {
      impedimentos.push({
        modulo: control.modulo,
        clave: control.clave,
        cantidad: control.cantidad,
        referencias: control.referencias,
      });
    }
  }
  return ok(impedimentos);
}

/** La entidad que se audita: la jornada se identifica por sucursal y fecha, sin id propio. */
export function entidadDeJornada(clave: ClaveDeJornada): string {
  return `${clave.sucursal}:${clave.fecha}`;
}
