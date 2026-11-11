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
export interface Hallazgo {
  archivo: string;
  linea: number;
  motivo: string;
}

export const forma = require("../../arquitectura/decisiones/forma.cjs") as {
  TIPOS: string[];
  ESTADOS: string[];
  QUIENES: string[];
  esFechaReal: (fecha: unknown) => boolean;
  problemasDelRegistro: (registro: unknown) => { id: string; problema: string }[];
  problemasDeUnaEntrada: (entrada: unknown) => string[];
  problemasDeLosSensibles: (valor: unknown) => string[];
};
export const control = require("../../arquitectura/decisiones/decisiones.cjs") as {
  ARCHIVO_DEL_REGISTRO: string;
  ARCHIVO_DE_LOS_SENSIBLES: string;
  EXENTOS: string[];
  ejecutar: (argumentos: string[], raiz: string) => { codigo: number; lineas: string[] };
  evaluar: (datos: { pr: Arbol; base?: Arbol | null }) => {
    fallas: Hallazgo[];
    avisos: Hallazgo[];
  };
};
export const resumen = require("../../arquitectura/decisiones/resumen.cjs") as {
  resumir: (registro: Entrada[]) => string;
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
export function arbol(archivos: Record<string, string>): Arbol {
  return {
    rutas: Object.keys(archivos).sort(),
    leer: (ruta) => (ruta in archivos ? Buffer.from(archivos[ruta] as string) : null),
  };
}

/** Un árbol con el registro y la lista de sensibles ya escritos, más `otros` archivos. */
export function arbolConRegistro(
  registro: unknown[],
  otros: Record<string, string> = {},
  sensibles: unknown = SENSIBLES,
): Arbol {
  return arbol({
    [control.ARCHIVO_DEL_REGISTRO]: JSON.stringify(registro),
    [control.ARCHIVO_DE_LOS_SENSIBLES]: JSON.stringify(sensibles),
    ...otros,
  });
}

/** La palabra que el control busca, armada acá para que este archivo no se cuente a sí mismo (además está exento por su nombre). */
export const MARCA = ["SUPUES", "TO"].join("");
