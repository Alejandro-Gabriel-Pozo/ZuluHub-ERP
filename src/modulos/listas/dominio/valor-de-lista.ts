import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { explicacionDesdeTexto } from "../../cierre/publico";

/**
 * FICHA DEL DATO: VALOR DE UNA LISTA DEL SISTEMA (e3 §3.7, decisión 130; migración 0027, `valor_de_lista`).
 *
 * - Qué es: una opción de una lista que administra la plataforma y que ven todas las empresas (marcas de tarjeta, motivos de rechazo).
 *   Una empresa no agrega ni saca valores. Nada se borra: se desactiva (deja de ofrecerse en cobros NUEVOS; lo ya cobrado lo conserva)
 *   y se reactiva. Corregir el nombre cambia cómo se ve también lo anterior, porque lo cobrado guarda el id y no el texto.
 * - Cómo se escribe el nombre: de 1 a `LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR` caracteres hechos SOLO de la lista de permitidos de la
 *   explicación del cierre (`cierre/dominio/explicacion.ts`, una regla, un lugar; la base la repite en `valor_de_lista_nombre_ck`):
 *   se recorta, se pasa a NFC y los espacios repetidos quedan en uno. Es único por lista SIN distinguir mayúsculas ni acentos: lo
 *   decide el índice de la base (`valor_de_lista_nombre_uk`, ICU nivel 1), no este archivo.
 * - Una sola «Otra» fija por lista: no se renombra ni se desactiva (`VALOR_FIJO`; la base lo repite en `valor_de_lista_validar_cambio`).
 * - Códigos de error: `LISTA_INVALIDA`, `NOMBRE_INVALIDO`, `VALOR_FIJO`, `VERSION_DESACTUALIZADA`.
 *
 * SUPUESTO (DEC-0043) (ingeniero, sin fuente del dueño): el tope de 40 caracteres sale de la especificación e3 §3.7 («nombre 1 a 40»), no de una
 * decisión del dueño. Costo de revertir: la constante de abajo y el CHECK de la base.
 */
// fuente-unica: ajeno — el 40 es el de `valor_de_lista_nombre_ck`, no el del teléfono ni el del código de producto: otro dato
export const LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR = 40;

/** Las listas del sistema que existen hoy: el CHECK `valor_de_lista_lista_ck` de la base las repite (una prueba las compara). */
export const LISTAS_DEL_SISTEMA = ["MARCAS_DE_TARJETA", "MOTIVOS_DE_RECHAZO"] as const;
export type ListaDelSistema = (typeof LISTAS_DEL_SISTEMA)[number];

export type ErrorDeListaInvalida = "LISTA_INVALIDA";
export type ErrorDeNombreDeValor = "NOMBRE_INVALIDO";
export type ErrorDeCambioDeValor = "VALOR_FIJO" | "VERSION_DESACTUALIZADA";

/** El valor tal como lo guarda la base. `version` es la que ve quien lo cambia (el `versionEsperada` del próximo cambio). */
export type ValorDeLista = Readonly<{
  id: string;
  lista: ListaDelSistema;
  nombre: string;
  activo: boolean;
  fija: boolean;
  version: number;
}>;

/** Lo que decidió un cambio: si hay algo que escribir (`false`: ya estaba así, éxito sin escribir ni auditar). */
export type CambioDecidido = Readonly<{ cambia: boolean }>;

/** La lista pedida, o `LISTA_INVALIDA`: solo las declaradas (lo que llega sin tipar y no está en `LISTAS_DEL_SISTEMA` se rechaza). */
export function listaDesdeTexto(texto: unknown): Resultado<ListaDelSistema, ErrorDeListaInvalida> {
  const lista = LISTAS_DEL_SISTEMA.find((l) => l === texto);
  return lista === undefined ? err("LISTA_INVALIDA") : ok(lista);
}

/** El nombre en su forma canónica, o `NOMBRE_INVALIDO` (vacío, más largo que el tope o con algo fuera de la lista de permitidos). */
export function nombreDeValorDesdeTexto(texto: unknown): Resultado<string, ErrorDeNombreDeValor> {
  if (typeof texto !== "string") return err("NOMBRE_INVALIDO");
  const nombre = explicacionDesdeTexto(texto);
  if (!nombre.ok || nombre.valor === null) return err("NOMBRE_INVALIDO");
  return nombre.valor.length > LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR
    ? err("NOMBRE_INVALIDO")
    : ok(nombre.valor);
}

/**
 * Corregir el nombre. Un valor fijo no se renombra (se mira primero: no hay versión que valga). Con otra versión de la que vio quien
 * corrige, `VERSION_DESACTUALIZADA`. El mismo nombre, tal cual, no cambia nada. Cambiar solo mayúsculas o acentos SÍ es un cambio: la
 * base lo admite porque la única es contra OTRAS filas, no contra la misma.
 */
export function decidirNuevoNombre(
  valor: ValorDeLista,
  nombre: string,
  versionEsperada: number,
): Resultado<CambioDecidido, ErrorDeCambioDeValor> {
  if (valor.fija) return err("VALOR_FIJO");
  if (valor.version !== versionEsperada) return err("VERSION_DESACTUALIZADA");
  return ok({ cambia: valor.nombre !== nombre });
}

/**
 * Desactivar (`activo: false`) o reactivar (`activo: true`). Desactivar un valor fijo es `VALOR_FIJO`. Lo que ya está en el estado
 * pedido es éxito sin escribir y SIN mirar la versión (un doble clic con otra clave no debe fallar por la versión que subió el
 * primero); recién cuando hay que cambiar algo, otra versión es `VERSION_DESACTUALIZADA`.
 */
export function decidirActivo(
  valor: ValorDeLista,
  activo: boolean,
  versionEsperada: number,
): Resultado<CambioDecidido, ErrorDeCambioDeValor> {
  if (!activo && valor.fija) return err("VALOR_FIJO");
  if (valor.activo === activo) return ok({ cambia: false });
  if (valor.version !== versionEsperada) return err("VERSION_DESACTUALIZADA");
  return ok({ cambia: true });
}
