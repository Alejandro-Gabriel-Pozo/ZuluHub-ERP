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
    name: "ventas-sin-salon-ni-comandas",
    severity: "error",
    comment:
      "E7 §3.1. ventas no importa salon ni comandas, ni siquiera por su publico.ts: el sentido es salon → comandas → ventas → caja y catálogo, y ventas nunca llama hacia arriba (el salón agrega su regla y llama a los casos internos de ventas dentro de la misma transacción). Previene el ciclo de módulos y que la cuenta (que también usa el mostrador) dependa de lo que solo existe en un restaurante; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/ventas/" },
    to: { path: "^src/modulos/(salon|comandas)/" },
  },
  {
    name: "comandas-sin-salon",
    severity: "error",
    comment:
      "E7 §3.1. comandas no importa salon, ni por su publico.ts: conoce cuentas y líneas por id opaco y recibe el rótulo («Mesa 5») ya armado; no sabe qué es una mesa. Previene el ciclo salon ↔ comandas y que la impresión (que usa también el mostrador) dependa del plano de mesas; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/comandas/" },
    to: { path: "^src/modulos/salon/" },
  },
  {
    name: "base-sin-salon-ni-comandas",
    severity: "error",
    comment:
      "E7 §3.1. catalogo, caja, stock y cierre no importan salon ni comandas, ni por su publico.ts: son la base y el salón las usa de arriba hacia abajo (ADR-014). Previene el ciclo de módulos que modulos-solo-por-publico no ve porque alcanza publico.ts para cruzar; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/(catalogo|caja|stock|cierre)/" },
    to: { path: "^src/modulos/(salon|comandas)/" },
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
    name: "clientes-sin-negocio",
    severity: "error",
    comment:
      "E9 (e9 §3.11). clientes (el directorio de partes) no importa compras ni ningún otro módulo de negocio (caja, catalogo, cierre, fiscal, reservas, stock, ventas), ni por su publico.ts: compras, ventas y facturación dependen del directorio de arriba hacia abajo y nunca al revés. Previene el ciclo de módulos (que modulos-solo-por-publico no ve porque alcanza publico.ts para cruzar) y que el directorio se arme con datos de otro dominio; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/clientes/" },
    to: { path: "^src/modulos/(caja|catalogo|cierre|compras|fiscal|reservas|stock|ventas)/" },
  },
  {
    name: "compras-sin-fiscal-ventas-ni-caja",
    severity: "error",
    comment:
      "E9 (e9 §3.11). compras no importa fiscal, ventas ni caja, ni por su publico.ts: copia lo que necesita (los tipos de comprobante y las alícuotas de fiscal, los medios de caja) con una prueba que compara la copia (`compras-fuente-unica.test.ts`), y lo que necesite de caja (el egreso del pago en efectivo) lo declara como puerto que la composición implementa. Previene que comprar dependa del facturador, de las ventas o del dinero (ciclos, y que un cambio de venta rompa compras); si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/compras/" },
    to: { path: "^src/modulos/(fiscal|ventas|caja)/" },
  },
  {
    name: "stock-sin-compras",
    severity: "error",
    comment:
      "E9 (e9 §3.11). stock no importa compras, ni por su publico.ts: compras usa los puertos de stock (la entrada por origen) y nunca al revés. Previene el ciclo de módulos (que modulos-solo-por-publico no ve porque alcanza publico.ts para cruzar) y que el libro de stock conozca recepciones y facturas; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/stock/" },
    to: { path: "^src/modulos/compras/" },
  },
  {
    name: "catalogo-sin-compras",
    severity: "error",
    comment:
      "E9 (e9 §3.2, X5). catalogo no importa compras, ni por su publico.ts: la presentación de un producto es del catálogo y compras la lee de él (compras → catálogo), nunca al revés. Previene el ciclo de módulos y que la ficha del producto dependa de proveedores y facturas; si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/catalogo/" },
    to: { path: "^src/modulos/compras/" },
  },
  {
    name: "produccion-solo-con-stock",
    severity: "error",
    comment:
      "E6-T9 (e6 §3.1). produccion no importa catalogo, caja, ventas, fiscal, clientes, compras, cierre ni reservas, ni por su publico.ts: solo consume a stock por su publico.ts (el libro y los lotes) y no escribe ninguna tabla ajena. Previene que producir dependa de lo que se vende o se cobra (ciclos, y que un cambio de venta rompa las órdenes); si se elimina, falla la violación inyectada de esta regla.",
    from: { path: "^src/modulos/produccion/" },
    to: { path: "^src/modulos/(catalogo|caja|ventas|fiscal|clientes|compras|cierre|reservas)/" },
  },
  {
    name: "negocio-sin-produccion",
    severity: "error",
    comment:
      "E6-T9 (e6 §3.1). Ningún módulo de negocio importa produccion, ni por su publico.ts: produccion depende de stock de arriba hacia abajo y la composición es el único lugar donde se toca. Previene el ciclo stock ↔ produccion (que modulos-solo-por-publico no ve porque alcanza publico.ts para cruzar) y que el libro de stock conozca órdenes de producción; si se elimina, falla la violación inyectada de esta regla.",
    from: {
      path: "^src/modulos/(catalogo|caja|ventas|fiscal|clientes|compras|cierre|reservas|stock)/",
    },
    to: { path: "^src/modulos/produccion/" },
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
