import { estadoDeModulos } from "../modulos/activos";
import type { DefinicionDeModulo } from "../modulos/catalogo";
import { valorDePerilla, type DerechosDeUso } from "./derechos";
import { estaEncendida } from "./valores";

/**
 * ¿El plan deja servir la carta pública de una empresa AHORA? (T6 de la carta real, riesgo R3; decisión del dueño del 13/11/2026.) Es la misma regla que aplica el
 * resto del sistema, sin una segunda: el estado de los módulos sale de `estadoDeModulos` y la perilla del valor efectivo de `derechosDeUso`; acá solo se juntan.
 * La carta se sirve solo si el módulo de la carta está ACTIVO (activado por la empresa Y dentro del techo de su plan: en solo lectura o apagado no se sirve) y la
 * perilla `vidriera_por_qr` está encendida. Cualquier otra cosa cierra (fail closed). Previene: un cliente que baja de plan y sigue mostrando su carta.
 *
 * Pura: sin reloj, sin azar, sin acceso a datos. Los derechos ya traen el instante (`leidoEn`) con el que se calcularon.
 */
export function elPlanDejaServirLaCarta<M extends string, P extends string>(
  e: Readonly<{
    catalogoDeModulos: Readonly<Record<M, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>;
    /** El módulo y la perilla de la carta (las claves reales las pone quien llama). */
    modulo: M;
    perilla: P;
    derechos: Pick<DerechosDeUso<M, P>, "modulosHabilitados" | "perillas">;
    /** Los módulos que la empresa activó (`modulo_de_empresa` con `activo`). */
    modulosActivados: readonly string[];
  }>,
): boolean {
  const { modulosActivos } = estadoDeModulos(e.catalogoDeModulos, e.modulosActivados, [
    ...e.derechos.modulosHabilitados,
  ]);
  return modulosActivos.has(e.modulo) && estaEncendida(valorDePerilla(e.derechos, e.perilla));
}
