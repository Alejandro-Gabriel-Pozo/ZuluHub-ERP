import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as Cabeceras from "./cabeceras";

/**
 * El dueño del host (marca o empresa) llega a las cabeceras tal cual lo resolvió la puerta, y sin host resuelto llega `null` (se cierra). Hoy la tabla de la carta está cerrada y
 * por eso ninguna respuesta lo delata: se mira lo que `decidirPuerta` le pasa a `cabecerasDe`.
 */
const llamadas = vi.hoisted(() => ({ opciones: [] as unknown[] }));
vi.mock("./cabeceras", async (importar) => {
  const real = await importar<typeof Cabeceras>();
  return {
    ...real,
    cabecerasDe: (...args: Parameters<typeof Cabeceras.cabecerasDe>) => {
      llamadas.opciones.push(args[2]);
      return real.cabecerasDe(...args);
    },
  };
});

import { nonceDe } from "./cabeceras";
import { decidirPuerta, type EstadoDeLaResolucion } from "./puerta";

const NONCE = nonceDe(new Uint8Array(16).fill(7));

const resuelta = (tipo: "MARCA" | "EMPRESA"): EstadoDeLaResolucion => ({
  tipo: "RESUELTA",
  puerta: {
    host: "x.test",
    superficie: "CARTA",
    marcaId: "m1",
    duenio: tipo === "MARCA" ? { tipo } : { tipo, empresaId: "e1" },
    marca: { nombre: "Marca", tema: {}, hostDeApp: null },
  } as never,
});

const decidir = (resolucion: EstadoDeLaResolucion, produccion: boolean) =>
  decidirPuerta({
    encabezados: new Headers(),
    ruta: "/q7H2xk9Pq7H2xk9Pq7H2xk",
    resolucion,
    produccion,
    nonce: NONCE,
  });

beforeEach(() => {
  llamadas.opciones = [];
});

describe("decidirPuerta: el dueño del host llega a las cabeceras", () => {
  it.each(["MARCA", "EMPRESA"] as const)("host de %s: se pasa ese tipo y la producción", (tipo) => {
    decidir(resuelta(tipo), true);
    expect(llamadas.opciones).toEqual([{ produccion: true, duenio: tipo }]);
  });

  it("la producción se pasa tal cual (no se fija)", () => {
    decidir(resuelta("MARCA"), false);
    expect(llamadas.opciones).toEqual([{ produccion: false, duenio: "MARCA" }]);
  });

  it("sin host resuelto: dueño `null` (nunca `undefined`, que no se distingue de «falta»)", () => {
    decidir({ tipo: "DESCONOCIDO" } as never, true);
    expect(llamadas.opciones).toHaveLength(1);
    expect((llamadas.opciones[0] as { duenio: unknown }).duenio).toBeNull();
  });
});
