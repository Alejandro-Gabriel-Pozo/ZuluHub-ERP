import "server-only";

import { PERMISOS_DE_PLATAFORMA } from "../../../src/capacidades/permisos/plataforma";
import {
  NOMBRES_DE_LISTAS,
  LISTAS_DE_LA_CONSOLA,
  listaDeLaConsola,
  type ListaDeLaConsola,
} from "../logica/listas-del-sistema";
import type { ValorParaLaPantalla } from "../logica/cambio-de-lista";
import { exigirAcceso } from "./acceso";
import { fallaDe, protegida, type Falla } from "./proteccion";

export type { Falla } from "./proteccion";

const ETIQUETA = "listas";

export type ResumenDeLista = Readonly<{
  nombre: string;
  titulo: string;
  /** Cuántos valores se ofrecen hoy (los activos). */
  activos: number;
}>;

export type ResultadoDeResumen = Readonly<{ ok: true; listas: readonly ResumenDeLista[] }> | Falla;

export type ResultadoDeLista =
  | Readonly<{
      ok: true;
      lista: ListaDeLaConsola;
      valores: readonly ValorParaLaPantalla[];
      /** Si quien mira puede cambiar la lista. Solo una ayuda para apagar los botones: el guard y el segundo factor deciden al enviar. */
      puedeEditar: boolean;
    }>
  | Falla;

/** Las listas con la cantidad de valores activos (`listas.ver`). */
export async function resumenDeListas(): Promise<ResultadoDeResumen> {
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const resultado = await acceso.consultas.listarValoresDeLista({});
    if (!resultado.ok) return fallaDe(ETIQUETA, resultado.error);
    return {
      ok: true as const,
      listas: NOMBRES_DE_LISTAS.map((nombre) => {
        const { lista, titulo } = LISTAS_DE_LA_CONSOLA[nombre];
        return {
          nombre,
          titulo,
          activos: resultado.valor.valores.filter((v) => v.lista === lista && v.activo).length,
        };
      }),
    };
  });
}

/** Los valores de una lista (activos e inactivos) con la versión de cada uno (`listas.ver`). `null`: esa lista no existe. */
export async function valoresDeLaLista(nombre: string): Promise<ResultadoDeLista | null> {
  const lista = listaDeLaConsola(nombre);
  if (lista === null) return null;
  return protegida(ETIQUETA, async () => {
    const acceso = await exigirAcceso();
    const resultado = await acceso.consultas.listarValoresDeLista({ lista: lista.lista });
    if (!resultado.ok) return fallaDe(ETIQUETA, resultado.error);
    return {
      ok: true as const,
      lista,
      // Por nombre, con la fija («Otra») al final, como la maqueta.
      valores: [...resultado.valor.valores]
        .sort((a, b) => Number(a.fija) - Number(b.fija))
        .map((v) => ({
          id: v.id,
          nombre: v.nombre,
          activo: v.activo,
          fija: v.fija,
          version: v.version,
        })),
      puedeEditar: PERMISOS_DE_PLATAFORMA["listas.editar"].some((rol) => rol === acceso.admin.rol),
    };
  });
}
