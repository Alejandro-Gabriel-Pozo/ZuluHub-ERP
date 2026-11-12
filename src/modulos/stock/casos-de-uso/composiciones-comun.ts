import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  cantidadATexto,
  cantidadDesdeTexto,
  type Cantidad,
} from "../../../primitivas/cantidad/cantidad";
import { cantidadConSignoDesdeTexto } from "../../../primitivas/cantidad/con-signo";
import {
  porcentajeATexto,
  porcentajeDesdeTexto,
  type Porcentaje,
} from "../../../primitivas/cantidad/porcentaje";
import { exigirPerilla } from "../../../capacidades/planes/derechos";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { pasosDeRecetaDesdeTexto } from "../../../primitivas/texto/pasos-de-receta";
import {
  esUnidadConocida,
  type ErrorDeComposicion,
  type PerillasDeComposicion,
} from "../dominio/composicion";
import { esUuid } from "../persistencia/filas";
import type { ComposicionGuardada } from "../persistencia/modelo";
import type { TxDeStock } from "./contrato";
import type { ErrorDeStock } from "./errores";
import { leerCantidad } from "./movimientos-comun";

type R<S> = Resultado<S, ErrorDeStock>;

/**
 * Lo común de guardar y retirar una receta (E5 §3.2, E6 §3.2): leer y comprobar la forma de lo que llega (lista de permitidos), la
 * comparación de contenido para la repetición y el resumen de la auditoría. Separado de `composiciones.ts` por tamaño.
 */

/**
 * Tope de componentes de una receta: el de la base (`componente_numero_ck`, `numero` es un `smallint`). Una receta real tiene unos pocos;
 * el tope solo evita mandar a la base una lista que no entra.
 */
export const MAXIMO_DE_COMPONENTES = 32_767;

/** Lo que dice un puntaje de pérdida permitido: de 0 a 99,9999 (la base exige menos de 100), con hasta 4 decimales. */
const FORMA_DE_LA_PERDIDA = /^[0-9]{1,2}(\.[0-9]{1,4})?$/;

export type ComponenteLeido = Readonly<{
  productoId: string;
  cantidad: Cantidad;
  unidadId: string;
  perdida: Porcentaje | null;
}>;

/** Los pasos: ausente o vacío es «sin pasos»; si hay texto, una línea de la lista de permitidos (`pasos-de-receta`). */
export function leerPasos(valor: unknown): R<string | null> {
  if (valor === undefined || valor === null || valor === "") return ok(null);
  if (typeof valor !== "string") return err("IDENTIFICADOR_INVALIDO");
  const valido = pasosDeRecetaDesdeTexto(valor);
  return valido.ok ? ok(valido.valor) : err("IDENTIFICADOR_INVALIDO");
}

export function leerVersionEsperada(valor: unknown): R<number> {
  return typeof valor === "number" &&
    Number.isSafeInteger(valor) &&
    valor >= 0 &&
    valor <= 2_147_483_647
    ? ok(valor)
    : err("IDENTIFICADOR_INVALIDO");
}

/** El rinde: texto decimal exacto mayor que cero (`RINDE_INVALIDO` si no). */
export function leerRinde(texto: unknown): R<Cantidad> {
  if (typeof texto !== "string") return err("RINDE_INVALIDO");
  const leido = cantidadConSignoDesdeTexto(texto);
  if (!leido.ok || leido.valor.unidades < 1n) return err("RINDE_INVALIDO");
  return ok(cantidadDesdeTexto(texto));
}

/**
 * Los componentes que manda la pantalla, ya con su forma comprobada (lista de permitidos): de 0 a `MAXIMO_DE_COMPONENTES`, cada uno con
 * producto (UUID), cantidad mayor que cero, unidad conocida y, si trae pérdida, un porcentaje bien escrito. Una lista vacía pasa: la
 * rechaza el dominio como `COMPOSICION_VACIA`.
 */
