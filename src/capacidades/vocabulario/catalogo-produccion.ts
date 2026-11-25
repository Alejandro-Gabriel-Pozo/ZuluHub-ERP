/**
 * Los textos de la producción y de la receta (prefijos `produccion.` y `receta.`, E6 §10). Ninguno es nuevo: todos salen de los prototipos que el
 * dueño aprobó el 09/11/2026 (repositorio de documentos, `10-ux-ui/prototipos-gastronomia/`): `produccion.html`, sección «Textos aprobados»
 * (línea 245, una fila por grupo: decisiones D85, D94 y D95), y `receta.html`, sección «Textos aprobados» (línea 240: decisiones D74, D77, D82 y
 * D99). Lo que esas listas no traen no se agrega acá: los errores sin texto aprobado (`CICLO_EN_LA_RECETA`, `RECETA_DEMASIADO_ANIDADA`,
 * `PRODUCTO_SIN_RECETA`, `ORDEN_CANCELADA`, `PRODUCTO_YA_USADO`, `CLAVE_REUTILIZADA`, `FUNCION_NO_INCLUIDA`…) se muestran con el mensaje genérico
 * que ya existe (D175), y «La central cambió» / «Receta propia» quedan fuera hasta que se haga la receta por sucursal (P-3, decidida «después»).
 */
