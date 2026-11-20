/**
 * Facturación electrónica (H7, especificación §C). `disponible` (dueño, 2026-11-04) para probarla contra
 * ARCA en homologación: NO la activa para nadie. Cada empresa la necesita activa (`modulo_de_empresa`, por
 * la plataforma y dentro del techo de su plan) y la acción en su rol; si no, el guard rechaza con
 * `MODULO_NO_ACTIVO` o `SIN_PERMISO`. Declara la acción que exigen los
 * casos de uso de numeración (reservar y cerrar el número de un comprobante) y la de las consultas
 * del facturador (F6). Emitir completa algo ya vendido o cobrado, así que es `COMPLETA_CIERRA` y
 * una baja de plan no lo traba; mirar lo emitido es `LECTURA` y se puede siempre.
 */
export const MODULO_DE_FACTURACION = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion"],
  usaSiExiste: [],
  datosRequeridos: ["emisor_principal.datos_fiscales_confirmados", "punto_de_venta.activo"],
  implementadoPor: ["modulos/fiscal"],
  acciones: {
    "comprobantes.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "comprobantes.ver": { capacidad: null, efecto: "LECTURA" },
    // H7 facturación §C (F5): emitir a mano CREA un cargo (la factura y la nota de débito) y no se permite en
    // solo lectura; la nota de crédito, descartar, reintentar y resincronizar cierran lo que ya existe.
    // Cambiar el ambiente habilita a emitir con valor fiscal: amplía.
    "comprobantes.emitir_manual": { capacidad: null, efecto: "CREA_AMPLIA" },
    "notas_de_credito.emitir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "comprobantes.descartar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "comprobantes.reintentar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "series.resincronizar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "puntos_de_venta.cambiar_ambiente": { capacidad: null, efecto: "CREA_AMPLIA" },
    // H7 facturación §C (F7): generar el pedido de un certificado y cargar el que devolvió ARCA son altas que
    // habilitan a emitir con valor fiscal: crean y amplían, y no se permiten en solo lectura.
    "certificados.gestionar": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
