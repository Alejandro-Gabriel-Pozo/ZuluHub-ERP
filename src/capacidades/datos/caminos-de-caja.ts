import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos del módulo caja (medios de pago, cuentas de cobro y cajas) (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas líneas: solo
 * cambia la ubicación, ningún camino. Un camino no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`).
 */

const FORMULARIO_DE_MEDIO = "apps/web/ui/plantillas/caja/FormularioDeMedio.cliente.tsx";
const FORMULARIO_DE_CUENTA = "apps/web/ui/plantillas/caja/FormularioDeCuenta.cliente.tsx";
const FORMULARIO_DE_CAJA = "apps/web/ui/plantillas/caja/FormularioDeCaja.cliente.tsx";

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
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
