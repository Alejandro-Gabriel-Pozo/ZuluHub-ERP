/**
 * Caja (E3; `e0-cimientos-especificacion.md` §3.1.1, lista de `e3-caja-y-cobros-especificacion.md` §3.8 más las dos
 * de `e3b-cierre-del-dia-especificacion.md` §4.7). Nace `en_desarrollo`: el guard rechaza todo con
 * `MODULO_EN_DESARROLLO` hasta que E3 lo construya. `usaSiExiste` solo nombra módulos que existen (cruce X3):
 * `clientes` se suma cuando exista (SUPUESTO (DEC-0058) S-1). Ninguna acción exige capacidad de sucursal: el alcance del
 * operador lo valida el caso de uso con `exigirSucursal`. Cobrar un ticket NO es de caja: es `tickets.cobrar`
 * (ventas). No existen `sesiones_caja.reabrir`, `arqueos.revisar` ni una acción de plataforma para crear cajas
 * (decisiones del dueño, `caja-y-cobros.md:818-821`). Criterio de efectos: alta, edición, reactivar, abrir sesión y
 * movimientos o ajustes nuevos crean o amplían; desactivar, cerrar, anular y corregir cierran lo ya iniciado.
 * Elegir los datos opcionales de cada medio es `medios_de_pago.editar` (SUPUESTO (DEC-0056) S-2).
 */
export const MODULO_DE_CAJA = {
  estado: "disponible",
  obligatorio: false,
  requiere: ["administracion"],
  usaSiExiste: ["facturacion"],
  datosRequeridos: [],
  implementadoPor: ["modulos/caja"],
  acciones: {
    "cajas.ver": { capacidad: null, efecto: "LECTURA" },
    "cajas.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cajas.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cajas.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cajas.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "medios_de_pago.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "medios_de_pago.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "medios_de_pago.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "medios_de_pago.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "cuentas_de_cobro.crear": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuentas_de_cobro.editar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuentas_de_cobro.reactivar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuentas_de_cobro.desactivar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "sesiones_caja.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
    "sesiones_caja.iniciar_cierre": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "sesiones_caja.cancelar_cierre": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "sesiones_caja.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "movimientos_caja.registrar_manual": { capacidad: null, efecto: "CREA_AMPLIA" },
    "movimientos_caja.ajustar": { capacidad: null, efecto: "CREA_AMPLIA" },
    "movimientos_caja.anular": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "movimientos_caja.anular_de_otros": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "cobros.corregir_medio": { capacidad: null, efecto: "COMPLETA_CIERRA" },
    "declaraciones_de_total.registrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
  },
} as const;
