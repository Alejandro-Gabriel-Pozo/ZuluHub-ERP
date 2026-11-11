/**
 * Reglas de dependencia entre módulos de negocio (E0-T5, e0 §3.6.2), en archivo propio para que `reglas.cjs`
 * (sobre el tope de líneas del libro de deuda) no crezca; `reglas.cjs` las reparte con un spread.
 * Las rutas son relativas a la raíz del repositorio. Todas con severidad `error` y su violación inyectada
 * en `test/arquitectura/reglas.test.ts`.
 */

/** @type {import("dependency-cruiser").IForbiddenRuleType[]} */
module.exports = [
  {
    name: "ventas-sin-fiscal",
    severity: "error",
    comment:
      "E1 §3.4. ventas no importa fiscal, ni siquiera por su publico.ts: para facturar un ticket declara su propio puerto (`FacturadorDeTickets`, con tipos de ventas) y la composición (src/composicion) lo implementa; es el único lugar donde se tocan los dos módulos. Previene que ventas dependa de los tipos y errores de fiscal (cada cambio del facturador rompería ventas) y el ciclo de módulos; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/ventas/" },
    to: { path: "^src/modulos/fiscal/" },
  },
  {
    name: "ventas-sin-stock",
    severity: "error",
    comment:
      "E5-T12 (e5 §3.3). ventas no importa stock, ni siquiera por su publico.ts: para descontar y devolver stock declara su propio puerto (`StockDeVentas`, con tipos de ventas) y la composición (src/composicion/stock-de-ventas.ts) lo implementa con los puertos de stock; es el único lugar donde se tocan los dos módulos (con base-sin-ventas, stock tampoco importa ventas). Previene que ventas dependa de los tipos y errores de stock (cada cambio del libro rompería ventas) y el ciclo de módulos; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/ventas/" },
    to: { path: "^src/modulos/stock/" },
  },
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
    name: "caja-sin-negocio-ajeno",
    severity: "error",
    comment:
      "E3 (e3 §5.3). caja no importa fiscal, reservas, clientes, catalogo ni stock, ni por su publico.ts (ventas ya lo cubre base-sin-ventas): caja registra el dinero que entró y no conoce lo que se vendió; lo que necesita de afuera (el total de un ticket) lo declara como puerto y la composición lo implementa. Previene que el dinero dependa de los módulos que lo usan (ciclo) y que un cobro se arme con datos de otro dominio; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/caja/" },
    to: { path: "^src/modulos/(fiscal|reservas|clientes|catalogo|stock)/" },
  },
  {
    name: "cierre-sin-negocio",
    severity: "error",
    comment:
      "E0-T5 (e0 §3.6.2; e3b §3.1). cierre no importa ningún módulo de negocio (catalogo, caja, ventas, stock, fiscal, clientes, reservas), ni por su publico.ts: declara un puerto y los módulos lo implementan. Previene que el cierre del día dependa de los módulos que lo usan (ciclo); si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/cierre/" },
    to: { path: "^src/modulos/(catalogo|caja|ventas|stock|fiscal|clientes|reservas)/" },
  },
  {
    name: "empresas-sin-negocio",
    severity: "error",
    comment:
      "E0-T7 (e0 §3.6.2; decisión 165, e3 §3.2.1). empresas no importa caja, ni por su publico.ts: declara el puerto GanchosDeSucursal y caja lo implementa y la composición lo registra. Previene que crear una sucursal dependa del módulo de dinero (ciclo: caja ya depende de empresas); si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/empresas/" },
    to: { path: "^src/modulos/caja/" },
  },
];
