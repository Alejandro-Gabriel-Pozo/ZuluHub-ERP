import type { ClaveModulo } from "../modulos/catalogo";

/**
 * Catálogo de perillas (marcas y planes, §B.5.1). Una perilla es una función configurable por venta:
 * clave + ámbito + valor. Es código, no base de datos: de acá sale el tipo cerrado `ClavePerilla`, así
 * que una perilla mal escrita no compila, y cada valor que un plan o un ajuste fije se valida contra
 * su definición.
 *
 * Solo dos tipos, sin un tipo «nivel»: cada nivel extra de una escalera es un INTERRUPTOR (base 0) y
 * un tope es un LÍMITE. Una perilla que nadie verifica no se declara: cada módulo registra las suyas
 * en el tramo que las verifica con `exigirPerilla`.
 */

/** Un límite: un entero ≥ 0 (0 = apagada) o sin tope. */
export type LimiteDePerilla = number | "ILIMITADO";

/** Dónde se CUENTA el uso. El valor sale siempre del tenant o de la empresa (los ajustes no son por sucursal). */
export type AmbitoDePerilla = "TENANT" | "EMPRESA" | "SUCURSAL";

type ComunDeUnaPerilla = Readonly<{
  ambito: AmbitoDePerilla;
  /** Quién la verifica (cruce como X1). */
  modulo: ClaveModulo;
  /** Otra perilla que tiene que estar encendida para que esta valga (p. ej. un nivel 3 requiere el 2). */
  requiere?: string;
}>;

/**
 * La definición de una perilla. `base` es el estándar (`funciones-de-pago.md`): el valor que rige si ni
 * el plan ni un ajuste dicen otra cosa. Se escribe sin etiqueta porque `tipo` ya la da: un interruptor
 * trae `{ encendida }`, un límite trae `{ limite }`, y mezclarlos no compila.
 */
export type DefinicionDePerilla = ComunDeUnaPerilla &
  (
    | Readonly<{ tipo: "INTERRUPTOR"; base: Readonly<{ encendida: boolean }> }>
    | Readonly<{ tipo: "LIMITE"; base: Readonly<{ limite: LimiteDePerilla }> }>
  );

/**
 * v1 trae una sola perilla real: `empresas_por_tenant` (base 1: el grupo de empresas es de pago), que
 * verifica el alta de empresa de la plataforma. Las demás (`cajas_por_sucursal`, `carta_por_qr`,
 * `reserva_provisoria`, …) las registra cada módulo cuando la verifica (§B.5.1, catálogo consolidado).
 */
export const CATALOGO_DE_PERILLAS = {
  empresas_por_tenant: {
    ambito: "TENANT",
    tipo: "LIMITE",
    base: { limite: 1 },
    modulo: "administracion",
  },
} as const satisfies Record<string, DefinicionDePerilla>;

export type ClavePerilla = keyof typeof CATALOGO_DE_PERILLAS;
