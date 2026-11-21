import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";

/**
 * Qué trae «Copiar de otro producto» (E2 mínimo §3.5; maqueta `productos.html`, función `loQueSeCopia`). Pura: es la ÚNICA regla de qué se copia, y la usan `copiarOpciones` (para
 * copiar) y la vista previa de la hoja (para mostrar), así lo que se ve antes de copiar es exactamente lo que se copia. Previene: una vista previa que prometa algo distinto de lo copiado.
 *  - Solo grupos ACTIVOS del origen, con sus opciones ACTIVAS; un grupo sin opciones activas no se trae.
 *  - Un grupo cuyo nombre (por `claveDeNombre`) el destino ya tiene (activo o no) no se trae.
 *  - La variante solo si `puedeTraerLaVariante` (lo decide quien llama con lo que sabe del destino: sin variante activa, sin precio de la empresa y misma forma de venta).
 * Chequeo: `copia-de-opciones.test.ts`.
 */

/** Un grupo con sus opciones, con la forma mínima que esta regla mira (los tipos completos los pone quien llama: `Grupo` y `Opcion` del modelo). */
type ConOpciones<G, O> = Readonly<{ grupo: G; opciones: readonly O[] }>;

export function loQueSeCopia<
  G extends Readonly<{ activo: boolean; nombre: string; clase: string }>,
  O extends Readonly<{ activa: boolean }>,
>(
  entrada: Readonly<{
    gruposDelOrigen: readonly ConOpciones<G, O>[];
    gruposDelDestino: readonly ConOpciones<Readonly<{ nombre: string }>, unknown>[];
    puedeTraerLaVariante: boolean;
  }>,
): readonly ConOpciones<G, O>[] {
  const clavesDelDestino = new Set(
    entrada.gruposDelDestino.map((g) => claveDeNombre(g.grupo.nombre)),
  );
  const salida: ConOpciones<G, O>[] = [];
  for (const { grupo, opciones } of entrada.gruposDelOrigen) {
    if (!grupo.activo) continue;
    if (clavesDelDestino.has(claveDeNombre(grupo.nombre))) continue;
    if (grupo.clase === "VARIANTE" && !entrada.puedeTraerLaVariante) continue;
    const activas = opciones.filter((o) => o.activa);
    if (activas.length === 0) continue;
    salida.push({ grupo, opciones: activas });
  }
  return salida;
}
