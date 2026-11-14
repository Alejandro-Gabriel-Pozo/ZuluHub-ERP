import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cuitDesdeTexto,
  digitoVerificadorDeCuit,
} from "../../src/primitivas/identificacion-fiscal/cuit";
import { crearGeneradorDeUnicos, PUESTOS, reservarPuesto, VALORES_POR_PUESTO } from "./unicos";

/**
 * El generador común de valores únicos (`unicos.ts`): la unicidad es determinista por construcción. No necesita base: prueba el mecanismo (los puestos y los rangos).
 * Regresión del caso real (`empresa_cuit_uk` en «Estabilidad», #305): dos procesos con el AZAR FIJADO IGUAL (la peor suerte posible) no pueden dar el mismo valor; con el
 * algoritmo anterior (el inicio de cada proceso era un sorteo) esta prueba falla.
 */
const carpetas: string[] = [];
const carpeta = () => {
  const c = mkdtempSync(join(tmpdir(), "pedernal-unicos-prueba-"));
  carpetas.push(c);
  return c;
};
afterEach(() => {
  vi.restoreAllMocks();
  for (const c of carpetas.splice(0)) rmSync(c, { recursive: true, force: true });
});

describe("valores únicos de las pruebas de integración", () => {
  it("dos procesos con el azar fijado igual no dan nunca el mismo CUIT: sus rangos son disjuntos, miles de valores cada uno", () => {
    // La peor suerte: todo sorteo da lo mismo. Con el algoritmo viejo (inicio al azar) los dos procesos recorrían exactamente los mismos cuerpos.
    vi.spyOn(Math, "random").mockReturnValue(0.5);
    const reserva = carpeta();
    const a = crearGeneradorDeUnicos(reserva);
    const b = crearGeneradorDeUnicos(reserva);
    expect(a.puesto).not.toBe(b.puesto);
    const deA = Array.from({ length: 5_000 }, () => a.cuit() as string);
    const deB = Array.from({ length: 5_000 }, () => b.cuit() as string);
    const todos = new Set([...deA, ...deB]);
    expect(todos.size).toBe(10_000);
  });

  it("cada CUIT es válido (dígito verificador de la primitiva de identificación fiscal) y respeta el prefijo pedido", () => {
    const g = crearGeneradorDeUnicos(carpeta());
    for (const prefijo of ["20", "27", "30"] as const) {
      const c = g.cuit(prefijo) as string;
      expect(c.startsWith(prefijo)).toBe(true);
      expect(cuitDesdeTexto(c).ok).toBe(true);
      expect(digitoVerificadorDeCuit(c.slice(0, 10))).toBe(Number(c[10]));
    }
    const sinPrefijo = g.cuit() as string;
    expect(Number(sinPrefijo.slice(0, 2))).toBeGreaterThanOrEqual(20);
    expect(Number(sinPrefijo.slice(0, 2))).toBeLessThanOrEqual(33);
  });

  it("numero, sufijo, nombre y correo salen del mismo contador: nunca se repiten entre sí ni entre procesos", () => {
    const reserva = carpeta();
    const a = crearGeneradorDeUnicos(reserva);
    const b = crearGeneradorDeUnicos(reserva);
    const vistos = new Set<string>();
    const total = 4_000;
    for (const g of [a, b]) {
      for (let i = 0; i < total; i++) {
        vistos.add(`n${g.numero()}`);
        vistos.add(`s${g.sufijo()}`);
        vistos.add(g.nombre("empresa"));
        vistos.add(g.correo("x"));
      }
    }
    // numero y sufijo vienen de valores distintos del contador: 4 por vuelta, 2 procesos.
    expect(vistos.size).toBe(4 * total * 2);
    expect(a.correo()).toMatch(/^u[0-9a-z]+@prueba\.test$/);
    expect(a.numero()).toBeGreaterThan(0);
  });

  it("los puestos se toman de a uno y no se repiten: el mismo directorio da puestos consecutivos", () => {
    const reserva = carpeta();
    expect([0, 1, 2].map(() => reservarPuesto(reserva))).toEqual([0, 1, 2]);
  });

  it("un archivo que agota su puesto FALLA en voz alta: nunca repite", () => {
    const g = crearGeneradorDeUnicos(carpeta());
    for (let i = 0; i < VALORES_POR_PUESTO; i++) g.siguiente();
    expect(() => g.siguiente()).toThrow(/pidió más de/);
  });

  it("una corrida que agota los puestos FALLA en voz alta", () => {
    const reserva = carpeta();
    for (let i = 0; i < PUESTOS; i++) reservarPuesto(reserva);
    expect(() => reservarPuesto(reserva)).toThrow(/se agotaron/);
  });

  it("un error de la carpeta que no es «ya existe» se propaga (no se disfraza de puesto ocupado)", () => {
    expect(() => reservarPuesto(join(carpeta(), "no-existe", "tampoco"))).toThrow(/ENOENT/);
  });

  it("los rangos de dos puestos distintos no se tocan: el último valor de uno es menor que el primero del siguiente", () => {
    const reserva = carpeta();
    const a = crearGeneradorDeUnicos(reserva);
    const b = crearGeneradorDeUnicos(reserva);
    expect(a.siguiente()).toBe(a.puesto * VALORES_POR_PUESTO);
    expect(b.siguiente()).toBe(b.puesto * VALORES_POR_PUESTO);
    expect(PUESTOS * VALORES_POR_PUESTO).toBe(100_000_000);
  });
});

describe("referencia de error única", () => {
  it("tiene la forma de la restricción de la base y no se repite", () => {
    const g = crearGeneradorDeUnicos(carpeta());
    const vistos = new Set<string>();
    for (let i = 0; i < 1000; i++) {
      const r = g.referenciaDeError();
      expect(r).toMatch(/^PD-[0-9A-F]{4}-[0-9A-F]{4}$/);
      vistos.add(r);
    }
    expect(vistos.size).toBe(1000);
  });
});
