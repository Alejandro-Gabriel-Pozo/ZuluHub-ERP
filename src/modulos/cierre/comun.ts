import { estadoDeModulos } from "../../capacidades/modulos/activos";
import type { ReglasDeEmpresa } from "../../capacidades/permisos/empresa";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import { sucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../../primitivas/tiempo/fecha-civil";
import type { DatosDelActor } from "../../puertos/autorizacion";
import {
  controlesDelAporte,
  type AporteAlCierreDelDia,
  type ControlDelDia,
  type JornadaRef,
  type RegistroDeAportes,
} from "./aporte-al-cierre";
import { FORMA_DE_UUID, type ClaveDeJornada } from "./persistencia/repositorio-de-jornadas";

/**
 * Lo común a los casos de uso y a las consultas del cierre: la clave de la jornada, qué aportes valen para la empresa y cómo se leen
 * sus controles. Vive acá, y no en `casos-de-uso/`, porque las consultas no importan los casos de uso.
 */

/** El aporte de un módulo que no se pudo leer (o que rompió el contrato): el día no se cierra con un dato que no se pudo leer. */
export type AporteNoDisponible = Readonly<{ codigo: "APORTE_NO_DISPONIBLE"; modulo: string }>;

export type ErrorDeClaveDeJornada = "JORNADA_NO_ENCONTRADA" | "FECHA_INVALIDA";

/** Lo que pide cada caso sobre una jornada: la sucursal y la fecha de negocio, como las manda la pantalla (se validan acá). */
export type EntradaDeJornada = Readonly<{ sucursalId: string; fechaDeNegocio: string }>;

/**
 * La clave de la jornada a partir de lo que mandó la pantalla: validada, sin tocar la base. Una sucursal que no es un UUID no puede
 * existir (`JORNADA_NO_ENCONTRADA`); la fecha tiene que ser una fecha civil real (`FECHA_INVALIDA`).
 */
export function claveDeJornada(
  empresa: EmpresaId,
  entrada: EntradaDeJornada,
): Resultado<ClaveDeJornada, ErrorDeClaveDeJornada> {
  if (typeof entrada.sucursalId !== "string" || !FORMA_DE_UUID.test(entrada.sucursalId)) {
    return err("JORNADA_NO_ENCONTRADA");
  }
  if (typeof entrada.fechaDeNegocio !== "string") return err("FECHA_INVALIDA");
  const fecha = fechaCivilDesdeTexto(entrada.fechaDeNegocio);
  if (!fecha.ok) return err("FECHA_INVALIDA");
  return ok({ empresa, sucursal: sucursalId(entrada.sucursalId), fecha: fecha.valor });
}

export function referenciaDe(clave: ClaveDeJornada): JornadaRef {
  return { empresaId: clave.empresa, sucursalId: clave.sucursal, fechaDeNegocio: clave.fecha };
}

/** Un registro con dos aportes del mismo módulo es un error de armado de la composición, no de negocio: lanza al crear los casos. */
export function exigirAportesDeModulosDistintos<T>(aportes: RegistroDeAportes<T>): void {
  const vistos = new Set<string>();
  for (const aporte of aportes) {
    if (vistos.has(aporte.modulo)) {
      throw new RangeError(`el módulo ${aporte.modulo} registró dos aportes al cierre del día`);
    }
    vistos.add(aporte.modulo);
  }
}

/**
 * Los aportes de los módulos ACTIVOS de la empresa (o activados y fuera del techo de su plan: están en solo lectura pero su actividad
 * existe, y el cierre no puede ignorar lo que hay que revisar). Un módulo en desarrollo, apagado o desconocido no aporta ni impide.
 */
export function aportesDeLaEmpresa<T>(
  reglas: ReglasDeEmpresa,
  datos: DatosDelActor,
  aportes: RegistroDeAportes<T>,
): readonly AporteAlCierreDelDia<T>[] {
  const { modulosActivos, modulosEnSoloLectura } = estadoDeModulos(
    reglas.catalogo,
    datos.modulosActivados,
    datos.modulosHabilitados,
  );
  const vigentes = new Set<string>([...modulosActivos, ...modulosEnSoloLectura]);
  return aportes.filter((aporte) => vigentes.has(aporte.modulo));
}

/** Lo que el aporte entregó, comprobado contra el contrato; cualquier falla es `APORTE_NO_DISPONIBLE` con el módulo. */
export async function leerDelAporte<T>(
  aporte: AporteAlCierreDelDia<T>,
  pedir: () => ReturnType<AporteAlCierreDelDia<T>["controles"]>,
): Promise<Resultado<readonly ControlDelDia[], AporteNoDisponible>> {
  const leido = await pedir();
  if (!leido.ok) return err({ codigo: "APORTE_NO_DISPONIBLE", modulo: aporte.modulo });
  const controles = controlesDelAporte(aporte.modulo, leido.valor);
  if (!controles.ok) return err({ codigo: "APORTE_NO_DISPONIBLE", modulo: aporte.modulo });
  return controles;
}

/** Todos los controles de los aportes dados para la jornada; si uno falla, falla todo (nunca se sigue con un dato que no se leyó). */
export async function leerControles<T>(
  tx: T,
  aportes: readonly AporteAlCierreDelDia<T>[],
  jornada: JornadaRef,
): Promise<Resultado<readonly ControlDelDia[], AporteNoDisponible>> {
  const controles: ControlDelDia[] = [];
  for (const aporte of aportes) {
    const leidos = await leerDelAporte(aporte, () => aporte.controles(tx, jornada));
    if (!leidos.ok) return leidos;
    controles.push(...leidos.valor);
  }
  return ok(controles);
}
