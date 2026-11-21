import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { claveDeNombre } from "../../../primitivas/texto/nombre-de-producto";

/**
 * LOS RENGLONES DE UNA SECCIÓN DE LA CARTA (A8, CU-F8): lo que se ordena a mano y se destaca (★) es un RENGLÓN: una familia agrupada o un producto suelto. Funciones PURAS,
 * sin base ni reloj: qué renglones tiene una sección y si un orden pedido es exactamente esa lista. Una familia es renglón de la sección cuando está activa, agrupa en la
 * carta, tiene dos o más miembros y todos están en esa misma sección (la familia no tiene sección propia: toma la de sus miembros; decisión del dueño, 16/11/2026); si no,
 * cada miembro es un producto suelto de SU sección. Sin sección, nada se ordena.
 */
export type TipoDeRenglon = "PRODUCTO" | "FAMILIA";

export type Renglon = Readonly<{ tipo: TipoDeRenglon; id: string; nombre: string }>;

export type ProductoParaRenglones = Readonly<{
  id: string;
  nombre: string;
  seccionId: string | null;
}>;

export type FamiliaParaRenglones = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
  agruparEnCarta: boolean;
  /** Sus miembros vigentes con la sección de cada uno. */
  miembros: readonly Readonly<{ productoId: string; seccionId: string | null }>[];
}>;

/** ¿La familia es un renglón (agrupado) y de qué sección? `null` si sus miembros salen sueltos. */
export function seccionDeLaFamilia(familia: FamiliaParaRenglones): string | null {
  if (!familia.activa || !familia.agruparEnCarta || familia.miembros.length < 2) return null;
  // Stryker disable next-line OptionalChaining: con dos o más miembros hay un primero; el `?.` solo satisface al compilador.
  const primera = familia.miembros[0]?.seccionId ?? null;
  return familia.miembros.every((m) => m.seccionId === primera) ? primera : null;
}

/** Por nombre sin mayúsculas y, si empatan, por id (único): dos renglones nunca comparan igual. */
// Stryker disable EqualityOperator: las claves nunca son iguales (el id es único), así que `<=` equivale a `<`, y las ramas del desempate se ejercen por el orden alfabético y por el empate de nombres.
const porNombre = (a: Renglon, b: Renglon): number =>
  `${claveDeNombre(a.nombre)}\u0000${a.id}` < `${claveDeNombre(b.nombre)}\u0000${b.id}` ? -1 : 1;
// Stryker restore EqualityOperator

/** Los renglones de la sección, en orden alfabético (el de «Alfabético» y el punto de partida de «A mano»). */
export function renglonesDeSeccion(
  seccionId: string,
  productos: readonly ProductoParaRenglones[],
  familias: readonly FamiliaParaRenglones[],
): readonly Renglon[] {
  const enAgrupadas = new Set(
    familias
      .filter((f) => seccionDeLaFamilia(f) !== null)
      .flatMap((f) => f.miembros.map((m) => m.productoId)),
  );
  const deFamilias = familias
    .filter((f) => seccionDeLaFamilia(f) === seccionId)
    .map((f): Renglon => ({ tipo: "FAMILIA", id: f.id, nombre: f.nombre }));
  const sueltos = productos
    .filter((p) => p.seccionId === seccionId && !enAgrupadas.has(p.id))
    .map((p): Renglon => ({ tipo: "PRODUCTO", id: p.id, nombre: p.nombre }));
  return [...deFamilias, ...sueltos].sort(porNombre);
}

export type ErrorDeOrdenPedido =
  "LISTA_DE_RENGLONES_INCOMPLETA" | "RENGLON_REPETIDO" | "RENGLON_NO_ENCONTRADO";

/** El orden pedido tiene que ser EXACTAMENTE los renglones de la sección, una vez cada uno. */
export function validarOrdenPedido(
  actuales: readonly Renglon[],
  pedido: readonly Readonly<{ tipo: TipoDeRenglon; id: string }>[],
): Resultado<readonly Renglon[], ErrorDeOrdenPedido> {
  const clave = (r: Readonly<{ tipo: TipoDeRenglon; id: string }>) => `${r.tipo}:${r.id}`;
  const porClave = new Map(actuales.map((r) => [clave(r), r]));
  if (new Set(pedido.map(clave)).size !== pedido.length) return err("RENGLON_REPETIDO");
  const ordenado: Renglon[] = [];
  for (const p of pedido) {
    const r = porClave.get(clave(p));
    if (r === undefined) return err("RENGLON_NO_ENCONTRADO");
    ordenado.push(r);
  }
  return ordenado.length === actuales.length ? ok(ordenado) : err("LISTA_DE_RENGLONES_INCOMPLETA");
}
