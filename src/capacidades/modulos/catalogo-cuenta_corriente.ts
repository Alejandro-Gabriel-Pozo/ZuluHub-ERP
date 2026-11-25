/**
 * Cuenta corriente de clientes (CC-1; brief `PR-CC-1-ficha-del-cliente-y-clases-a-cobrar.md` §4, decisión del dueño del 25/11/2026: cuentas corrientes de clientes en
 * el primer despliegue). Dos acciones: administrar la ficha de habilitación del cliente (habilitar, suspender, reactivar, cambiar plazo y límite) y verla con su saldo.
 * SUPUESTO (DEC-1068) (CC-1): nace `en_desarrollo` (todo nace cerrado: el guard rechaza todo con `MODULO_EN_DESARROLLO` hasta que CC-5 traiga la pantalla y lo declare disponible);
 * se revierte cambiando `estado` a `disponible`, sin migración. `requiere` solo `clientes` (la ficha es de una parte con rol cliente; `clientes` ya requiere `administracion`).
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
  },
} as const;
