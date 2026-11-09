/**
 * Reglas de dependencia entre módulos de negocio (E0-T5, e0 §3.6.2), en archivo propio para que `reglas.cjs`
 * (sobre el tope de líneas del libro de deuda) no crezca; `reglas.cjs` las reparte con un spread.
 * Las rutas son relativas a la raíz del repositorio. Todas con severidad `error` y su violación inyectada
 * en `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    name: "base-sin-ventas",
    severity: "error",
    comment:
      "E0-T5 (e0 §3.6.2). catalogo, caja y stock no importan ventas, ni siquiera por su publico.ts: ventas depende de ellos de arriba hacia abajo y nunca al revés (ADR-014). Previene el ciclo de módulos, que modulos-solo-por-publico no ve porque alcanza publico.ts para cruzar; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/(catalogo|caja|stock)/" },
    to: { path: "^src/modulos/ventas/" },
  },
  {
    name: "catalogo-sin-caja-ni-stock",
    severity: "error",
    comment:
      "E0-T5 (e0 §3.6.2). catalogo es la capa de abajo: no importa caja ni stock, ni por su publico.ts. Previene que el precio o la ficha del producto dependan del dinero o del inventario, y el ciclo con ventas; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/catalogo/" },
    to: { path: "^src/modulos/(caja|stock)/" },
  },
  {
    name: "cierre-sin-negocio",
    severity: "error",
    comment:
      "E0-T5 (e0 §3.6.2; e3b §3.1). cierre no importa ningún módulo de negocio (catalogo, caja, ventas, stock, fiscal, clientes, reservas), ni por su publico.ts: declara un puerto y los módulos lo implementan. Previene que el cierre del día dependa de los módulos que lo usan (ciclo); si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/cierre/" },
    to: { path: "^src/modulos/(catalogo|caja|ventas|stock|fiscal|clientes|reservas)/" },
  },
];
