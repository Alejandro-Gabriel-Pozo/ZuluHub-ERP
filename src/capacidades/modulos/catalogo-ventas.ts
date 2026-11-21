/**
 * Ventas (E4; `e0-cimientos-especificacion.md` §3.1.2, tabla de `e4-venta-rapida-especificacion.md` §3.14). Nace
 * `en_desarrollo`. Las tres `ventas.configurar_*` de `ventas.md:610-611` quedan fuera hasta que haya stock
 * (PP-5, decisión 132). Anular línea, anular cuenta y corregir ticket son de los tres roles con todo auditado
 * (decisión 155). `tickets.cobrar` es la única acción para cobrar un ticket. `usaSiExiste` sin reservas ni
 * clientes porque no existen (cruce X3, SUPUESTO (DEC-0058) S-1).
 */
export const MODULO_DE_VENTAS = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion", "catalogo", "caja"],
  usaSiExiste: ["facturacion", "stock"],
  datosRequeridos: [],
  implementadoPor: ["modulos/ventas"],
  acciones: {
    "ventas.ver": { capacidad: null, efecto: "LECTURA" },
    "cuentas.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuentas.agregar_linea": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuentas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "cuentas.anular_linea": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "cuentas.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "tickets.cobrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "tickets.corregir": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  },
} as const;
