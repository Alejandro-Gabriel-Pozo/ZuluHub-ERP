import type { DefinicionDePerilla } from "./perillas";
import { valorDePerilla } from "./derechos";
import type { ValorEfectivo } from "./valores";

/**
 * Qué funciones de pago (perillas INTERRUPTOR) están encendidas para una empresa (escalabilidad X-1b). La pantalla las usa para no
 * ofrecer lo que el plan no incluye; ofrecer NO autoriza (el guard y `exigirPerilla` deciden al hacerlo). Una regla, un lugar: nadie más
 * decide «qué funciones mirar». Los LÍMITES (cajas por sucursal, empresas por tenant) no entran: no son «encendido o apagado».
 * Pura. Chequeo: `funciones-encendidas.test.ts`.
 */

type CatalogoDeInterruptores = Readonly<
  Record<string, Pick<DefinicionDePerilla, "tipo" | "modulo">>
>;

/** Los módulos que son dueños de alguna función interruptor: solo si la empresa tiene uno hace falta leer los derechos. */
export function modulosConInterruptores(catalogo: CatalogoDeInterruptores): ReadonlySet<string> {
  return new Set(
    Object.values(catalogo)
      .filter((definicion) => definicion.tipo === "INTERRUPTOR")
      .map((definicion) => definicion.modulo),
  );
}

/** Las claves de los interruptores encendidos hoy (plan vigente más ajustes), ordenadas. */
export function funcionesEncendidasDe<P extends string>(
  catalogo: Readonly<Record<P, Pick<DefinicionDePerilla, "tipo">>>,
  derechos: Readonly<{ perillas: ReadonlyMap<P, ValorEfectivo> }>,
): readonly P[] {
  return (Object.keys(catalogo) as P[])
    .filter((clave) => catalogo[clave].tipo === "INTERRUPTOR")
    .filter((clave) => {
      const valor = valorDePerilla(derechos, clave);
      return valor.tipo === "INTERRUPTOR" && valor.encendida;
    })
    .sort();
}
