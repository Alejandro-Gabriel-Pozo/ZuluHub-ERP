import { CATALOGO_DE_MODULOS } from "../../../../src/capacidades/modulos/catalogo";
import { CATALOGO_DE_PERILLAS } from "../../../../src/capacidades/planes/perillas";
import type { FilaDelMenu } from "./menu";

/**
 * Los problemas de una tabla (vacío = bien). Lo usa `test/arquitectura/menu-por-areas.test.ts` sobre la tabla real y sobre violaciones inyectadas. Toda fila tiene área y
 * grupo declarados, clave única, módulo y acción reales del catálogo (la acción es del módulo declarado), ruta propia que empieza con `/` y no se repite, y solo Ventas puede
 * llevar departamento. Un área o grupo declarado sin filas es una reserva válida: no aparece (todo nace cerrado).
 */
export function problemasDelMenu(
  filas: readonly FilaDelMenu[],
  areas: readonly Readonly<{ clave: string; fija: boolean }>[],
  grupos: readonly Readonly<{ clave: string }>[],
  maximoDeAreas: number,
): readonly string[] {
  const problemas: string[] = [];
  const deLaBarra = areas.filter((a) => !a.fija);
  if (deLaBarra.length > maximoDeAreas)
    problemas.push(`hay ${deLaBarra.length} áreas en la barra y el tope es ${maximoDeAreas}`);
  if (areas.filter((a) => a.fija).length > 1) problemas.push("hay más de un área fija");
  const listas: readonly (readonly [string, readonly string[]])[] = [
    ["área", areas.map((a) => a.clave)],
    ["grupo", grupos.map((g) => g.clave)],
    ["fila", filas.map((f) => f.clave)],
  ];
  for (const [nombre, lista] of listas) {
    for (const clave of lista) {
      if (lista.indexOf(clave) !== lista.lastIndexOf(clave))
        problemas.push(`${nombre} repetido: ${clave}`);
    }
  }
  const rutas = new Set<string>();
  for (const f of filas) {
    if (!areas.some((a) => a.clave === f.area))
      problemas.push(`${f.clave}: el área ${f.area} no está declarada`);
    if (!grupos.some((g) => g.clave === f.grupo))
      problemas.push(`${f.clave}: el grupo ${f.grupo} no está declarado`);
    if (f.departamento !== null && f.area !== "ventas")
      problemas.push(`${f.clave}: solo Ventas puede llevar departamento`);
    if (f.tipo === "pantalla") {
      const acciones: Readonly<Record<string, unknown>> = Object.hasOwn(
        CATALOGO_DE_MODULOS,
        f.modulo,
      )
        ? CATALOGO_DE_MODULOS[f.modulo].acciones
        : {};
      if (!Object.hasOwn(acciones, f.accion))
        problemas.push(`${f.clave}: la acción ${f.accion} no es del módulo ${f.modulo}`);
      if (f.perilla !== null && CATALOGO_DE_PERILLAS[f.perilla].modulo !== f.modulo)
        problemas.push(`${f.clave}: la función ${f.perilla} no es del módulo ${f.modulo}`);
      if (!f.href.startsWith("/")) problemas.push(`${f.clave}: la ruta tiene que empezar con /`);
      if (rutas.has(f.href)) problemas.push(`${f.clave}: la ruta ${f.href} está repetida`);
      rutas.add(f.href);
    }
  }
  return problemas;
}
