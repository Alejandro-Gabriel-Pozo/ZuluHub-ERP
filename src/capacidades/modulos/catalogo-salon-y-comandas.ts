/**
 * Los módulos de E7 (salón y comandas), en su archivo para que `catalogo.ts` no pase el tope de líneas; `CATALOGO_DE_MODULOS` los suma con un spread.
 * Misma forma que cualquier módulo: la comprueba el `satisfies` de `CATALOGO_DE_MODULOS` (acá no se importa su tipo para no hacer un ciclo).
 */
export const MODULOS_DE_SALON_Y_COMANDAS = {
  /**
   * Comandas (E7; `e7-salon-e-impresion-especificacion.md` §3.1, §3.5 y §3.13): el envío a cocina numerado, el aviso de anulación, el orden de salida y la
   * impresión (impresoras, trabajos, copias). Nace `en_desarrollo` y SIN plan: a qué plan pertenece es una pregunta abierta del dueño. Conoce las cuentas
   * y las líneas por id; no sabe qué es una mesa. Anular un ítem ya enviado usa `cuentas.anular_linea` de ventas (los tres roles, decisión 155).
   */
  comandas: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["ventas"],
    usaSiExiste: ["stock"],
    datosRequeridos: [],
    implementadoPor: ["modulos/comandas"],
    acciones: {
      "comandas.ver": { capacidad: null, efecto: "LECTURA" },
      "comandas.enviar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "impresiones.imprimir": { capacidad: null, efecto: "CREA_AMPLIA" },
      "impresiones.reimprimir": { capacidad: null, efecto: "CREA_AMPLIA" },
      "impresoras.ver": { capacidad: null, efecto: "LECTURA" },
      "impresoras.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "impresoras.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "impresoras.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    },
  },
  /**
   * Salón (E7; §3.1, §3.4 y §3.13): las mesas y su plano, la cuenta de mesa sobre ventas, cambiar de mesa, unir, dividir y cobrar la mesa. Orquesta ventas
   * y comandas en la misma transacción. Nace `en_desarrollo` y SIN plan (pregunta abierta del dueño). Tomar pedido, agregar, quitar, liberar y cobrar usan
   * las acciones de ventas, sin acción nueva.
   */
  salon: {
    estado: "en_desarrollo",
    obligatorio: false,
    requiere: ["ventas", "comandas"],
    usaSiExiste: [],
    datosRequeridos: [],
    implementadoPor: ["modulos/salon"],
    acciones: {
      "mesas.ver": { capacidad: null, efecto: "LECTURA" },
      "mesas.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
      "mesas.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "mesas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "mesas.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "salon.cambiar_mesa": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "salon.unir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "salon.dividir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    },
  },
} as const;
