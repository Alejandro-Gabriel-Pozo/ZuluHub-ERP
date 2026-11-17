import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inject } from "vitest";
import {
  cuitDesdeTexto,
  digitoVerificadorDeCuit,
  type Cuit,
} from "../../src/primitivas/identificacion-fiscal/cuit";

/**
 * El generador COMÚN de valores únicos de las pruebas de integración: CUIT, números de comprobante, correos, nombres y sufijos. Previene la clase de falla «dato único
 * elegido al azar que choca» (casos reales: `empresa_cuit_uk` en «Estabilidad», #191 y #305, con cuerpos consecutivos 41458321 y 41458322): la unicidad es DETERMINISTA
 * por construcción, no probable.
 *
 * Cómo: todos los archivos de una corrida comparten UNA base. La corrida (global.ts) crea una carpeta de reservas; cada archivo de pruebas (módulo cargado una vez por
 * archivo) toma un PUESTO con `mkdir`, que es atómico: nunca dos archivos con el mismo puesto, aunque corran a la vez o uno detrás de otro en el mismo proceso. Dentro de su
 * puesto cada valor sale de un contador: `puesto * VALORES_POR_PUESTO + contador`. Dos valores de dos archivos distintos NUNCA coinciden (rangos disjuntos) y dos del mismo
 * archivo tampoco (contador). Si un archivo agota su puesto o la corrida agota los puestos, FALLA en voz alta: nunca repite.
 * Todo lo que tenga una restricción de unicidad en la base sale de acá; una regla de arquitectura lo exige (`test/arquitectura/ids-unicos.test.ts`).
 */

/** Cuántos valores únicos tiene cada archivo de pruebas. Los cuerpos de CUIT son 10^8: con 2 000 puestos cada uno tiene 50 000. */
export const VALORES_POR_PUESTO = 50_000;
/** Cuántos archivos de pruebas caben en una corrida (10^8 / VALORES_POR_PUESTO). */
export const PUESTOS = 2_000;

/** Toma el primer puesto libre de la carpeta: `mkdir` falla con `EEXIST` si otro ya lo tomó, y eso es atómico entre procesos. */
export function reservarPuesto(carpeta: string): number {
  for (let puesto = 0; puesto < PUESTOS; puesto++) {
    try {
      mkdirSync(join(carpeta, String(puesto)));
      return puesto;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
    }
  }
  throw new Error(`ids únicos: se agotaron los ${PUESTOS} puestos de la corrida`);
}

export type GeneradorDeUnicos = Readonly<{
  /** El puesto de este archivo en la corrida (para diagnóstico). */
  puesto: number;
  /** El próximo valor entero único de la corrida, de 0 a 99 999 999. */
  siguiente(): number;
  /** Un CUIT válido, único en la corrida (el dígito verificador sale de la primitiva de identificación fiscal). Sin prefijo: de 20 a 33, según el valor. */
  cuit(prefijo?: "20" | "27" | "30"): Cuit;
  /** Un número entero positivo único (de comprobante, de orden…), de hasta 8 cifras. */
  numero(): number;
  /** Un texto corto único, solo de letras y cifras en minúscula (base 36). */
  sufijo(): string;
  /** Un texto corto único de SOLO letras minúsculas (base 26): para nombres que no deben llevar dígitos (la lista de permitidos los admite, pero así no se confunden con un número). */
  letras(): string;
  /** `prefijo letras`: un nombre único sin dígitos en el sufijo. */
  nombreDeLetras(prefijo: string): string;
  /** `prefijo-sufijo`: un nombre único para empresas, tenants, productos, sucursales… */
  nombre(prefijo: string): string;
  /** Un correo único `local@prueba.test`. */
  correo(local?: string): string;
  /** Una referencia de error única, con la forma de `referencia_de_error_referencia_ck`: `PD-XXXX-XXXX` (8 cifras hexadecimales en mayúscula). */
  referenciaDeError(): string;
}>;

/** Crea un generador sobre una carpeta de reservas (la corrida real, o una de prueba). Cada llamada toma su propio puesto. */
export function crearGeneradorDeUnicos(carpeta: string): GeneradorDeUnicos {
  const puesto = reservarPuesto(carpeta);
  let usados = 0;
  const siguiente = (): number => {
    if (usados >= VALORES_POR_PUESTO) {
      throw new Error(
        `ids únicos: este archivo pidió más de ${VALORES_POR_PUESTO} valores únicos (puesto ${puesto})`,
      );
    }
    return puesto * VALORES_POR_PUESTO + usados++;
  };
  const cuit = (prefijo?: "20" | "27" | "30"): Cuit => {
    for (;;) {
      const cuerpo = siguiente();
      const diez = `${prefijo ?? 20 + (cuerpo % 14)}${String(cuerpo).padStart(8, "0")}`;
      const verificador = digitoVerificadorDeCuit(diez);
      if (verificador === null) continue;
      const resultado = cuitDesdeTexto(`${diez}${verificador}`);
      if (resultado.ok) return resultado.valor;
    }
  };
  const sufijo = (): string => siguiente().toString(36);
  const letras = (): string => {
    let resto = siguiente();
    let texto = "";
    do {
      texto = String.fromCharCode(97 + (resto % 26)) + texto;
      resto = Math.floor(resto / 26);
    } while (resto > 0);
    return texto;
  };
  return {
    puesto,
    siguiente,
    cuit,
    numero: () => siguiente() + 1,
    sufijo,
    letras,
    nombreDeLetras: (prefijo) => `${prefijo} ${letras()}`,
    nombre: (prefijo) => `${prefijo}-${sufijo()}`,
    correo: (local = "u") => `${local}${sufijo()}@prueba.test`,
    referenciaDeError: () => {
      const hex = siguiente().toString(16).toUpperCase().padStart(8, "0");
      return `PD-${hex.slice(0, 4)}-${hex.slice(4)}`;
    },
  };
}

let delArchivo: GeneradorDeUnicos | undefined;

/**
 * El generador de ESTE archivo de pruebas. Usa la carpeta de reservas de la corrida (la que crea `global.ts`); sin corrida (no hay base compartida: nadie con quien
 * chocar) usa una carpeta propia y nueva.
 */
export function unicos(): GeneradorDeUnicos {
  if (delArchivo === undefined) {
    const carpeta = inject("reservaDeUnicos") ?? mkdtempSync(join(tmpdir(), "pedernal-unicos-"));
    delArchivo = crearGeneradorDeUnicos(carpeta);
  }
  return delArchivo;
}

export const cuitUnico = (prefijo?: "20" | "27" | "30"): Cuit => unicos().cuit(prefijo);
export const numeroUnico = (): number => unicos().numero();
export const sufijoUnico = (): string => unicos().sufijo();
export const nombreUnico = (prefijo: string): string => unicos().nombre(prefijo);
export const referenciaDeErrorUnica = (): string => unicos().referenciaDeError();
export const correoUnico = (local?: string): string => unicos().correo(local);
export const nombreDeLetrasUnico = (prefijo: string): string => unicos().nombreDeLetras(prefijo);
