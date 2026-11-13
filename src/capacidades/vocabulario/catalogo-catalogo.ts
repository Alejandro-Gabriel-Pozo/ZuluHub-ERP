/**
 * Los textos del módulo `catalogo` (prefijo `catalogo.`). Nace vacío (E0-T4): cada etapa que construye el módulo suma acá los suyos, cada uno con su fuente verificable, sin tocar
 * `catalogo.ts` (que ya lo incluye). Existe aparte para que E2, E3 y E4 no editen el mismo archivo.
 *
 * A1 (Productos y precios), primera carga: lista (T1), ficha de datos (T2a), alta (T6) y precio (T3). Fuente de TODO lo que sigue: la maqueta APROBADA
 * `Pedernal-docs/10-ux-ui/prototipos-gastronomia/productos.html` (aprobada por el dueño el 12/11/2026: «Productos también. Solo 2, 4 y 8»; su tabla «Textos nuevos» está aprobada
 * desde el 09/11/2026) y `11-especificaciones/decisiones-del-dueno-2026-11.md` (12/11/2026). Cada grupo cita su fila de «Textos nuevos». En lo que se ve, «medida» y nunca «tamaño»
 * (dueño, 12/11/2026). Lo que NO se carga y por qué: «Categoría» (la maqueta la nombra junto a «Sección de la carta» y el servidor solo tiene la sección: pregunta pendiente al dueño),
 * lo de «Cómo se compra», la alta rápida, las variantes, los grupos de opciones y el consumo (son de T4, de compra y de receta), y los textos «por aprobar» de la maqueta
 * («Precios de», «La empresa», «Ejemplo», «Cómo se vende», «Ocultar»…).
 */
