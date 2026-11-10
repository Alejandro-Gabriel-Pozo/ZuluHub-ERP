/**
 * Los textos del módulo `stock` (prefijo `stock.`, E5 §10). Ninguno es nuevo: todos salen de la lista que el dueño aprobó el 09/11/2026 en el
 * prototipo `stock.html`, sección «Textos nuevos» (decisión D125), que es la fuente de cada grupo de abajo (`10-ux-ui/prototipos-gastronomia/
 * stock.html:266`, repositorio de documentos, una fila por grupo). Lo que esa lista no trae no se agrega acá: los errores sin texto aprobado
 * (`STOCK_SIN_DEPOSITO_DE_VENTA`, `CONTEO_SIN_REGISTROS`, `CLAVE_REUTILIZADA`, `*_DESACTUALIZADA`, `ARTICULO_NO_CONTROLADO`, `CLASE_NO_CONTROLABLE`,
 * `MOVIMIENTO_NO_ANULABLE`, `MOVIMIENTO_YA_ANULADO`, `DEPOSITO_CON_EXISTENCIA`, `FUNCION_NO_INCLUIDA`…) se muestran con el mensaje genérico que ya
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
  "stock.error.control_bloquea": { porDefecto: "No hay stock suficiente" },
  "stock.error.transferencia_al_mismo_deposito": {
    porDefecto: "El origen y el destino no pueden ser el mismo",
  },
  "stock.error.detalle_requerido": { porDefecto: "Escribí el detalle" },
  "stock.error.cantidad_invalida": { porDefecto: "La cantidad tiene que ser mayor que cero" },
  "stock.error.conteo_en_curso": { porDefecto: "Ya hay un conteo abierto en este depósito" },
  "stock.error.nombre_duplicado": { porDefecto: "Ya existe un depósito con ese nombre" },
  // stock.html, nota final de «Textos nuevos» («Esta acción no está permitida» ya estaba aprobado), sin el punto final de esa nota.
  "stock.error.sin_permiso": { porDefecto: "Esta acción no está permitida" },
} as const;
