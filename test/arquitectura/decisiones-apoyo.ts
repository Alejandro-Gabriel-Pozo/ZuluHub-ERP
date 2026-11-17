import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface Entrada {
  id: string;
  fecha: string;
  quien: string;
  tipo: string;
  estado: string;
  decision: string;
  que_cambia: string;
  donde: string;
  motivo?: string;
}
export interface Arbol {
  rutas: string[];
  leer: (ruta: string) => Buffer | null;
}
interface Excepcion {
  id: string;
  fecha: string;
  fuente: string;
}
export interface Cuota {
  vigente_desde: string;
  negocio: number;
  tecnicas: number;
  excepciones: Excepcion[];
}
/** La cuota del repo con una vigencia anterior a las fechas de las entradas de ejemplo (2026-11-11), para que cuenten. */
export const CUOTA: Cuota = {
  vigente_desde: "2026-11-01",
  negocio: 5,
  tecnicas: 10,
  excepciones: [],
};
export interface Hallazgo {
  archivo: string;
  linea: number;
  motivo: string;
}

export const TIPOS = [
  "DINERO",
  "PERMISOS",
  "CLIENTE",
  "DATOS",
  "COMERCIAL",
  "INFRAESTRUCTURA",
  "SIN_DECISION",
];
export const ESTADOS = ["PENDIENTE_DE_OK", "CONFIRMADA", "CORREGIDA"];
export const QUIENES = ["dueño", "padre", "sesión"];
export const forma = require("../../arquitectura/decisiones/forma.cjs") as {
  problemasDelRegistro: (registro: unknown) => { id: string; problema: string }[];
  problemasDeLosSensibles: (valor: unknown) => string[];
  problemasDeLaCuota: (valor: unknown) => string[];
};
export const control = require("../../arquitectura/decisiones/decisiones.cjs") as {
  CARPETA_DEL_REGISTRO: string;
  MONOLITO_DEL_REGISTRO: string;
  ARCHIVO_DE_LOS_SENSIBLES: string;
  ARCHIVO_DE_LA_CUOTA: string;
  EXENTOS: string[];
  COMO_AGREGAR: string;
  ejecutar: (argumentos: string[], raiz: string) => { codigo: number; lineas: string[] };
  evaluar: (datos: { pr: Arbol; base?: Arbol | null }) => {
    fallas: Hallazgo[];
    avisos: Hallazgo[];
  };
};
export const resumen = require("../../arquitectura/decisiones/resumen.cjs") as {
  resumir: (registro: Entrada[]) => string;
  ejecutar: (raiz: string) => { codigo: number; salida: string; errores: string[] };
};

/** Una entrada válida (de tipo PERMISOS, pendiente); `cambios` pisa lo que se pida. */
export const entrada = (cambios: Partial<Entrada> = {}): Entrada => ({
  id: "DEC-0001",
  fecha: "2026-11-11",
  quien: "sesión",
  tipo: "PERMISOS",
  estado: "PENDIENTE_DE_OK",
  decision: "El operador no ve los costos.",
  que_cambia: "El operador deja de ver el costo de cada producto.",
  donde: "src/capacidades/permisos/empresa.ts",
  ...cambios,
});

export const SENSIBLES = {
  sensibles: [
    { ruta: "src/capacidades/permisos/", que: "la matriz de permisos" },
    { ruta: "src/primitivas/dinero/", que: "el dinero y el redondeo" },
    {
      ruta: "arquitectura/decisiones/archivos-sensibles.json",
      que: "la lista de archivos sensibles",
    },
  ],
};

/** Un árbol en memoria: `archivos` es { ruta: contenido }. */
function arbol(archivos: Record<string, string>): Arbol {
  return {
    rutas: Object.keys(archivos).sort(),
    leer: (ruta) => (ruta in archivos ? Buffer.from(archivos[ruta] as string) : null),
  };
}

/** Los archivos del registro: uno por entrada, «<id>.json» dentro de la carpeta (el nombre del archivo es el id). */
export function archivosDelRegistro(registro: unknown[]): Record<string, string> {
  return Object.fromEntries(
    registro.map((entrada, posicion) => [
      `${control.CARPETA_DEL_REGISTRO}/${(entrada as { id?: string }).id ?? `sin-id-${posicion}`}.json`,
      JSON.stringify(entrada),
    ]),
  );
}

/** Un árbol con el registro y la lista de sensibles ya escritos, más `otros` archivos. */
export function arbolConRegistro(
  registro: unknown[],
  otros: Record<string, string> = {},
  sensibles: unknown = SENSIBLES,
  laCuota: unknown = CUOTA,
): Arbol {
  return arbol({
    ...archivosDelRegistro(registro),
    [control.ARCHIVO_DE_LOS_SENSIBLES]: JSON.stringify(sensibles),
    [control.ARCHIVO_DE_LA_CUOTA]: JSON.stringify(laCuota),
    ...otros,
  });
}

/** La palabra que el control busca, armada acá para que este archivo no se cuente a sí mismo (además está exento por su nombre). */
export const MARCA = ["SUPUES", "TO"].join("");
