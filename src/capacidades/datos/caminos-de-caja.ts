import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo caja (medios de pago, cuentas de cobro y cajas) (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas: solo
 * cambia la ubicación, ningún camino. Un camino no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const FORMULARIO_DE_MEDIO = "apps/web/ui/plantillas/caja/FormularioDeMedio.cliente.tsx";
const FORMULARIO_DE_CUENTA = "apps/web/ui/plantillas/caja/FormularioDeCuenta.cliente.tsx";
const FORMULARIO_DE_CAJA = "apps/web/ui/plantillas/caja/FormularioDeCaja.cliente.tsx";
const FORMULARIO_DE_APERTURA = "apps/web/ui/plantillas/caja/FormularioDeApertura.cliente.tsx";
const FORMULARIO_DE_MOVIMIENTO = "apps/web/ui/plantillas/caja/FormularioDeMovimiento.cliente.tsx";
const FORMULARIO_DE_ANULACION = "apps/web/ui/plantillas/caja/FormularioDeAnulacion.cliente.tsx";
const FORMULARIO_DE_CIERRE = "apps/web/ui/plantillas/caja/FormularioDeCierre.cliente.tsx";

export const CAMINOS_DE_CAJA = {
  // Medios de pago, alta: el tipo es obligatorio (lista cerrada) y el nombre es opcional. Sin `campo` de error: los rechazos de esta pantalla son el aviso genérico y el del nombre
  // repetido, que no apuntan a un campo (maqueta `medios.html`, 09/11/2026).
  "agregar-medio-de-pago": {
    funcion: "Agregar un medio de pago de la empresa",
    pantallas: [FORMULARIO_DE_MEDIO],
    pasos: [
      {
        id: "datos-del-medio",
        campos: { tipo: "tipo-de-medio-de-pago", nombre: "nombre-de-medio-de-pago" },
      },
    ],
    deriva: [],
    accion: {
      clave: "medios_de_pago.crear",
      requiere: ["tipo-de-medio-de-pago"],
      admite: ["nombre-de-medio-de-pago"],
    },
    camposDeError: [],
  },
  // Medios de pago, edición: solo el nombre (el tipo no se cambia; en pantalla sale apagado y no viaja).
  "editar-medio-de-pago": {
    funcion: "Cambiar el nombre de un medio de pago",
    pantallas: [FORMULARIO_DE_MEDIO],
    pasos: [{ id: "nombre-del-medio", campos: { nombre: "nombre-de-medio-de-pago" } }],
    deriva: [],
    accion: { clave: "medios_de_pago.editar", requiere: [], admite: ["nombre-de-medio-de-pago"] },
    camposDeError: [],
  },
  // Cuentas de cobro, alta: el tipo, el nombre y la sucursal son obligatorios; el identificador es opcional. Los rechazos que apuntan a un campo: el identificador con forma de credencial.
  "agregar-cuenta-de-cobro": {
    funcion: "Agregar una cuenta de cobro (terminal, QR o cuenta bancaria) de una sucursal",
    pantallas: [FORMULARIO_DE_CUENTA],
    pasos: [
      {
        id: "datos-de-la-cuenta",
        campos: {
          nombre: "nombre-de-cuenta-de-cobro",
          tipo: "tipo-de-cuenta-de-cobro",
          identificadorExterno: "identificador-de-cuenta-de-cobro",
          sucursalId: "sucursal-de-cuenta-de-cobro",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "cuentas_de_cobro.crear",
      requiere: [
        "nombre-de-cuenta-de-cobro",
        "tipo-de-cuenta-de-cobro",
        "sucursal-de-cuenta-de-cobro",
      ],
      admite: ["identificador-de-cuenta-de-cobro"],
    },
    camposDeError: [],
  },
  // Cuentas de cobro, edición: nombre, identificador y sucursal (el tipo no se cambia; en pantalla sale apagado y no viaja).
  "editar-cuenta-de-cobro": {
    funcion: "Cambiar el nombre, el identificador o la sucursal de una cuenta de cobro",
    pantallas: [FORMULARIO_DE_CUENTA],
    pasos: [
      {
        id: "datos-de-la-cuenta",
        campos: {
          nombre: "nombre-de-cuenta-de-cobro",
          identificadorExterno: "identificador-de-cuenta-de-cobro",
          sucursalId: "sucursal-de-cuenta-de-cobro",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "cuentas_de_cobro.editar",
      requiere: ["nombre-de-cuenta-de-cobro", "sucursal-de-cuenta-de-cobro"],
      admite: ["identificador-de-cuenta-de-cobro"],
    },
    camposDeError: [],
  },
  // Cajas, alta y edición: solo el nombre. La sucursal de una caja nueva la fija el servidor (la elegida en el dispositivo): no es un dato que ningún paso pida.
  "agregar-caja": {
    funcion: "Agregar una caja a la sucursal elegida",
    pantallas: [FORMULARIO_DE_CAJA],
    pasos: [{ id: "nombre-de-la-caja", campos: { nombre: "nombre-de-caja" } }],
    deriva: [],
    accion: { clave: "cajas.crear", requiere: ["nombre-de-caja"], admite: [] },
    camposDeError: [],
  },
  "editar-caja": {
    funcion: "Cambiar el nombre de una caja",
    pantallas: [FORMULARIO_DE_CAJA],
    pasos: [{ id: "nombre-de-la-caja", campos: { nombre: "nombre-de-caja" } }],
    deriva: [],
    accion: { clave: "cajas.editar", requiere: ["nombre-de-caja"], admite: [] },
    camposDeError: [],
  },
  // Pantalla «Caja» del mostrador (maqueta `caja.html`, `vAbrir`, `vMov`, `vModal` y `vCierre`). Ninguna de estas acciones devuelve un error con `campo`: lo que no tiene la forma pedida es el genérico
  // «Esta acción no está permitida» (`accionDeCaja`, `errores-de-caja.ts`) y el importe o el motivo inválidos los avisa la pantalla antes de enviar; por eso `camposDeError` va vacío.
  // Abrir: solo el fondo inicial; la caja y la sucursal las fija el servidor.
  "abrir-caja": {
    funcion: "Abrir la caja con su fondo inicial",
    pantallas: [FORMULARIO_DE_APERTURA],
    pasos: [{ id: "fondo-inicial", campos: { fondoInicial: "importe-de-fondo-inicial" } }],
    deriva: [],
    accion: { clave: "sesiones_caja.abrir", requiere: ["importe-de-fondo-inicial"], admite: [] },
    camposDeError: [],
  },
  // Ingreso y egreso: importe sin signo y motivo; el sentido no es un campo (lo fija el botón con que se abre el formulario).
  "registrar-movimiento-de-caja": {
    funcion: "Registrar un ingreso o un egreso de la caja abierta",
    pantallas: [FORMULARIO_DE_MOVIMIENTO],
    pasos: [
      {
        id: "datos-del-movimiento",
        campos: {
          importe: "importe-de-movimiento-de-caja",
          motivo: "motivo-de-movimiento-de-caja",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "movimientos_caja.registrar_manual",
      requiere: ["importe-de-movimiento-de-caja", "motivo-de-movimiento-de-caja"],
      admite: [],
    },
    camposDeError: [],
  },
  // Ajuste: el sentido («Sobra» o «Falta») es una elección cerrada y el importe va sin signo; el signo lo arma la frontera (`entradas-de-sesion-de-caja.ts`).
  "registrar-ajuste-de-caja": {
    funcion: "Registrar un ajuste (sobra o falta) de la caja abierta",
    pantallas: [FORMULARIO_DE_MOVIMIENTO],
    pasos: [
      {
        id: "datos-del-ajuste",
        campos: {
          sentido: "sentido-de-ajuste-de-caja",
          importe: "importe-de-movimiento-de-caja",
          motivo: "motivo-de-movimiento-de-caja",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "movimientos_caja.ajustar",
      requiere: [
        "sentido-de-ajuste-de-caja",
        "importe-de-movimiento-de-caja",
        "motivo-de-movimiento-de-caja",
      ],
      admite: [],
    },
    camposDeError: [],
  },
  // Anular un movimiento manual: solo el motivo. Anular el de otra persona es otra acción de permiso (`movimientos_caja.anular_de_otros`) que decide el servidor; el formulario es el mismo.
  "anular-movimiento-de-caja": {
    funcion: "Anular un movimiento de la caja con su motivo",
    pantallas: [FORMULARIO_DE_ANULACION],
    pasos: [{ id: "motivo-de-la-anulacion", campos: { motivo: "motivo-de-movimiento-de-caja" } }],
    deriva: [],
    accion: {
      clave: "movimientos_caja.anular",
      requiere: ["motivo-de-movimiento-de-caja"],
      admite: [],
    },
    camposDeError: [],
  },
  // Cerrar: el efectivo se cuenta siempre (billetes y monedas), los demás medios se declaran o se aceptan «conforme» (un botón, no un dato) y la observación es opcional. Cada parte del conteo
  // admite vacío (la pantalla suma lo no escrito como cero); que el efectivo se haya contado lo exige el dominio (`CONTEO_DE_EFECTIVO_FALTANTE`, e3 §3.2), no el formulario.
  "cerrar-caja": {
    funcion: "Contar el efectivo y los demás medios y cerrar la caja",
    pantallas: [FORMULARIO_DE_CIERRE],
    pasos: [
      {
        id: "efectivo",
        campos: { billetes: "cantidad-de-billetes", monedas: "importe-de-monedas-contadas" },
      },
      { id: "otros-medios", campos: { contado: "importe-contado-de-medio" } },
      { id: "observacion", campos: { observacion: "observacion-de-cierre-de-caja" } },
    ],
    deriva: [],
    accion: {
      clave: "sesiones_caja.cerrar",
      requiere: [],
      admite: [
        "cantidad-de-billetes",
        "importe-de-monedas-contadas",
        "importe-contado-de-medio",
        "observacion-de-cierre-de-caja",
      ],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
