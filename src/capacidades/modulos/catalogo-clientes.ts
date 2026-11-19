/**
 * Directorio de clientes y proveedores (E9; `e9-compras-especificacion.md` §3.0 y §3.9, F1 a F4 de `clientes-y-proveedores.md`). `disponible` y
 * `obligatorio` desde E9-T4 (F5 del 12/10: siempre activo). Ocho acciones; sin `partes.anonimizar`: ningún caso de uso la usa
 * (SUPUESTO S-3 de E9, DEC-0305). Mirar es `LECTURA`; desactivar cierra; el resto crea o amplía.
 */
export const MODULO_DE_CLIENTES = {
  estado: "disponible",
  obligatorio: true,
  requiere: ["administracion"],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/clientes"],
  acciones: {
    "partes.ver": { capacidad: null, efecto: "LECTURA" },
    "partes.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "partes.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "partes.cambiar_roles": { capacidad: null, efecto: "CREA_AMPLIA" },
    "partes.vincular_contacto": { capacidad: null, efecto: "CREA_AMPLIA" },
    "partes.desvincular_contacto": { capacidad: null, efecto: "CREA_AMPLIA" },
    "partes.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "partes.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
  },
} as const;
