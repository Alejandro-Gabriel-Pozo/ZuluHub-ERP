import {
  estaEncendida,
  esValorDeLaPerilla,
  type ValorDePerilla,
} from "../../../capacidades/planes/valores";
import type { DefinicionDePerilla } from "../../../capacidades/planes/perillas";
import {
  decidirCambio,
  motivoValido,
  type Decision,
  type ErrorDeCambio,
} from "../../../capacidades/planes/vigencia";
import type { EmpresaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Ajuste de perilla (marcas y planes, §B.5.6 y G.4): el extra (o la excepción) que paga un cliente,
 * de todo su tenant o de una empresa. Solo inserción, con vigencia y «la última decisión manda»; se
 * corrige con otro ajuste y `DEL_PLAN` vuelve al valor del plan. Sobrevive al cambio de plan (D-M3).
 * Dominio puro; el guard, la idempotencia y la auditoría son del caso de uso.
 *
 * La serie de un ajuste es el historial de UNA perilla en UN alcance (el tenant, o una empresa): el
 * caso de uso pasa esa serie; el número y `numeroEsperado` son de la serie.
 */

export type PedidoDeAjuste = Readonly<{
  ahora: Date;
  perilla: string;
  /** `null`: el ajuste es de todo el tenant. */
  empresaId: EmpresaId | null;
  /** El valor nuevo, o `DEL_PLAN`. Llega sin tipar (de la consola): se valida contra la perilla. */
  valor: unknown;
  vigenteDesde: Date;
  motivo: string;
  numeroEsperado: number | null;
  reemplazaProgramada: boolean;
  /**
   * El valor efectivo AHORA de cada perilla en este alcance (los derechos del tenant, o de la empresa).
   * Sirve para negar un ajuste que enciende una perilla cuya `requiere` está apagada.
   */
  valoresActuales: ReadonlyMap<string, ValorDePerilla>;
}>;

export type ErrorDeAjuste =
  | ErrorDeCambio
  | Readonly<{
      codigo: "PERILLA_DESCONOCIDA" | "AMBITO_NO_PERMITIDO" | "MOTIVO_OBLIGATORIO";
    }>
  | Readonly<{ codigo: "VALOR_DE_PERILLA_INVALIDO"; perilla: string }>
  | Readonly<{ codigo: "PERILLA_REQUIERE_OTRA"; perilla: string; requiere: string }>;

export type AjusteDecidido = Readonly<{
  numero: number;
  valor: ValorDePerilla | "DEL_PLAN";
  motivo: string;
  reemplazadas: readonly number[];
}>;

/**
 * Decide un ajuste. Orden de los errores: motivo obligatorio, perilla desconocida, ámbito no permitido
 * (una perilla de ámbito TENANT no se ajusta por empresa; las demás sí, por tenant o por empresa),
 * valor inválido (tipo equivocado o fuera de rango), `requiere` apagada y después la vigencia
 * (`decidirCambio`).
 *
 * `PERILLA_REQUIERE_OTRA`: se rechaza encender (interruptor encendido o límite mayor que 0) una
 * perilla cuya requerida está apagada en `valoresActuales`; apagar otra, o `DEL_PLAN`, no se rechaza
 * (el valor efectivo de la dependiente queda apagado mientras la requerida lo esté).
 */
export function decidirAjuste(
  catalogoDePerillas: Readonly<Record<string, DefinicionDePerilla>>,
  historial: readonly Decision[],
  pedido: PedidoDeAjuste,
): Resultado<AjusteDecidido, ErrorDeAjuste> {
  const motivo = motivoValido(pedido.motivo);
  if (motivo === null) return err({ codigo: "MOTIVO_OBLIGATORIO" });
  const definicion = Object.hasOwn(catalogoDePerillas, pedido.perilla)
    ? catalogoDePerillas[pedido.perilla]
    : undefined;
  if (definicion === undefined) return err({ codigo: "PERILLA_DESCONOCIDA" });
  if (definicion.ambito === "TENANT" && pedido.empresaId !== null) {
    return err({ codigo: "AMBITO_NO_PERMITIDO" });
  }
  let valor: ValorDePerilla | "DEL_PLAN";
  if (pedido.valor === "DEL_PLAN") {
    valor = "DEL_PLAN";
  } else if (esValorDeLaPerilla(definicion, pedido.valor)) {
    valor = pedido.valor;
    const requiere = definicion.requiere;
    if (requiere !== undefined && estaEncendida(valor)) {
      const requerida = pedido.valoresActuales.get(requiere);
      if (requerida === undefined || !estaEncendida(requerida)) {
        return err({ codigo: "PERILLA_REQUIERE_OTRA", perilla: pedido.perilla, requiere });
      }
    }
  } else {
    return err({ codigo: "VALOR_DE_PERILLA_INVALIDO", perilla: pedido.perilla });
  }
  const cambio = decidirCambio(historial, pedido);
  if (!cambio.ok) return cambio;
  return ok({
    numero: cambio.valor.numero,
    valor,
    motivo,
    reemplazadas: cambio.valor.reemplazadas,
  });
}
