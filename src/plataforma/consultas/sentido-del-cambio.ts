import {
  diferenciaEntreVersiones,
  type ContenidoParaComparar,
} from "../../capacidades/planes/diferencia";
import { sentidoDelCambio, type SentidoDelCambioDePlan } from "../../modulos/planes/publico";

type PedidoDeDiferencia = Parameters<typeof diferenciaEntreVersiones>[0];

/**
 * ¿Pasar de la versión que rige a la de destino es una SUBA o una BAJA? (H-14a, S-1: lo mixto es BAJA.) Sin versión que rija no hay nada que quitar: es una SUBA.
 * Una sola regla, un solo lugar: la usan `asignarPlan` (al registrar las condiciones del cambio) y la lectura que le muestra a la consola el sentido y la primera fecha válida de cada opción.
 * Previene: que lo que la consola muestra («es una baja, hasta el día X») difiera de lo que el servidor decide al registrar el cambio. Chequeo: `sentido-del-cambio.test.ts` y la integración de H-14b.
 */
export function sentidoDeCambiarDeVersion(
  pedido: Readonly<{
    actual: ContenidoParaComparar | null;
    destino: ContenidoParaComparar;
    catalogoDeModulos: PedidoDeDiferencia["catalogoDeModulos"];
    catalogoDePerillas: PedidoDeDiferencia["catalogoDePerillas"];
    ahora: Date;
  }>,
): SentidoDelCambioDePlan {
  if (pedido.actual === null) return "SUBA";
  return sentidoDelCambio(
    diferenciaEntreVersiones({
      catalogoDeModulos: pedido.catalogoDeModulos,
      catalogoDePerillas: pedido.catalogoDePerillas,
      desde: pedido.actual,
      hasta: pedido.destino,
      tenants: [],
      ahora: pedido.ahora,
    }),
  );
}
