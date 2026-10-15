import type { DefinicionDeModulo } from "../../capacidades/modulos/catalogo";
import type { DefinicionDePerilla } from "../../capacidades/planes/perillas";
import type { RepositorioDeMarcas } from "../../modulos/marcas/publico";
import type { RepositorioDePlanes } from "../../modulos/planes/publico";
import type { EmpresaId } from "../../primitivas/identificadores/marca";
import { err, type Resultado } from "../../primitivas/resultado/resultado";
import type { Auditoria } from "../../puertos/auditoria";
import type { LecturaDeDerechosDeUso } from "../../puertos/derechos-de-uso";
import type { Dato } from "../../puertos/sin-secretos";
import type { AccionDePlataforma } from "../../puertos/auditoria-de-plataforma";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type PlantillaDeCasoDePlataforma,
  type TxBaseDePlataforma,
} from "./caso-de-plataforma";

/**
 * Lo común de los casos de uso y las consultas de plataforma sobre marcas, planes, ajustes de perilla y
 * módulos de empresa (M5): la transacción, las dependencias, la forma de los errores y la constancia en
 * cada empresa afectada.
 */

/**
 * Lo que recibe el trabajo de cada caso de marcas y planes: los repositorios, la lectura de derechos de
 * uso (para el valor efectivo de una perilla y los derechos de una empresa), la auditoría de empresa (la
 * constancia en cada empresa afectada, con actor nulo: es la plataforma, no una persona de la empresa) y
 * lo común de plataforma.
 */
export type TxDeMarcasYPlanes = TxBaseDePlataforma &
  Readonly<{
    marcas: RepositorioDeMarcas;
    planes: RepositorioDePlanes;
    derechos: LecturaDeDerechosDeUso<string, string>;
    auditoriaDeEmpresa: Auditoria;
  }>;

/** Los catálogos del sistema contra los que se valida (el código los declara; las pruebas pasan los suyos). */
export type CatalogoDeModulosParaPlanes = Readonly<
  Record<string, Pick<DefinicionDeModulo, "estado" | "obligatorio" | "requiere">>
>;
export type CatalogoDePerillasParaPlanes = Readonly<Record<string, DefinicionDePerilla>>;

export type DependenciasDeMarcasYPlanes = DependenciasDeCasoDePlataforma<TxDeMarcasYPlanes> &
  Readonly<{
    catalogoDeModulos: CatalogoDeModulosParaPlanes;
    catalogoDePerillas: CatalogoDePerillasParaPlanes;
  }>;

/** Lo que todo caso de marcas y planes puede devolver además de lo propio. */
export type ErrorComunDeMarcasYPlanes = ErrorComunDeCasoDePlataforma;

/** La plantilla común de plataforma con la transacción de marcas y planes. */
export type PlantillaDeMarcasYPlanes<S extends Dato, V, E> = PlantillaDeCasoDePlataforma<
  TxDeMarcasYPlanes,
  S,
  V,
  E
>;

/** Ejecuta un caso de marcas y planes con la plantilla común (ver `caso-de-plataforma.ts` por el orden de los pasos). */
export function ejecutarCasoDeMarcasYPlanes<
  S extends Dato,
  V,
  E extends string | Readonly<{ codigo: string }>,
>(
  dependencias: DependenciasDeMarcasYPlanes,
  plantilla: PlantillaDeMarcasYPlanes<S, V, E>,
): Promise<Resultado<S, E | ErrorComunDeMarcasYPlanes>> {
  return ejecutarCasoDePlataforma<TxDeMarcasYPlanes, S, V, E>(dependencias, plantilla);
}

/**
 * La forma pública de un error de negocio: sin datos, su código (`"MARCA_RETIRADA"`); con datos, un
 * objeto `{ codigo, ...datos }` (`{ codigo: "TEMA_INVALIDO", token }`). El dominio devuelve los errores
 * sin datos de las dos maneras (texto en unos módulos, `{ codigo }` en otros); quien llama —la consola,
 * un script— no tiene que distinguir `"X"` de `{ codigo: "X" }`. Los errores de la base
 * (`{ tipo, ... }`) pasan sin cambios.
 */
export type ErrorPlano<E> =
  E extends Readonly<{ codigo: infer C extends string }>
    ? Exclude<keyof E, "codigo"> extends never
      ? C
      : E
    : E;

function esErrorConSoloCodigo(error: unknown): error is Readonly<{ codigo: string }> {
  return (
    typeof error === "object" &&
    error !== null &&
    "codigo" in error &&
    typeof error.codigo === "string" &&
    Object.keys(error).length === 1
  );
}

/** Aplana el error de un resultado a su forma pública (ver `ErrorPlano`). */
export function aplanarError<T, E>(resultado: Resultado<T, E>): Resultado<T, ErrorPlano<E>> {
  if (resultado.ok) return resultado;
  const error = resultado.error;
  return err((esErrorConSoloCodigo(error) ? error.codigo : error) as ErrorPlano<E>);
}

/**
 * Una constancia en la auditoría de CADA empresa afectada (plan, ajuste, módulo), con actor nulo: lo que
 * hace la plataforma queda a la vista de la empresa sin atribuírselo a una persona suya. En la misma
 * transacción que el cambio: si se revierte el cambio, se revierte la constancia.
 */
export async function auditarEnLasEmpresas(
  tx: TxDeMarcasYPlanes,
  empresas: readonly EmpresaId[],
  constancia: Readonly<{
    accion: AccionDePlataforma;
    entidad: string;
    entidadId: string;
    antes: Readonly<Record<string, Dato>> | null;
    despues: Readonly<Record<string, Dato>> | null;
  }>,
): Promise<void> {
  for (const empresaId of empresas) {
    await tx.auditoriaDeEmpresa.registrar({ empresaId, actorPersonaId: null, ...constancia });
  }
}

/** Un instante para la huella y la auditoría: ISO 8601 en UTC. */
export const instanteISO = (fecha: Date): string => fecha.toISOString();

/** El dato con sus claves ordenadas: dos datos iguales dan el mismo texto sin importar el orden en que se armaron. */
function canonico(dato: Dato): string {
  if (dato === null || typeof dato !== "object") return JSON.stringify(dato);
  if (Array.isArray(dato)) return `[${(dato as readonly Dato[]).map(canonico).join(",")}]`;
  const objeto = dato as { readonly [campo: string]: Dato };
  const campos = Object.keys(objeto)
    .sort()
    .map((campo) => `${JSON.stringify(campo)}:${canonico(objeto[campo] as Dato)}`);
  return `{${campos.join(",")}}`;
}

/** ¿Son iguales dos datos, sin importar el orden en que se armaron los campos de sus objetos? */
export const datosIguales = (a: Dato, b: Dato): boolean => canonico(a) === canonico(b);

/**
 * ¿Es `valor` un dato plano (texto, número finito, booleano, nulo, lista u objeto de datos planos)? Sirve
 * para armar la huella de lo que llega sin tipar de afuera (el valor de un ajuste de perilla): lo que no
 * es dato no puede ser un valor válido, y no se deja entrar a la huella.
 */
export function esDato(valor: unknown): valor is Dato {
  if (valor === null) return true;
  switch (typeof valor) {
    case "string":
    case "boolean":
      return true;
    case "number":
      return Number.isFinite(valor);
    case "object":
      if (Array.isArray(valor)) return valor.every(esDato);
      return Object.getPrototypeOf(valor) === Object.prototype
        ? Object.values(valor).every(esDato)
        : false;
    default:
      return false;
  }
}
