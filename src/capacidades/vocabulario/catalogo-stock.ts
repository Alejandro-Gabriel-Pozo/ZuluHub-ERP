/**
 * Los textos del módulo `stock` (prefijo `stock.`, E5 §10). Ninguno es nuevo: todos salen de la lista que el dueño aprobó el 09/11/2026 en el
 * prototipo `stock.html`, sección «Textos nuevos» (decisión D125), que es la fuente de cada grupo de abajo (`10-ux-ui/prototipos-gastronomia/
 * stock.html:266`, repositorio de documentos, una fila por grupo). Lo que esa lista no trae no se agrega acá: los errores sin texto aprobado
 * (`STOCK_SIN_DEPOSITO_DE_VENTA`, `CONTEO_SIN_REGISTROS`, `CLAVE_REUTILIZADA`, `*_DESACTUALIZADA` salvo el del depósito, `ARTICULO_NO_CONTROLADO`, `CLASE_NO_CONTROLABLE`,
 * `MOVIMIENTO_NO_ANULABLE`, `MOVIMIENTO_YA_ANULADO`, `FUNCION_NO_INCLUIDA`…) se muestran con el mensaje genérico que ya
 * existe, y el aviso «falta receta» no tiene pantalla (contrato `excepciones`; D175). Cada clave de motivo es el código del motivo sembrado en
 * minúsculas (`COMPRA` → `stock.motivo.compra`) y cada clave de uso de depósito, el código del uso (`CUARENTENA` → `stock.deposito.cuarentena`).
 */