export function leerComponentes(valor: unknown): R<readonly ComponenteLeido[]> {
  if (!Array.isArray(valor)) return err("COMPOSICION_VACIA");
  if (valor.length > MAXIMO_DE_COMPONENTES) return err("COMPOSICION_VACIA");
  const leidos: ComponenteLeido[] = [];
  for (const crudo of valor as unknown[]) {
    const componente = (typeof crudo === "object" && crudo !== null ? crudo : {}) as Record<
      string,
      unknown
    >;
    const productoId = componente["productoId"];
    if (typeof productoId !== "string" || !esUuid(productoId)) {
      return err("COMPONENTE_NO_CONTROLADO");
    }
    const cantidad = leerCantidad(componente["cantidad"]);
    if (!cantidad.ok) return cantidad;
    const unidadId = componente["unidadId"];
    if (typeof unidadId !== "string" || !esUnidadConocida(unidadId)) {
      return err("IDENTIFICADOR_INVALIDO");
    }
    const textoDePerdida = componente["perdida"];
    let perdida: Porcentaje | null = null;
    if (textoDePerdida !== undefined && textoDePerdida !== null) {
      if (typeof textoDePerdida !== "string" || !FORMA_DE_LA_PERDIDA.test(textoDePerdida)) {
        return err("PERDIDA_INVALIDA");
      }
      perdida = porcentajeDesdeTexto(textoDePerdida);
    }
    leidos.push({
      productoId: productoId.toLowerCase(),
      cantidad: cantidad.valor,
      unidadId,
      perdida,
    });
  }
  return ok(leidos);
}

/** El error de la validación del dominio como error del módulo (los códigos que comparten el nombre pasan tal cual). */
export function errorDeComposicion(error: ErrorDeComposicion): ErrorDeStock {
  if (error.codigo === "FUNCION_NO_INCLUIDA") {
    return { error: "FUNCION_NO_INCLUIDA", perilla: error.perilla };
  }
  if (error.codigo === "UNIDAD_INVALIDA") return "IDENTIFICADOR_INVALIDO";
  if (error.codigo === "FUERA_DE_RANGO") return "CANTIDAD_INVALIDA";
  return error.codigo;
}

/** Las perillas de la receta, leídas del plan solo si alguien pidió pérdida o un elaborado (si no, nada las consulta). */
export async function perillasDeLaReceta(
  tx: TxDeStock,
  contexto: ContextoOperativo,
  pedida: boolean,
): Promise<PerillasDeComposicion> {
  if (!pedida) return { composiciones_con_perdida: false, subcomposiciones: false };
  const derechos = await tx.derechos.deLaEmpresa(contexto);
  const alcance = { empresaId: contexto.empresaId };
  return {
    composiciones_con_perdida: exigirPerilla(derechos, "composiciones_con_perdida", alcance).ok,
    subcomposiciones: exigirPerilla(derechos, "subcomposiciones", alcance).ok,
  };
}

/** El componente de una receta como lo comparan dos versiones: a quién (artículo o elaborado), cuánto neto, en qué unidad y con cuánta merma. */
export type ComponenteCanonico = Readonly<{
  articuloId: string | null;
  compuestoId: string | null;
  cantidad: string;
  unidadId: string;
  /** Texto decimal de la merma; `null` o cero = sin merma. */
  perdida: string | null;
}>;

/**
 * El contenido de una receta en forma canónica (rinde, componentes sin depender del orden, merma y pasos): sirve para saber si no cambió
 * nada (repetir el guardado devuelve la versión vigente, I8). Una merma en cero y una ausente son lo mismo; unos pasos vacíos y ausentes también.
 */
export function contenidoCanonico(
  rinde: string,
  pasos: string | null,
  componentes: readonly ComponenteCanonico[],
): string {
  const ordenados = componentes
    .map((c) => {
      const perdida = porcentajeATexto(porcentajeDesdeTexto(c.perdida ?? "0"));
      const quien =
        c.articuloId === null ? `elaborado:${c.compuestoId}` : `articulo:${c.articuloId}`;
      return `${quien}|${cantidadATexto(cantidadDesdeTexto(c.cantidad))}|${c.unidadId}|${perdida}`;
    })
    .sort();
  return JSON.stringify([cantidadATexto(cantidadDesdeTexto(rinde)), pasos, ordenados]);
}

export const contenidoDeLaVersion = (version: ComposicionGuardada): string =>
  contenidoCanonico(version.rinde, version.pasos, version.componentes);

/** Los datos de una versión para la auditoría: a quién lleva, cuánto, en qué unidad y con qué merma, y los pasos. */
export const resumenDeLaVersion = (version: ComposicionGuardada) => ({
  version: version.numero,
  rinde: version.rinde,
  pasos: version.pasos,
  componentes: version.componentes.map((c) => ({
    articuloId: c.articuloId,
    compuestoId: c.compuestoId,
    cantidad: c.cantidad,
    unidadId: c.unidadId,
    perdida: c.perdida,
  })),
});
