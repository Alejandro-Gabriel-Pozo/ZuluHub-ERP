import { RUTA_DE_LA_CUENTA_CORRIENTE } from "../plantillas/cuenta-corriente/rutas-de-cuenta-corriente";
import { RUTA_DE_LA_CAJA } from "../plantillas/caja/lista-de-caja";
import { RUTA_DE_CLIENTES } from "../plantillas/clientes/modelo-de-directorio";
import { RUTA_DEL_CIERRE } from "../plantillas/cierre/ruta-del-cierre";
import { RUTA_DE_IMPRESORAS } from "../plantillas/salon/modelo-de-impresoras";
import { RUTA_DE_LA_COCINA } from "../plantillas/salon/modelo-de-la-cocina";
import { RUTA_DE_MESAS } from "../plantillas/salon/modelo-de-mesas";
import { RUTA_DEL_SALON } from "../plantillas/salon/rutas-del-salon";
import { RUTA_DEL_LISTADO } from "../plantillas/facturacion/filtros-del-listado";
import { RUTA_DE_LA_VENTA, RUTA_DE_TICKETS_DEL_DIA } from "../plantillas/venta/rutas-de-venta";

/**
 * Las filas del área Ventas del menú (mostrador, comprobantes, caja, salón y clientes). Es SOLO una parte de la tabla del menú (`menu.ts`, que las compone en el orden de las áreas y es la única fuente que lee el resto): sumar una pantalla de este
 * área es sumar UNA fila acá. Los tipos y las reglas viven en `menu.ts`, que comprueba cada fila contra ellos al componerlas. Previene: que la tabla pase el tope de largo de archivo
 * (deuda `archivo-grande`).
 */
export const FILAS_DE_VENTAS = [
  {
    tipo: "pantalla",
    clave: "venta-rapida",
    area: "ventas",
    grupo: "mostrador",
    modulo: "ventas",
    accion: "ventas.ver",
    perilla: null,
    href: RUTA_DE_LA_VENTA,
    etiqueta: "ventas.venta.menu",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "tickets-del-dia",
    area: "ventas",
    grupo: "mostrador",
    modulo: "ventas",
    accion: "ventas.ver",
    perilla: null,
    href: RUTA_DE_TICKETS_DEL_DIA,
    etiqueta: "ventas.tickets.menu",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "comprobantes",
    area: "ventas",
    grupo: "comprobantes",
    modulo: "facturacion",
    accion: "comprobantes.ver",
    perilla: null,
    href: RUTA_DEL_LISTADO,
    etiqueta: "fiscal.pantalla.listado_titulo",
    departamento: null,
  },
  // «Caja» (maqueta `menu-por-areas.html`: grupo «Caja» con «Caja» y «Cierre del día»). El grupo se muestra sin encabezado (`etiqueta: null`). Nace cerrada: cada fila se ofrece solo a quien tiene la acción de su módulo.
  {
    tipo: "pantalla",
    clave: "caja",
    area: "ventas",
    grupo: "caja",
    modulo: "caja",
    accion: "cajas.ver",
    perilla: null,
    href: RUTA_DE_LA_CAJA,
    etiqueta: "caja.pantalla.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "cierre-del-dia",
    area: "ventas",
    grupo: "caja",
    modulo: "cierre",
    accion: "jornadas.ver",
    perilla: null,
    href: RUTA_DEL_CIERRE,
    etiqueta: "cierre.titulo",
    departamento: null,
  },
  // «Cuenta corriente» (CC-5, A1; maqueta `cuenta-corriente-ficha-listado-y-cobro.html`, «Caja → Cuenta corriente»): el listado de clientes con cuenta. Módulo `cuenta_corriente` y la acción de su lectura (`cuenta_corriente.ver`,
  // gerente y administrador); el módulo sigue «en desarrollo», así que nace cerrada: sin él o sin la acción no se ofrece.
  {
    tipo: "pantalla",
    clave: "cuenta-corriente",
    area: "ventas",
    grupo: "caja",
    modulo: "cuenta_corriente",
    accion: "cuenta_corriente.ver",
    perilla: null,
    href: RUTA_DE_LA_CUENTA_CORRIENTE,
    etiqueta: "cuenta_corriente.menu.entrada",
    departamento: null,
  },
  // «Salón» (SAL-A; `menu-por-areas.html`, grupo Salón del área Ventas): el mapa de mesas de la operación. Módulo `salon` (disponible), perilla `salon` (extra de pago) y acción `mesas.ver`: nace cerrada, sin matriz nueva.
  {
    tipo: "pantalla",
    clave: "salon",
    area: "ventas",
    grupo: "salon",
    modulo: "salon",
    accion: "mesas.ver",
    perilla: "salon",
    href: RUTA_DEL_SALON,
    etiqueta: "salon.texto.grupo_salon",
    departamento: null,
  },
  // «Mesas» (S-1; `menu-por-areas.html`: «Mesas», pantalla dentro del grupo Salón del área Ventas): módulo `salon` (hoy en desarrollo: la entrada no se muestra) y acción `mesas.ver`.
  {
    tipo: "pantalla",
    clave: "mesas",
    area: "ventas",
    grupo: "salon",
    modulo: "salon",
    accion: "mesas.ver",
    perilla: "salon",
    href: RUTA_DE_MESAS,
    etiqueta: "salon.texto.admin_mesas",
    departamento: null,
  },
  // «Impresoras» (S-2; `menu-por-areas.html`, grupo Salón del área Ventas): módulo `comandas` (disponible desde S-0r) y acción `impresoras.ver`.
  {
    tipo: "pantalla",
    clave: "impresoras",
    area: "ventas",
    grupo: "salon",
    modulo: "comandas",
    accion: "impresoras.ver",
    perilla: null,
    href: RUTA_DE_IMPRESORAS,
    etiqueta: "comandas.texto.imprimir_impresoras",
    departamento: null,
  },
  // «Comandas» (SAL-H; maqueta aprobada por el dueño el 25/11/2026): la pantalla de la cocina, grupo Salón del área Ventas; módulo `comandas` y acción `comandas.ver`.
  {
    tipo: "pantalla",
    clave: "comandas",
    area: "ventas",
    grupo: "salon",
    modulo: "comandas",
    accion: "comandas.ver",
    perilla: null,
    href: RUTA_DE_LA_COCINA,
    etiqueta: "comandas.texto.cocina_comandas",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "clientes",
    area: "ventas",
    grupo: "clientes",
    modulo: "clientes",
    accion: "partes.ver",
    perilla: null,
    href: `${RUTA_DE_CLIENTES}?rol=cliente`,
    etiqueta: "clientes.lista.clientes",
    departamento: null,
  },
] as const;
