import type { DefinicionDeDato, Proposito } from "./tipos-de-datos";

/**
 * Los datos del salón del registro de datos (ver `registro.ts`), en su propio archivo (una línea en el registro por módulo, sin pisar a los demás): los cinco datos de una mesa de la pantalla
 * «Mesas». Los rangos y las listas cerradas viven UNA vez, en `src/modulos/salon/dominio/mesa.ts` (la ficha del dato); la pantalla no escribe ningún número.
 */

const FORMULARIO_DE_MESA = "apps/web/ui/plantillas/salon/FormularioDeMesa.cliente.tsx";
const FICHA_DE_LA_MESA = "src/modulos/salon/dominio/mesa.ts";
const REQUIERE_SALON = { modulo: "salon", estadoDeEmpresa: ["ACTIVE"] } as const;
const PONER_MESAS = ["mesas.crear", "mesas.editar"] as const;

const DE_LA_MESA = (para: string): Proposito => ({
  para,
  fuente:
    "Pedernal-docs/11-especificaciones/e7-salon-e-impresion-especificacion.md §3.4 (`crearMesa` y `editarMesa`) y §10, y la maqueta aprobada el 09/11/2026 (`mesas.html`, «Agregar mesa» y «Editar mesa», carpeta de prototipos de Pedernal-docs 10-ux-ui); quién: Gerente y Administrador (el dueño, mesas.*)",
});

export const DATOS_DE_SALON = {
  "numero-de-mesa": {
    ficha: FICHA_DE_LA_MESA,
    propositos: [
      DE_LA_MESA("Número de la mesa al crearla y editarla: de 1 a 99, único por sucursal."),
    ],
    consumidores: [FORMULARIO_DE_MESA],
    ponerPor: PONER_MESAS,
    requiere: REQUIERE_SALON,
  },
  "forma-de-mesa": {
    ficha: FICHA_DE_LA_MESA,
    propositos: [DE_LA_MESA("Forma de la mesa: redonda, cuadrada o larga.")],
    consumidores: [FORMULARIO_DE_MESA],
    ponerPor: PONER_MESAS,
    requiere: REQUIERE_SALON,
  },
  "tamano-de-mesa": {
    ficha: FICHA_DE_LA_MESA,
    propositos: [DE_LA_MESA("Tamaño de la mesa: chica, mediana o grande.")],
    consumidores: [FORMULARIO_DE_MESA],
    ponerPor: PONER_MESAS,
    requiere: REQUIERE_SALON,
  },
  "columna-de-mesa": {
    ficha: FICHA_DE_LA_MESA,
    propositos: [DE_LA_MESA("Columna de la esquina de la mesa en el plano (de 1 a 14).")],
    consumidores: [FORMULARIO_DE_MESA],
    ponerPor: PONER_MESAS,
    requiere: REQUIERE_SALON,
  },
  "fila-de-mesa": {
    ficha: FICHA_DE_LA_MESA,
    propositos: [DE_LA_MESA("Fila de la esquina de la mesa en el plano (de 1 a 9).")],
    consumidores: [FORMULARIO_DE_MESA],
    ponerPor: PONER_MESAS,
    requiere: REQUIERE_SALON,
  },
} as const satisfies Readonly<Record<string, DefinicionDeDato>>;
