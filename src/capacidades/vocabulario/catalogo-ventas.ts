/**
 * Los textos del módulo `ventas` (prefijo `ventas.`). Nació vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su
 * fuente verificable, sin tocar `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 */
export const TEXTOS_DE_VENTAS = {
  // El genérico aprobado por el dueño el 30/10/2026 («Interfaz sobria»: mensaje genérico antes que uno por acción; `CLAUDE.md`); el mismo texto ya aprobado de `caja.error.accion_no_permitida`
  // (maqueta `medios.html`, 09/11/2026). Fuente de que ventas lo use: `servidor-del-mostrador-minimo.md` §8, «Los seis avisos sin texto usan el genérico».
  "ventas.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },

  // PANTALLA «VENTA RÁPIDA» (maqueta `venta-rapida-v4.html`). Fuente de cada texto, salvo donde se dice otra cosa: `textos-mostrador-pendientes.md` (Pedernal-docs, 11-especificaciones) y la
  // fila 171 de `decisiones-del-dueno-2026-11.md` («Acepto todos los textos», 15/11/2026); «aprobado 09/11» = la versión aprobada de la venta rápida (`venta-rapida.html`, §4 de ese documento).
  // «Venta»: título de la pantalla y de su entrada del menú. Figura en la maqueta aprobada de la venta rápida (`venta-rapida.html:551`, carpeta de prototipos de Pedernal-docs 10-ux-ui) y se mantiene en `venta-rapida-v4.html`;
  // no está en la lista de 302 textos (`textos-por-aprobar.html`): queda como pregunta de confirmación (DEC-0479).
  "ventas.venta.titulo": { porDefecto: "Venta" },
  // «Buscar por nombre o código»: rótulo del buscador. Aprobado 09/11 (`textos-mostrador-pendientes.md` §4, línea 69); busca por nombre, código y código de barras (respuesta del orquestador, 15/11/2026).
  "ventas.venta.buscar": { porDefecto: "Buscar por nombre o código" },
  // Búsqueda sin coincidencias: los tres textos figuran en la maqueta aprobada de la venta rápida (`venta-rapida.html:548`); aceptados por el orquestador el 15/11/2026 (delegación del dueño, DDD filas 173 y 174).
  // El texto buscado se inserta como texto, nunca como código (R6 de e4 §3.9).
  "ventas.venta.sin_resultados": {
    porDefecto: "No encontré productos con «{busqueda}»",
    marcadores: ["busqueda"],
    largoMaximo: 120,
  },
  "ventas.venta.sin_resultados_ayuda": { porDefecto: "Revisá el nombre o probá con el código." },
  "ventas.venta.borrar_busqueda": { porDefecto: "Borrar la búsqueda" },
  // «Ver cuenta»: aprobado 09/11 (`textos-mostrador-pendientes.md` §4, línea 69).
  "ventas.venta.ver_cuenta": { porDefecto: "Ver cuenta" },
  // «Total»: aprobado 09/11 (ídem; `e4-venta-rapida-especificacion.md` §3.16, `ventas.confirmar_cero`).
  "ventas.venta.total": { porDefecto: "Total" },
  // M7 «Con opciones»: subtítulo del producto con medidas u opciones (fila 171, alcance e).
  "ventas.venta.con_opciones": { porDefecto: "Con opciones" },
  // «Agregar»: botón de la hoja del producto. Aprobado 09/11: `textos-por-aprobar.html` n.º 109 y `venta-rapida.html:595` (Pedernal-docs, 10-ux-ui/prototipos-gastronomia).
  "ventas.venta.agregar": { porDefecto: "Agregar" },
  // «Agregado»: aviso tras agregar. Ya aprobado en `productos.html` (alta rápida) y usado acá en un lugar nuevo (`venta-rapida-v4.html`, `PA_REG` clave `agregado`).
  "ventas.venta.agregado": { porDefecto: "Agregado" },
  // «Cantidad», «Quitar» y «Cancelar»: aprobados 09/11 (`textos-mostrador-pendientes.md` §4, línea 69: «Cantidad», «Quitar», «Cancelar»).
  "ventas.venta.cantidad": { porDefecto: "Cantidad" },
  "ventas.venta.quitar": { porDefecto: "Quitar" },
  "ventas.venta.cancelar": { porDefecto: "Cancelar" },
  // «Cantidad no válida»: `prototipo-caja.html`, aprobado 09/11 (`venta-rapida-v4.html`, tabla «Textos ya aprobados que se reutilizan»; `e4-venta-rapida-especificacion.md` §3.16).
  "ventas.venta.cantidad_no_valida": { porDefecto: "Cantidad no válida" },
  // «La cuenta está vacía» y «Agregá productos desde la venta.»: aprobados 09/11 (`e4-venta-rapida-especificacion.md` §3.16, `ventas.cuenta.vacia`; `textos-mostrador-pendientes.md` §3).
  "ventas.venta.cuenta_vacia": { porDefecto: "La cuenta está vacía" },
  "ventas.venta.cuenta_vacia_ayuda": { porDefecto: "Agregá productos desde la venta." },
  // P12 «Los precios incluyen IVA.»: aprobado (fila 171, alcance g); el mismo texto que `vidriera.pie.iva`.
  "ventas.venta.pie_iva": { porDefecto: "Los precios incluyen IVA." },
  // M3 «Medida»: nombre del grupo de medidas, solo para quien usa lector de pantalla (fila 171, alcance e).
  "ventas.venta.medida": { porDefecto: "Medida" },
  // M4 «Borrar»: deja la cantidad de un producto por fracciones en vacío (fila 171, alcance e).
  "ventas.cantidad.borrar": { porDefecto: "Borrar" },
  // M1 los rótulos de fracciones (fila 171, alcance e; fila 117 del 14/11/2026, punto 2): ½ ¼ ¾ y ⅛ ⅜ ⅝ ⅞. Decisión 181: en pantalla los signos; en el papel, con barra.
  "ventas.cantidad.fraccion_1_2": { porDefecto: "½" },
  "ventas.cantidad.fraccion_1_4": { porDefecto: "¼" },
  "ventas.cantidad.fraccion_3_4": { porDefecto: "¾" },
  "ventas.cantidad.fraccion_1_8": { porDefecto: "⅛" },
  "ventas.cantidad.fraccion_3_8": { porDefecto: "⅜" },
  "ventas.cantidad.fraccion_5_8": { porDefecto: "⅝" },
  "ventas.cantidad.fraccion_7_8": { porDefecto: "⅞" },
} as const;
