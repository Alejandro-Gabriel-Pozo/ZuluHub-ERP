/**
 * El módulo de compras, en su archivo para que `catalogo.ts` no pase el tope de líneas (`CATALOGO_DE_MODULOS` lo suma por su clave). Misma forma que cualquier módulo: la
 * comprueba el `satisfies` de `CATALOGO_DE_MODULOS`.
 *
 * Compras (E9-T1; `e9-compras-especificacion.md` §3.0 y §3.9): ficha de compra del proveedor, recepción y factura
 * (N1 y N2), pago mínimo y corrección. Nace `en_desarrollo` hasta E9-T12. `usaSiExiste: ["stock"]`: sin stock activo
 * registra compras y facturas sin entrada de stock (S-9). `costos.ver` es de stock (E5-T10), no de acá. Las acciones
 * de N3 y N4 (órdenes, conciliaciones, notas de crédito, devoluciones) las declaran T13 y T14. Criterio de efectos:
 * mirar es `LECTURA`; anular una compra o un pago cierra lo ya iniciado; cargar, pagar, corregir, configurar y pedir
 * o editar la ficha crean o amplían.
 */
export const MODULO_DE_COMPRAS = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion", "clientes", "catalogo"],
  usaSiExiste: ["stock"],
  datosRequeridos: [],
  implementadoPor: ["modulos/compras"],
  acciones: {
    "proveedores.editar_ficha": { capacidad: null, efecto: "CREA_AMPLIA" },
    "proveedores.pedir_ficha": { capacidad: null, efecto: "CREA_AMPLIA" },
    "recepciones.ver": { capacidad: null, efecto: "LECTURA" },
    "recepciones.registrar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "recepciones.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "recepciones.confirmar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "conciliaciones.ver": { capacidad: null, efecto: "LECTURA" },
    "conciliaciones.conciliar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "conciliaciones.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "comprobantes_de_proveedor.ver": { capacidad: null, efecto: "LECTURA" },
    "comprobantes_de_proveedor.registrar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "comprobantes_de_proveedor.pagar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "comprobantes_de_proveedor.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "comprobantes_de_proveedor.anular_pago": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "ordenes_de_compra.ver": { capacidad: null, efecto: "LECTURA" },
    "ordenes_de_compra.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "ordenes_de_compra.pedir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "ordenes_de_compra.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "ordenes_de_compra.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "compras.configurar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "compras.corregir": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
