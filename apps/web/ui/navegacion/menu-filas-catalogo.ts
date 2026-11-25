import { RUTA_DE_PRODUCTOS } from "../plantillas/catalogo/filtros-de-productos";
import { RUTA_DE_CLASIFICACION } from "../plantillas/catalogo/modelo-de-clasificacion";
import { RUTA_DE_SECCIONES } from "../plantillas/catalogo/modelo-de-secciones";
import { RUTA_DE_PRODUCCION } from "../plantillas/produccion/filtros-de-ordenes";
import { RUTAS_DE_STOCK } from "../plantillas/stock/rutas-de-stock";

/**
 * Las filas del área Catálogo del menú (productos, carta, stock y producción). Es SOLO una parte de la tabla del menú (`menu.ts`, que las compone en el orden de las áreas y es la única fuente que lee el resto): sumar una pantalla de este
 * área es sumar UNA fila acá. Los tipos y las reglas viven en `menu.ts`, que comprueba cada fila contra ellos al componerlas. Previene: que la tabla pase el tope de largo de archivo
 * (deuda `archivo-grande`).
 */
export const FILAS_DE_CATALOGO = [
  {
    tipo: "pantalla",
    clave: "productos",
    area: "catalogo",
    grupo: "productos",
    modulo: "catalogo",
    accion: "productos.ver",
    perilla: null,
    href: RUTA_DE_PRODUCTOS,
    etiqueta: "catalogo.lista.titulo",
    departamento: null,
  }, // Clasificación comercial (A14): solo gerente y administrador (`productos.editar`; maqueta `clasificacion.html`: el operador no ve la entrada). Su rótulo es el título aprobado «Clasificación comercial».
  {
    tipo: "pantalla",
    clave: "clasificacion",
    area: "catalogo",
    grupo: "productos",
    modulo: "catalogo",
    accion: "productos.editar",
    perilla: null,
    href: RUTA_DE_CLASIFICACION,
    etiqueta: "catalogo.clasificacion.titulo",
    departamento: null,
  },

  // «Secciones» (A8; dueño, 13/11/2026, `decisiones-del-dueno-2026-11.md` línea 110): en Catálogo, grupo «Carta». Módulo `catalogo` y acción `productos.ver`, las de su consulta (S7 de la ficha: la celda de la maqueta del menú dice `vidriera` y `vidrieras.ver`, pero el servidor resuelve estas).
  {
    tipo: "pantalla",
    clave: "secciones",
    area: "catalogo",
    grupo: "carta",
    modulo: "catalogo",
    accion: "productos.ver",
    perilla: null,
    href: RUTA_DE_SECCIONES,
    etiqueta: "catalogo.seccion.titulo",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "stock",
    area: "catalogo",
    grupo: "stock",
    modulo: "stock",
    accion: "stock.ver",
    perilla: null,
    href: RUTAS_DE_STOCK.entrada,
    etiqueta: "stock.pantalla.stock",
    departamento: null,
  },
  {
    tipo: "pantalla",
    clave: "produccion",
    area: "catalogo",
    grupo: "produccion",
    modulo: "produccion",
    accion: "transformaciones.ver",
    perilla: null,
    href: RUTA_DE_PRODUCCION,
    etiqueta: "produccion.pantalla.produccion",
    departamento: null,
  },
] as const;
