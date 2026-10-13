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
 * `empresas_por_tenant` (base 1: el grupo de empresas es de pago) la verifica el alta de empresa de la
 * plataforma. Las demás (`cajas_por_sucursal`, `reserva_provisoria`, …) las registra cada módulo cuando
 * la verifica (§B.5.1, catálogo consolidado). Catálogo y stock (T0 y CE0) declaran las suyas por
 * adelantado, antes de que existan los casos de uso que las verifican, para que ningún otro tramo
 * toque este archivo (catalogo-y-stock §E.2): son los extras de recetas (mermas, sub-recetas y factor
 * por tamaño) y los niveles de elecciones del catálogo (variantes con precio y grupos de precio,
 * combos, biblioteca). Cada tramo que las verifica con `exigirPerilla` las cubre; hasta entonces
 * ningún caso de uso las nombra (no existe todavía la prueba «toda perilla tiene un uso»). Todas son
 * interruptores de empresa con base apagada: si el plan no las nombra, no vienen. `carta_por_qr` y las
 * de la carta (fotos, modelos, estadísticas) se declaran cuando se construya la carta.
 */
export const CATALOGO_DE_PERILLAS = {
  empresas_por_tenant: {
    ambito: "TENANT",
    tipo: "LIMITE",
    base: { limite: 1 },
    modulo: "administracion",
  },
  // Stock (catalogo-y-stock §C): los extras de la receta; la verifican `guardarReceta` y
  // `guardarRecetaDeOpcion` (T10 y T14). Lo ya guardado con pérdida o con elaborados se sigue aplicando
  // aunque la perilla se apague (baja de plan): lo que se rechaza es guardar una receta nueva.
  recetas_con_merma: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  sub_recetas: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  // CE0 (catalogo-carta-niveles-y-elecciones §2.1): un interruptor por nivel extra de la escalera de
  // elecciones. El de stock (`recetas_por_tamano`, N4) escala la receta por tamaño y suma la excepción
  // por variante; los de catálogo (N1 a N3) habilitan precio por variante y grupos de precio, combos y
  // la biblioteca de guarniciones y adicionales compartidos. N0 (la vidriera, con ejes por base más
  // agregado) es estándar y no tiene perilla.
  variantes_y_grupos_de_precio: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "catalogo",
  },
  combos: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "catalogo",
  },
  elecciones_reutilizables: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "catalogo",
  },
  recetas_por_tamano: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
} as const satisfies Record<string, DefinicionDePerilla>;

export type ClavePerilla = keyof typeof CATALOGO_DE_PERILLAS;
