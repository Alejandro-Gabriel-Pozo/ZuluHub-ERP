import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

/**
 * Los casos de uso de configuración fiscal del gerente (spec H7 fiscal §C, tramo T5) y la acción que cada uno exige
 * al guard (cruce X1 de ADR-003). Las acciones son del módulo `administracion` (obligatorio, nunca en solo
 * lectura ni en desarrollo) y solo del gerente (C11): el gerente tiene que poder confirmar sus datos fiscales y
 * activar un punto de venta ANTES de que exista la facturación, porque son sus `datosRequeridos`.
 */
export const DECLARACIONES_DE_CONFIGURACION = {
  guardarBorradorDeDatosFiscales: {
    accion: "datos_fiscales.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-web.test.ts",
        it: "repetir el guardado (doble clic, reintento de red): «ya estaba», sin escribir ni auditar otra vez",
      },
    },
  },
  // Crear el borrador a partir de la versión vigente (D-62) es editar: la misma acción que guardarlo.
  empezarCorreccionDeDatosFiscales: {
    accion: "datos_fiscales.editar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-web.test.ts",
        it: "D-62: empezar la corrección crea el borrador desde lo vigente; repetir o llamar desde otra pestaña devuelve el que existe",
      },
    },
  },
  confirmarDatosFiscales: {
    accion: "datos_fiscales.confirmar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-web.test.ts",
        it: "confirmar rige desde ya si no se dice otra cosa; repetirlo da «ya estaba» con el mismo número y no audita de nuevo",
      },
    },
  },
  crearPuntoDeVenta: {
    accion: "puntos_de_venta.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-puntos-de-venta.test.ts",
        it: "repetir el alta (el doble clic) no duplica nada: «ya existía» con la misma versión y una sola auditoría",
      },
    },
  },
  editarPuntoDeVenta: {
    accion: "puntos_de_venta.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-puntos-de-venta.test.ts",
        it: "la repetición manda: un pedido ya aplicado da «sin cambios» aunque la sucursal se haya cerrado después y la versión esperada esté vieja, sin escribir ni auditar",
      },
    },
  },
  activarPuntoDeVenta: {
    accion: "puntos_de_venta.activar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-puntos-de-venta.test.ts",
        it: "activar dos veces (el doble clic) es «ya estaba»: sin escribir y con una sola auditoría",
      },
    },
  },
  desactivarPuntoDeVenta: {
    accion: "puntos_de_venta.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-puntos-de-venta.test.ts",
        it: "desactivar uno que ya está INACTIVO es «ya estaba», sin escribir ni auditar; y se puede reactivar",
      },
    },
  },
  confirmarReglaDeEmisor: {
    accion: "emisores.confirmar_regla",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: "test/integracion/fiscal-configuracion-datos.test.ts",
        it: "repetir con el mismo id y lo mismo es «ya estaba» (sin otra fila ni auditoría); con otra decisión, ID_EN_USO",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
