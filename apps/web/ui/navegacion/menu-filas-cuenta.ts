import { RUTAS_DE_CAJA } from "../plantillas/caja/lista-de-caja";
import { RUTAS_DE_CONFIGURACION } from "../plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { RUTAS_DE_CUENTA } from "../plantillas/sesion/rutas-de-cuenta";

/**
 * Las filas del área Cuenta del menú (empresa, sucursal y salir). Es SOLO una parte de la tabla del menú (`menu.ts`, que las compone en el orden de las áreas y es la única fuente que lee el resto): sumar una pantalla de este
 * área es sumar UNA fila acá. Los tipos y las reglas viven en `menu.ts`, que comprueba cada fila contra ellos al componerlas. Previene: que la tabla pase el tope de largo de archivo
 * (deuda `archivo-grande`).
 */
export const FILAS_DE_CUENTA = [
  {
    tipo: "pantalla",
    clave: "configuracion-fiscal",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "datos_fiscales.editar",
    perilla: null,
    href: RUTAS_DE_CONFIGURACION.lista,
    etiqueta: "fiscal.pantalla.config_titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "medios-de-pago",
    area: "cuenta",
    grupo: "empresa",
    modulo: "caja",
    accion: "medios_de_pago.editar",
    perilla: null,
    href: RUTAS_DE_CAJA.medios,
    etiqueta: "caja.medios.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "usuarios",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "usuarios.ver",
    perilla: null,
    href: RUTAS_DE_CUENTA.usuarios,
    etiqueta: "usuarios.lista.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "roles",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "roles.ver",
    perilla: null,
    href: RUTAS_DE_CUENTA.roles,
    etiqueta: "roles.lista.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "sucursales",
    area: "cuenta",
    grupo: "empresa",
    modulo: "administracion",
    accion: "sucursales.ver",
    perilla: null,
    href: RUTAS_DE_CUENTA.sucursales,
    etiqueta: "usuarios.campo.sucursales",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "contacto",
    area: "cuenta",
    grupo: "sucursal",
    modulo: "administracion",
    accion: "sucursales.editar",
    perilla: null,
    href: RUTAS_DE_CUENTA.contactoDeLaSucursal,
    etiqueta: "sucursal.contacto_titulo",
    departamento: null,
  },
  {
    tipo: "accion",
    clave: "cerrar-sesion",
    area: "cuenta",
    grupo: "salir",
    etiqueta: "cuenta.cerrar_sesion",
    departamento: null,
  },
] as const;
