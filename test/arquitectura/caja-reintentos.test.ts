import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * REGLA: lo que escribe sobre una SESIÓN de caja pasa `reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA` a `transacciones.ejecutar`
 * (`src/modulos/caja/casos-de-uso/comun.ts`). Con el default del adaptador (6) la séptima transacción que llega a la vez sobre la misma
 * fila agota los reintentos y la persona ve `ConcurrenciaAgotada` (A12c: 12 de 320 con 16 simultáneas). Chequeo de comportamiento:
 * `test/integracion/caja-sesion-reintentos.test.ts`; esta prueba evita que un caso nuevo de la sesión vuelva al default sin que nadie lo decida.
 * Una violación inyectada abajo prueba que el analizador la ve.
 */
const RAIZ = join(import.meta.dirname, "../..");
const CASOS_DE_LA_SESION = [
  "abrir-sesion",
  "anular-movimiento",
  "cancelar-cierre",
  "cerrar-sesion",
  "corregir-medio-de-cobro",
  "dar-conforme-general",
  "declarar-total",
  "iniciar-cierre",
  "registrar-ajuste",
  "registrar-movimiento-manual",
] as const;

/** Cuántas llamadas a `transacciones.ejecutar(` hay y cuántas pasan la constante en sus opciones. */
export function llamadasSinLaConstante(texto: string): number {
  const llamadas = texto.match(/transacciones\.ejecutar\(\s*\{[^}]*\}/g) ?? [];
  return llamadas.filter((l) => !l.includes("reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA")).length;
}

describe("la sesión de caja reintenta como cobrar", () => {
  it.each(CASOS_DE_LA_SESION)("%s pasa la constante de reintentos", (caso) => {
    const texto = readFileSync(join(RAIZ, `src/modulos/caja/casos-de-uso/${caso}.ts`), "utf8");
    expect(texto.match(/transacciones\.ejecutar\(/g)?.length, caso).toBe(1);
    expect(llamadasSinLaConstante(texto), caso).toBe(0);
  });

  it("el analizador ve la violación (sin reintentos, o con otro número)", () => {
    expect(llamadasSinLaConstante("transacciones.ejecutar(\n { contexto },\n f)")).toBe(1);
    expect(llamadasSinLaConstante("transacciones.ejecutar({ contexto, reintentos: 6 }, f)")).toBe(
      1,
    );
    expect(
      llamadasSinLaConstante(
        "transacciones.ejecutar(\n { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },\n f)",
      ),
    ).toBe(0);
  });
});