export const TEXTOS_DE_CATALOGO = {
  // productos.html, «Textos nuevos», fila «Lista y ficha».
  "catalogo.lista.titulo": { porDefecto: "Productos" },
  "catalogo.lista.nuevo": { porDefecto: "Nuevo producto" },
  "catalogo.lista.buscar": { porDefecto: "Buscar" },
  "catalogo.ficha.datos": { porDefecto: "Datos" },
  "catalogo.ficha.precios": { porDefecto: "Precios" },
  "catalogo.ficha.opciones": { porDefecto: "Opciones" },
  "catalogo.accion.guardar": { porDefecto: "Guardar" },
  "catalogo.accion.desactivar": { porDefecto: "Desactivar" },
  "catalogo.accion.reactivar": { porDefecto: "Reactivar" },
  "catalogo.estado.desactivado": { porDefecto: "Desactivado" },
  "catalogo.estado.falta_completar": { porDefecto: "Falta completar" },

  // productos.html, «Textos nuevos»: fila «Clase, compra y alta rápida» («¿Qué es?», «Todos») y la fila «Materia prima · Insumo · Reventa · Elaborado · Producto vendible», cuyas descripciones
  // «son las de la decisión 69, ya aprobadas».
  "catalogo.lista.que_es": { porDefecto: "¿Qué es?" },
  "catalogo.lista.todos": { porDefecto: "Todos" },
  "catalogo.clase.materia_prima": { porDefecto: "Materia prima" },
  "catalogo.clase.insumo": { porDefecto: "Insumo" },
  "catalogo.clase.reventa": { porDefecto: "Reventa" },
  "catalogo.clase.elaborado": { porDefecto: "Elaborado" },
  "catalogo.clase.vendible": { porDefecto: "Producto vendible" },

  // productos.html, «Textos nuevos», fila «Datos» (sin «Categoría»: ver arriba).
  "catalogo.dato.nombre": { porDefecto: "Nombre" },
  "catalogo.dato.nombre_de_cocina": { porDefecto: "Nombre de cocina" },
  "catalogo.dato.codigo_interno": { porDefecto: "Código interno" },
  "catalogo.dato.codigo_de_barras": { porDefecto: "Código de barras" },
  "catalogo.dato.unidad": { porDefecto: "Unidad" },
  "catalogo.dato.alicuota_de_iva": { porDefecto: "Alícuota de IVA" },
  "catalogo.dato.seccion_de_la_carta": { porDefecto: "Sección de la carta" },
  // Opción vacía de los desplegables de la ficha; el desplegable de la alícuota arranca ahí (dueño, 12/11/2026, pregunta 4). Distinto de «Elegí una opción» (`selector.elegir_una_opcion`).
  "catalogo.dato.sin_elegir": { porDefecto: "Sin elegir" },

  // productos.html, sección «Textos aprobados: Alícuota de IVA»: las seis alícuotas de ARCA, en este orden y sin «IVA» (dueño, 12/11/2026, «Recomendadas en todas, aprobado»,
  // decisiones-del-dueno-2026-11.md; valores de la grabación 014-FEParamGetTiposIva, ids 3, 4, 5, 6, 8 y 9). «Exento» y «No gravado» NO se ofrecen en el producto. El orden es el de la
  // maqueta (supuesto del ingeniero, no citado por el dueño).
  "catalogo.alicuota.21": { porDefecto: "21 %" },
  "catalogo.alicuota.10_5": { porDefecto: "10,5 %" },
  "catalogo.alicuota.27": { porDefecto: "27 %" },
  "catalogo.alicuota.5": { porDefecto: "5 %" },
  "catalogo.alicuota.2_5": { porDefecto: "2,5 %" },
  "catalogo.alicuota.0": { porDefecto: "0 %" },

  // productos.html, «Textos nuevos», fila «Precios».
  "catalogo.precio.importe": { porDefecto: "Precio (IVA incluido)" },
  "catalogo.precio.cambiar": { porDefecto: "Cambiar precio" },
  "catalogo.precio.abierto": { porDefecto: "Precio abierto" },
  "catalogo.precio.historial": { porDefecto: "Historial" },
  "catalogo.precio.vigente_desde": { porDefecto: "Vigente desde" },
  "catalogo.precio.segun_medida": { porDefecto: "Según medida" },
  "catalogo.precio.sin_precio": { porDefecto: "Sin precio" },
  // productos.html, fila propia «Aviso de “Otra persona cambió el precio”»: aprobado por el dueño el 12/11/2026 (respuesta a las preguntas chicas). El importe va como marcador.
  "catalogo.precio.vigente_ahora": {
    porDefecto: "El precio vigente ahora es $ {importe}. Revisalo y volvé a intentar.",
    marcadores: ["importe"],
  },

  // productos.html, «Textos nuevos», fila «Errores» (solo los de lista, ficha, alta y precio; los de variantes y opciones son de T4).
  "catalogo.error.nombre_repetido": { porDefecto: "Ya existe un producto con ese nombre" },
  "catalogo.error.codigo_repetido": { porDefecto: "Ya existe un producto con ese código" },
  "catalogo.error.codigo_de_barras_invalido": {
    porDefecto: "El código de barras debe tener de 8 a 14 dígitos",
  },
  "catalogo.error.elegi_la_alicuota": { porDefecto: "Elegí la alícuota" },
  "catalogo.error.precio_invalido": { porDefecto: "Escribí un precio válido" },
  "catalogo.error.falta_el_nombre": { porDefecto: "Falta el nombre" },

  // productos.html: la nota «(obligatorio), (opcional), Incluido, · no figura en la carta y Esta acción no está permitida ya están aprobados» (stock.html y esta misma pantalla). Solo
  // los que usan lista, ficha, alta y precio; «Incluido» es de las opciones (T4) y «Entendido» de los cuadros de aviso. «Cancelar» está en la misma maqueta («Reutilizados sin cambio»).
  "catalogo.campo.obligatorio": { porDefecto: "(obligatorio)" },
  "catalogo.campo.opcional": { porDefecto: "(opcional)" },
  "catalogo.lista.no_figura_en_la_carta": { porDefecto: "· no figura en la carta" },
  "catalogo.error.accion_no_permitida": { porDefecto: "Esta acción no está permitida" },
  "catalogo.accion.cancelar": { porDefecto: "Cancelar" },
} as const;
