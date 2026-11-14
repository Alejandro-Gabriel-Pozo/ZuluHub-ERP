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
 * por tamaño) y el nivel de combos del catálogo. Cada tramo que las verifica con `exigirPerilla` las
 * cubre; hasta entonces ningún caso de uso las nombra (no existe todavía la prueba «toda perilla tiene
 * un uso»). Esas son interruptores de empresa con base apagada: si el plan no las nombra, no vienen. `vidriera_por_qr` (T2 de la carta real) ya está declarada; las
 * demás de la carta (fotos, modelos, estadísticas) se declaran cuando se construya la carta.
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
  composiciones_con_perdida: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  subcomposiciones: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  // E6 (e6-recetas-produccion-especificacion §3.7, D146: la cafetería no usa producción): todo nace apagado (`produccion` se declara con su módulo). `lotes` y `calidad_de_lote` dejan controlar lotes y su calidad. Lo ya guardado se sigue aplicando si se apagan
  // (baja de plan): lo que se rechaza es crear controles u órdenes nuevos.
  lotes: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  calidad_de_lote: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  // E6-T8: producir en tandas (D146: la cafetería no lo usa). La verifica `abrirOrden`; es del módulo `produccion`.
  produccion: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "produccion",
  },
  // CE0 (catalogo-carta-niveles-y-elecciones §2.1): un interruptor por nivel extra de la escalera de
  // elecciones. El de stock (`composiciones_por_tamano`, N4) escala la receta por tamaño y suma la excepción
  // por variante; el de catálogo (`conjuntos`, combos) habilita los conjuntos. Las de variantes con grupos de
  // precio y la biblioteca de elecciones compartidas se retiraron (decisiones 138 y 133: ya no existen).
  conjuntos: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "catalogo",
  },
  composiciones_por_tamano: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "stock",
  },
  // Salón (E7, DEC-0201; respuesta del dueño del 11/11/2026 «extras excepto comanda»): el salón es un extra de pago y las comandas van en todos los
  // planes. Base apagada: si el plan no la nombra, no viene. La verifican todos los casos de uso y consultas del salón con `exigirPerilla`.
  salon: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "salon",
  },
  // A7 (decisión del dueño, 14/11/2026, `decisiones-del-dueno-2026-11.md`: «la venta por fracciones y por peso se construye ya, con perilla apagada por defecto»):
  // vender un producto por fracciones (porciones 2, 4 y 8) o por peso (unidad de venta de masa). Base apagada: sin ella un producto solo se vende «por unidad,
  // paso 1» (el piloto). La verifica `cambiarFormaDeVenta` al PONER una forma distinta del piloto; lo ya cargado se sigue vendiendo si se baja el plan.
  venta_por_fracciones_y_peso: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "catalogo",
  },
  // Carta pública en línea (QR): extra de pago, apagado de base y se habilita por empresa, como `salon` (dueño, Q5 del 12/11/2026: «no se cobra desde el día 1,
  // después sí seguro»; carta-real-especificacion §0 y §11). La verifica `guardarCartaPublica` al PONER la carta en línea; retirarla no la pide (una baja de
  // plan no impide cerrar lo ya abierto). Que el comensal siga viendo la carta si el plan se baja lo decide la lectura pública por visita (T6).
  vidriera_por_qr: {
    ambito: "EMPRESA",
    tipo: "INTERRUPTOR",
    base: { encendida: false },
    modulo: "vidriera",
  },
  // Caja (decisión 124; caja-y-cobros.md:43, 69; registro de contratos :778; supuesto S-5 de E0: nombre y base 1 del
  // registro de octubre): cuántas cajas activas puede tener una sucursal. Base 1 («Caja 1» nace con la sucursal, decisión
  // 165); la sube la plataforma. Declara el tipo; `crearCaja` y `reactivarCaja` la verifican con `exigirPerilla` en E3.
  cajas_por_sucursal: {
    ambito: "SUCURSAL",
    tipo: "LIMITE",
    base: { limite: 1 },
    modulo: "caja",
  },
} as const satisfies Record<string, DefinicionDePerilla>;

export type ClavePerilla = keyof typeof CATALOGO_DE_PERILLAS;
