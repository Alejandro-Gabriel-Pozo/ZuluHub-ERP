/**
 * Cuenta corriente de clientes (CC-1; brief `PR-CC-1-ficha-del-cliente-y-clases-a-cobrar.md` §4, decisión del dueño del 25/11/2026: cuentas corrientes de clientes en
 * el primer despliegue). Dos acciones: administrar la ficha de habilitación del cliente (habilitar, suspender, reactivar, cambiar plazo y límite) y verla con su saldo.
 * SUPUESTO (DEC-1222) (CC-1): nace `en_desarrollo` (todo nace cerrado: el guard rechaza todo con `MODULO_EN_DESARROLLO` hasta que CC-5 traiga la pantalla y lo declare disponible);
 * se revierte cambiando `estado` a `disponible`, sin migración. `requiere` solo `clientes` (la ficha es de una parte con rol cliente; `clientes` ya requiere `administracion`).
 * CC-2 suma dos: `cargar_a_cuenta` (quién cierra una cuenta a nombre de un cliente: los roles que hoy cierran cuentas) y `aprobar_exceso` (quién deja pasar una venta por encima del límite
 * del cliente: gerente y administrador). Siguen cerradas con el módulo (SUPUESTO (DEC-CCL-001): nadie las tiene hasta que el dueño las apruebe y CC-5 abra el módulo).
 * `consultar_al_vender` (CC-5, C3 del dueño): los mismos roles que `cargar_a_cuenta` ven el saldo de UN cliente al venderle a cuenta (DEC-CCL-003, confirmada por el dueño: opción A, sin migración; ver `casos-de-uso/ver-cliente-para-vender.ts`).
 * El libro de saldos (`saldos_de_partes`) es interno, sin permisos ni catálogo propio. Administrar crea o amplía lo que hay (`CREA_AMPLIA`); mirar es `LECTURA`.
 */
export const MODULO_DE_CUENTA_CORRIENTE = {
  estado: "en_desarrollo",
  obligatorio: false,
  requiere: ["clientes"],
  usaSiExiste: [],
  datosRequeridos: [],
  implementadoPor: ["modulos/cuenta_corriente"],
  acciones: {
    "cuenta_corriente.ver": { capacidad: null, efecto: "LECTURA" },
    "cuenta_corriente.administrar": { capacidad: null, efecto: "CREA_AMPLIA" },
    // CC-2: cerrar una cuenta a nombre de un cliente (el cargo en el libro) y aprobar que una venta pase el límite de crédito.
    "cuenta_corriente.cargar_a_cuenta": { capacidad: null, efecto: "CREA_AMPLIA" },
    "cuenta_corriente.aprobar_exceso": { capacidad: null, efecto: "CREA_AMPLIA" },
    // CC-5 (C3 del dueño, 26/11/2026): quien vende a cuenta ve el estado, el saldo y el crédito disponible de UN cliente (el que elige para ese ticket), sin ver la lista con saldos ni el estado de cuenta.
    "cuenta_corriente.consultar_al_vender": { capacidad: null, efecto: "LECTURA" },
  },
} as const;