export const TEXTOS_DE_STOCK = {
  // stock.html «Textos nuevos» (D125), fila «Pantallas».
  "stock.pantalla.stock": { porDefecto: "Stock" },
  "stock.pantalla.existencias": { porDefecto: "Existencias" },
  "stock.pantalla.movimientos": { porDefecto: "Movimientos" },
  "stock.pantalla.conteo": { porDefecto: "Conteo" },
  "stock.pantalla.depositos": { porDefecto: "Depósitos" },
  "stock.pantalla.existencia": { porDefecto: "Existencia" },
  "stock.pantalla.disponible": { porDefecto: "Disponible" },
  "stock.pantalla.negativa": { porDefecto: "Negativa" },

  // stock.html «Textos nuevos» (D125), fila «Movimientos».
  "stock.accion.entrada": { porDefecto: "Entrada" },
  "stock.accion.salida": { porDefecto: "Salida" },
  "stock.accion.transferir": { porDefecto: "Transferir" },
  "stock.accion.ajustar": { porDefecto: "Ajustar" },
  "stock.accion.anular": { porDefecto: "Anular" },
  "stock.accion.motivo": { porDefecto: "Motivo" },
  "stock.accion.detalle": { porDefecto: "Detalle" },
  "stock.accion.cantidad": { porDefecto: "Cantidad" },
  "stock.accion.costo_por_unidad": { porDefecto: "Costo por unidad" },
  "stock.accion.sin_costo": { porDefecto: "Sin costo" },
  "stock.accion.origen": { porDefecto: "Origen" },
  "stock.accion.destino": { porDefecto: "Destino" },
  "stock.accion.registrar": { porDefecto: "Registrar" },

  // stock.html «Textos nuevos» (D125), fila «Motivos».
  "stock.motivo.compra": { porDefecto: "Compra" },
  "stock.motivo.carga_inicial": { porDefecto: "Carga inicial" },
  "stock.motivo.devolucion_de_cliente": { porDefecto: "Devolución de cliente" },
  "stock.motivo.otra_entrada": { porDefecto: "Otra entrada" },
  "stock.motivo.consumo_interno": { porDefecto: "Consumo interno" },
  "stock.motivo.merma": { porDefecto: "Merma" },
  "stock.motivo.rotura": { porDefecto: "Rotura" },
  "stock.motivo.vencimiento": { porDefecto: "Vencimiento" },
  "stock.motivo.otra_salida": { porDefecto: "Otra salida" },
  "stock.motivo.correccion": { porDefecto: "Corrección" },

  // stock.html «Textos nuevos» (D125), fila «Conteo».
  "stock.conteo.abrir": { porDefecto: "Abrir conteo" },
  "stock.conteo.contado": { porDefecto: "Contado" },
  "stock.conteo.aplicar": { porDefecto: "Aplicar" },
  "stock.conteo.cancelar": { porDefecto: "Cancelar conteo" },
  "stock.conteo.diferencia": { porDefecto: "Diferencia" },
  "stock.conteo.aplicado": { porDefecto: "Aplicado" },

  // stock.html «Textos nuevos» (D125), fila «Depósitos»; «Cuarentena» y «Rechazo» ya estaban aprobados en el control de la mercadería (D118).
  "stock.deposito.agregar": { porDefecto: "Agregar depósito" },
  "stock.deposito.normal": { porDefecto: "Normal" },
  "stock.deposito.cuarentena": { porDefecto: "Cuarentena" },
  "stock.deposito.rechazo": { porDefecto: "Rechazo" },
  "stock.deposito.de_venta": { porDefecto: "De venta" },
  "stock.deposito.uso": { porDefecto: "Uso" },

  // stock.html «Textos nuevos» (D125), fila «Errores y avisos»: uno por código de error de E5 (el código, en minúsculas, es el final de la clave). Excepción: `CONTROL_REQUIERE_CONFIRMACION` es `control_avisa` (el nivel `AVISAR`), porque «confirmación» contiene «firma» y la prueba del catálogo rechaza un nombre de clave que parezca de un secreto.
  "stock.error.control_avisa": {
    porDefecto: "Va a quedar en negativo. ¿Confirmás?",
  },
  "stock.error.transferencia_al_mismo_deposito": {
    porDefecto: "El origen y el destino no pueden ser el mismo",
  },
  "stock.error.detalle_requerido": { porDefecto: "Escribí el detalle" },
  "stock.error.cantidad_invalida": { porDefecto: "La cantidad tiene que ser mayor que cero" },
  "stock.error.conteo_en_curso": { porDefecto: "Ya hay un conteo abierto en este depósito" },
  "stock.error.nombre_duplicado": { porDefecto: "Ya existe un depósito con ese nombre" },
  // Gestión de depósitos (STK-A): los tres errores que el dueño aprobó el 25/11/2026 (N-20 y N-21, fila 449 de `decisiones-del-dueno-2026-11.md`) y el que aceptó el orquestador por delegación (N-23, fila
  // 173); el cuarto error de esa pantalla («tiene un conteo abierto») reutiliza `stock.error.conteo_en_curso`. Cada uno lo consume su código público (`respuesta-de-stock.ts`).
  "stock.error.deposito_con_existencia": {
    porDefecto: "El depósito tiene existencia",
    usos: ["DE_FICHA"],
    fuente: { decision: "DEC-1018" },
  },
  "stock.error.es_el_de_venta": {
    porDefecto: "No se puede desactivar el depósito de venta",
    usos: ["DE_FICHA"],
    fuente: { decision: "DEC-1018" },
  },
  "stock.error.deposito_desactualizado": {
    porDefecto: "Otra persona modificó este depósito. Actualizá la pantalla",
    usos: ["DE_FICHA"],
    fuente: { decision: "DEC-1018" },
  },
  // stock.html, nota final de «Textos nuevos» («Esta acción no está permitida» ya estaba aprobado), sin el punto final de esa nota.
  "stock.error.sin_permiso": { porDefecto: "Esta acción no está permitida" },

  // Conteo con hora: los seis textos que el dueño aprobó el 14/11/2026 (`decisiones-del-dueno-2026-11.md`, fila del 14/11, punto 2; mensaje del dueño del 14/11/2026). Los pide la
  // pantalla de Conteo (`stock-conteo.html`); entran con la base para que Conteo y Movimientos no editen este archivo a la vez (`pantallas-de-stock-inventario.md` §2 B7 y §9).
  // `{hora}` en «Movido desde las {hora}» es un marcador de implementación (el texto aprobado trae «10:00» de ejemplo; la hora es la de ese artículo).
  "stock.conteo.hora": { porDefecto: "Hora del conteo" },
  "stock.conteo.sistema_a_esa_hora": { porDefecto: "Sistema a esa hora" },
  "stock.conteo.movido_desde": { porDefecto: "Movido desde las {hora}", marcadores: ["hora"] },
  "stock.conteo.ver_detalle": { porDefecto: "Ver detalle" },
  "stock.conteo.ya_habia_ocurrido": { porDefecto: "Ya había ocurrido cuando contaste" },
  // Es un motivo de DIFERENCIA del conteo (faltante), no de un movimiento: por eso no es `stock.motivo.*`.
  "stock.conteo.motivo_venta_no_registrada": { porDefecto: "Venta no registrada" },
} as const;