export const TEXTOS_DE_PRODUCCION = {
  // produccion.html «Textos aprobados», fila «Lista y orden».
  "produccion.pantalla.produccion": { porDefecto: "Producción" },
  "produccion.pantalla.nueva_orden": { porDefecto: "Nueva orden" },
  "produccion.pantalla.orden": { porDefecto: "Orden" },
  "produccion.pantalla.tanda": { porDefecto: "Tanda" },
  // produccion.html, fila «Estado de la orden».
  "produccion.estado.abierta": { porDefecto: "Abierta" },
  "produccion.estado.cerrada": { porDefecto: "Cerrada" },
  "produccion.estado.cancelada": { porDefecto: "Cancelada" },
  "produccion.estado.anulada": { porDefecto: "Anulada" },
  // produccion.html, fila «Orden».
  "produccion.orden.cantidad_a_producir": { porDefecto: "Cantidad a producir" },
  "produccion.orden.consume": { porDefecto: "Consume" },
  "produccion.orden.obtiene": { porDefecto: "Obtiene" },
  "produccion.orden.en_stock": { porDefecto: "En stock" },
  // Aprobados por el dueño el 14/11/2026 (decisiones-del-dueno-2026-11.md, filas «Recetas, costos y producción» y «Textos y plan», punto 2; `rendimiento.md` y `orden-de-produccion.md` #4).
  "produccion.orden.rinde": { porDefecto: "Rinde" },
  "produccion.orden.receta_cambio": { porDefecto: "La receta cambió desde que abriste la orden" },
  "produccion.orden.costo_estimado": { porDefecto: "Costo estimado" },
  // produccion.html, fila «Orden» (acciones).
  "produccion.accion.abrir_orden": { porDefecto: "Abrir orden" },
  "produccion.accion.cerrar_con_lo_real": { porDefecto: "Cerrar con lo real" },
  "produccion.accion.cerrar_la_orden": { porDefecto: "Cerrar la orden" },
  "produccion.accion.cancelar_la_orden": { porDefecto: "Cancelar la orden" },
  "produccion.accion.anular_la_orden": { porDefecto: "Anular la orden" },
  // produccion.html, fila «Cierre».
  "produccion.cierre.cantidad_obtenida": { porDefecto: "Cantidad obtenida" },
  "produccion.cierre.vence": { porDefecto: "Vence" },
  "produccion.cierre.lote": { porDefecto: "Lote" },
  "produccion.cierre.costo_por_unidad": { porDefecto: "Costo por unidad" },
  // produccion.html, fila «Faltante» (decisión 85).
  "produccion.faltante.stock_insuficiente": { porDefecto: "Stock insuficiente" },
  "produccion.faltante.producir_igual": { porDefecto: "Producir igual" },
  // produccion.html, fila «Elaborado» (decisión 94).
  "produccion.elaborado.se_produce_en_tanda": { porDefecto: "Se produce en tanda" },
  "produccion.elaborado.se_arma_al_usarlo": { porDefecto: "Se arma al usarlo" },

  // Textos de la maqueta aprobada `produccion.html` (09/11/2026) que no tenían fila propia en «Textos aprobados»; aceptados por el orquestador por delegación del dueño (DDD filas 173 y 174, DEC-0555).
  // Fuente de cada uno: la línea de `10-ux-ui/prototipos-gastronomia/produccion.html` de Pedernal-docs.
  "produccion.lista.todas": { porDefecto: "Todas" }, // línea 341
  "produccion.lista.abiertas": { porDefecto: "Abiertas" }, // línea 341
  "produccion.orden.consumio": { porDefecto: "Consumió" }, // línea 373
  "produccion.orden.anulada": { porDefecto: "Orden anulada" }, // línea 370
  "produccion.accion.anular_explicacion": {
    porDefecto: "Se devuelve lo consumido y se saca lo producido. Queda el registro de la orden.",
  }, // línea 402
  "produccion.cierre.esperado_obtenido": {
    porDefecto: "Esperado {esperado} · obtenido {obtenido}",
    marcadores: ["esperado", "obtenido"],
  }, // línea 372
  "produccion.accion.sin_conexion": { porDefecto: "No se puede enviar sin conexión." }, // líneas 361 y 389

  // receta.html «Textos aprobados», fila «Lista» y fila «Sin receta».
  "receta.pantalla.recetas": { porDefecto: "Recetas" },
  "receta.lista.sin_receta": { porDefecto: "Sin receta" },
  "receta.lista.con_receta": { porDefecto: "Con receta" },
  "receta.lista.producto_sin_receta": { porDefecto: "Este producto no tiene receta" },
  // receta.html, fila «Ficha» (decisión 74; «Receta de la central» y «Receta propia» quedan fuera: P-3).
  "receta.ficha.version": { porDefecto: "Versión" },
  "receta.ficha.vigente": { porDefecto: "vigente" },
  // receta.html, fila «Ficha»: ingredientes, merma, bruto, costo, food cost y margen (decisión 74).
  "receta.ficha.ingredientes": { porDefecto: "Ingredientes" },
  "receta.ficha.merma": { porDefecto: "Merma" },
  "receta.ficha.bruto": { porDefecto: "Bruto" },
  "receta.ficha.costo": { porDefecto: "Costo" },
  "receta.ficha.food_cost": { porDefecto: "Food cost" },
  "receta.ficha.margen": { porDefecto: "Margen" },
  // receta.html, fila «Ficha» (decisiones 77 y 82).
  "receta.ficha.segun_lo_que_elija_el_cliente": { porDefecto: "Según lo que elija el cliente" },
  "receta.ficha.no_entran_en_el_costo": { porDefecto: "No entran en el costo" },
  // receta.html, fila «Edición y versiones».
  "receta.edicion.editar": { porDefecto: "Editar" },
  "receta.edicion.guardar_como_version": {
    porDefecto: "Guardar como versión {numero}",
    marcadores: ["numero"],
  },
  "receta.edicion.versiones": { porDefecto: "Versiones" },
  "receta.edicion.comparar": { porDefecto: "Comparar" },
  // Pantalla de Recetas, «ver» (REC-A): textos aprobados por el dueño y listados en `recetas-pantalla.md` §5 (repositorio de documentos): «Neto» el 13/11/2026 (DDD:102), «Rinde», «Pasos» y «Costo de la comida»
  // el 14/11/2026 (DDD:119 y 123) y «Todas» el 15/11/2026 (T24 a T27, DDD:165). «Sin costo» reusa `stock.accion.sin_costo`; «Sin resultados», `catalogo.lista.sin_resultados`.
  "receta.ficha.neto": { porDefecto: "Neto" },
  "receta.ficha.rinde": { porDefecto: "Rinde" },
  "receta.ficha.pasos": { porDefecto: "Pasos" },
  "receta.ficha.costo_de_la_comida": { porDefecto: "Costo de la comida" },
  "receta.lista.todas": { porDefecto: "Todas" },
  // Pantalla de Recetas, guardar (REC-B): «Costo antes», «Costo ahora» y «Diferencia» (aprobados el 14/11/2026, DDD:119 y 123) y «Volver a editar» (15/11/2026, T24 a T27, DDD:165), de `recetas-pantalla.md` §5.
  // «Guardar», «Quitar», «Producto», «Sin elegir», «Agregar» y «Cancelar» reusan los textos ya aprobados de catálogo y de compras (una regla, un lugar).
  "receta.edicion.costo_antes": { porDefecto: "Costo antes" },
  "receta.edicion.costo_ahora": { porDefecto: "Costo ahora" },
  "receta.edicion.diferencia": { porDefecto: "Diferencia" },
  "receta.edicion.volver_a_editar": { porDefecto: "Volver a editar" },
  // «Nueva receta» (TP-16): el patrón aprobado «Nuevo producto», «Nueva compra», «Nueva orden» (`textos-por-aprobar.html:39`, N.° 68 y 278) y la decisión del dueño del 15/11/2026 (DDD:165). Aceptado por
  // delegación del orquestador (fila 173, DEC-1068); se cambia su porDefecto acá.
  "receta.lista.nueva_receta": { porDefecto: "Nueva receta" },
  // receta.html, fila «Ficha de cocina» (idea 6, decisión 99).
  "receta.ficha_de_cocina.titulo": { porDefecto: "Ficha de cocina" },
  // El genérico de la pantalla de Recetas (rechazo de guardar). Texto ya aprobado y repetido por módulo (`caja.error.accion_no_permitida`, `catalogo.error.accion_no_permitida`):
  // interfaz sobria, dueño 30/10/2026 («Mensaje genérico … antes que uno por acción», CLAUDE.md); fila «Rechazo del servidor» de `recetas-pantalla.md` §5 y §6 (15/11/2026). DEC-0575.
  "receta.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
} as const;
