import type { DefinicionDeCamino } from "./tipos-de-caminos";

/**
 * Los caminos de la pantalla «Cierre del día» (ver `caminos.ts`), en su propio archivo para que dos ramas que suman caminos de módulos distintos no toquen las mismas
 * líneas. Un camino no puede estar en dos fragmentos (lo comprueba `test/arquitectura/datos-por-modulo.test.ts`). «Cerrar el día», «Empezar el cierre», «Cancelar cierre» y el
 * «Conforme general» no piden ningún dato: no tienen camino.
 */

const MODAL_DE_RECONOCER = "apps/web/ui/plantillas/cierre/ModalDeReconocer.cliente.tsx";
const MODAL_DE_CORREGIR = "apps/web/ui/plantillas/cierre/ModalDeCorregirMedio.cliente.tsx";
const LINEA_DE_CONCILIACION = "apps/web/ui/plantillas/cierre/LineaDeConciliacion.cliente.tsx";

export const CAMINOS_DE_CIERRE = {
  // Reconocer un control: solo la observación, opcional. La marca se guarda en la pantalla y viaja al cerrar el día (`jornadas.cerrar`); sin `campo` de error: el rechazo es el genérico.
  "reconocer-un-control": {
    funcion:
      "Marcar un control del cierre del día para reconocerlo al cerrar, con una observación opcional",
    pantallas: [MODAL_DE_RECONOCER],
    pasos: [{ id: "observacion", campos: { texto: "texto-de-reconocimiento" } }],
    deriva: [],
    accion: { clave: "jornadas.cerrar", requiere: [], admite: ["texto-de-reconocimiento"] },
    camposDeError: [],
  },
  // Corregir el medio de un cobro: el medio y el motivo son obligatorios, la cuenta es opcional. Los rechazos son el genérico: ninguno apunta a un campo.
  "corregir-medio-de-cobro": {
    funcion: "Corregir el medio y la cuenta de un cobro de la jornada en cierre, con su motivo",
    pantallas: [MODAL_DE_CORREGIR],
    pasos: [
      {
        id: "datos-de-la-correccion",
        campos: {
          medioDestinoId: "medio-de-cobro",
          cuentaDestinoId: "cuenta-de-cobro",
          motivo: "motivo-de-correccion-de-medio",
        },
      },
    ],
    deriva: [],
    accion: {
      clave: "cobros.corregir_medio",
      requiere: ["medio-de-cobro", "motivo-de-correccion-de-medio"],
      admite: ["cuenta-de-cobro"],
    },
    camposDeError: [],
  },
  // Declarar el total de un medio que no es efectivo: el importe es obligatorio (0 vale). El medio y la cuenta los fija la línea de la conciliación, no se escriben.
  "declarar-total-de-un-medio": {
    funcion:
      "Declarar el total que dicen los comprobantes de un medio en la conciliación del cierre del día",
    pantallas: [LINEA_DE_CONCILIACION],
    pasos: [{ id: "total-declarado", campos: { importe: "importe-de-total-declarado" } }],
    deriva: [],
    accion: {
      clave: "declaraciones_de_total.registrar",
      requiere: ["importe-de-total-declarado"],
      admite: [],
    },
    camposDeError: [],
  },
} as const satisfies Readonly<Record<string, DefinicionDeCamino>>;
