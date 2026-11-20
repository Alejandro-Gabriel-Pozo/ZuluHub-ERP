/**
 * Cierre del día (E3b; decisión 163; `e0-cimientos-especificacion.md` §3.1.2b, `e3b-cierre-del-dia-especificacion.md`
 * §3.1 y §3.6). Módulo propio, separado de la caja: no importa ningún módulo comercial. `disponible` desde E3b: la jornada, los tres
 * casos de uso (iniciar y cancelar la auditoría, cerrar) y las tres consultas existen; los aportes de caja y ventas los suman sus etapas.
 * Iniciar y cancelar la auditoría y cerrar la jornada completan o cierran lo ya iniciado, y se permiten en solo lectura.
 */
export const MODULO_DE_CIERRE = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion"],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/cierre"],
  acciones: {
    "jornadas.ver": { capacidad: null, efecto: "LECTURA" },
    "jornadas.iniciar_auditoria": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "jornadas.cancelar_auditoria": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "jornadas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  },
} as const;
