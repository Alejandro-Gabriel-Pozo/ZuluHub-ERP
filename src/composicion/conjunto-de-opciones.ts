import { createHash } from "node:crypto";
import type { EntradaDeEditarOpciones, GrupoDeFicha } from "../modulos/catalogo/publico";
import { claveDeNombre } from "../primitivas/texto/nombre-de-producto";
import type { PedidoDeGrupo } from "./entradas-de-opciones";

/**
 * El conjunto final de grupos que pide `editarOpciones`, armado a partir de lo guardado y de UN grupo que la pantalla guarda (A13, tramo Opciones). Puro: sin base ni servidor.
 *
 * `editarOpciones` recibe el conjunto FINAL de todo el producto (lo que no figura queda desactivado), pero la pantalla edita un grupo por vez: acá se arma el conjunto con todo lo que
 * ya estaba tal cual (grupos de otras clases incluidos, también los desactivados, con sus opciones) y el grupo que se guarda reemplazado o agregado. Lo que el caso de uso compara y
 * versiona (nombre, recargo, factor) sale idéntico a lo guardado para lo que no se tocó: no se escribe nada de más.
 *  - Una opción que la pantalla ya no manda se quita del grupo: el caso de uso la desactiva (nada se borra).
 *  - Una opción nueva con el nombre de una opción desactivada del mismo grupo la reactiva (misma clave de nombre): el nombre es único por grupo, también entre las desactivadas.
 *  - Los ids de lo nuevo se derivan de la clave del cambio, no se sortean: repetir el mismo pedido da los mismos ids y el caso de uso lo reconoce como «ya estaba».
 *  - El orden de lo guardado se conserva; lo nuevo va al final.
 * Chequeo: `conjunto-de-opciones.test.ts`.
 */

export type GrupoParaGuardar = EntradaDeEditarOpciones["grupos"][number];

/** Un id con forma de uuid (versión 5) derivado, de manera estable, de una clave y una posición. Es el mismo para el mismo par: lo que hace repetible el pedido. */
export function idDerivado(clave: string, posicion: number): string {
  // Los primeros 16 bytes del hash, con los bits de versión (5) y de variante de un uuid.
  const bytes = createHash("sha256")
    .update(`opcion:${clave}:${String(posicion)}`)
    .digest()
    .subarray(0, 16);
  bytes.writeUInt8((bytes.readUInt8(6) & 0x0f) | 0x50, 6);
  bytes.writeUInt8((bytes.readUInt8(8) & 0x3f) | 0x80, 8);
  const x = bytes.toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}

/** Un grupo guardado tal cual lo vio la pantalla, listo para volver a mandarse sin cambios. */
function comoEstaba(g: GrupoDeFicha): GrupoParaGuardar {
  return {
    id: g.id,
    clase: g.clase,
    nombre: g.nombre,
    esTamano: g.esTamano,
    esObligatorio: g.esObligatorio,
    admiteVarias: g.admiteVarias,
    seMuestraEnCarta: g.seMuestraEnCarta,
    orden: g.orden,
    activo: g.activo,
    opciones: g.opciones.map((o) => ({
      id: o.id,
      nombre: o.nombre,
      recargo: o.recargo,
      orden: o.orden,
      activa: o.activa,
      factorDeTamano: o.factorDeTamano,
    })),
  };
}

/** El más alto de una lista de órdenes (0 si no hay). */
const maximo = (ordenes: readonly number[]): number => Math.max(0, ...ordenes);

/** La variante no lleva recargo en sus opciones (el precio de cada medida es propio): siempre cero. */
const recargoDe = (pedido: PedidoDeGrupo, recargo: string): string =>
  pedido.esVariante ? "0.00" : recargo;

export type ConjuntoArmado = Readonly<{ grupos: readonly GrupoParaGuardar[]; grupoId: string }>;

/**
 * El conjunto final con el grupo del pedido, o `"GRUPO_NO_EDITABLE"` si el grupo que se pide editar no existe, está desactivado o es la variante (la variante se edita en la pantalla de
 * medidas, no acá). `existentes` son todos los grupos guardados del producto.
 */
export function armarElConjunto(
  existentes: readonly GrupoDeFicha[],
  pedido: PedidoDeGrupo,
): ConjuntoArmado | "GRUPO_NO_EDITABLE" {
  // Un grupo nuevo lleva por id la clave del cambio: si ya existe, es el reintento del mismo pedido (el primero ya salió bien) y se lo trata como el grupo que es.
  const grupoId = pedido.grupoId ?? pedido.claveDelCambio;
  const actual = existentes.find((g) => g.id === grupoId) ?? null;
  if (pedido.grupoId !== null && actual === null) return "GRUPO_NO_EDITABLE";
  if (actual !== null && (!actual.activo || (actual.clase === "VARIANTE") !== pedido.esVariante))
    return "GRUPO_NO_EDITABLE";

  const guardadas = actual === null ? [] : actual.opciones;
  let siguiente = maximo(guardadas.map((o) => o.orden)) + 1;
  const usadas = new Set<string>();
  const opciones: GrupoParaGuardar["opciones"][number][] = [];
  pedido.opciones.forEach((fila, posicion) => {
    const derivado = idDerivado(pedido.claveDelCambio, posicion);
    const nombre = claveDeNombre(fila.nombre.trim());
    // Una fila que ya existía; o, si es nueva, la que salió de este mismo pedido (reintento) o una opción desactivada del grupo con el mismo nombre (se reactiva).
    const existente =
      fila.id === null
        ? (guardadas.find((o) => o.id === derivado) ??
          guardadas.find((o) => !o.activa && claveDeNombre(o.nombre) === nombre))
        : guardadas.find((o) => o.id === fila.id);
    if (fila.id !== null && existente === undefined) return;
    if (existente !== undefined) {
      if (usadas.has(existente.id)) return;
      usadas.add(existente.id);
      opciones.push({
        id: existente.id,
        nombre: fila.nombre,
        recargo: recargoDe(pedido, fila.recargo),
        orden: existente.orden,
        activa: true,
        factorDeTamano: existente.factorDeTamano,
      });
      return;
    }
    opciones.push({
      id: derivado,
      nombre: fila.nombre,
      recargo: recargoDe(pedido, fila.recargo),
      orden: siguiente,
      activa: true,
    });
    siguiente += 1;
  });

  const editado: GrupoParaGuardar =
    actual === null
      ? {
          id: grupoId,
          clase: pedido.esVariante ? "VARIANTE" : pedido.clase,
          nombre: pedido.nombre,
          esTamano: pedido.esVariante && pedido.esTamano,
          esObligatorio: pedido.esVariante || pedido.esObligatorio,
          admiteVarias: !pedido.esVariante && pedido.admiteVarias,
          seMuestraEnCarta: pedido.esVariante || pedido.seMuestraEnCarta,
          orden: maximo(existentes.map((g) => g.orden)) + 1,
          activo: true,
          opciones,
        }
      : {
          ...comoEstaba(actual),
          nombre: pedido.nombre,
          ...(pedido.esVariante
            ? { esTamano: pedido.esTamano }
            : {
                esObligatorio: pedido.esObligatorio,
                admiteVarias: pedido.admiteVarias,
                seMuestraEnCarta: pedido.seMuestraEnCarta,
              }),
          opciones,
        };
  return {
    grupos:
      actual === null
        ? [...existentes.map(comoEstaba), editado]
        : existentes.map((g) => (g.id === grupoId ? editado : comoEstaba(g))),
    grupoId,
  };
}
