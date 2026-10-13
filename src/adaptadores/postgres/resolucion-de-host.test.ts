import { describe, expect, it } from "vitest";
import type { HostServible, LecturaPublicaDeMarcas } from "../../modulos/marcas/publico";
import { marcaComercialId } from "../../primitivas/identificadores/marca";
import { err, ok } from "../../primitivas/resultado/resultado";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import { crearResolucionDeHost, type TxPublica } from "./resolucion-de-host";

/**
 * El adaptador de resolución sin base: lo que decide ANTES de tocarla (normalizar el host, validar la
 * superficie) y que pasa tal cual lo que la lectura devuelve. La consulta real, contra el rol público,
 * está en `test/integracion/resolucion-de-host.test.ts`.
 */

const servible: HostServible = {
  host: "app.marca.test" as HostServible["host"],
  superficie: "APP",
  duenio: { tipo: "MARCA", marcaId: marcaComercialId("m1") },
  marcaId: marcaComercialId("m1"),
};

function conLectura(respuesta: HostServible | null) {
  const pedidos: [string, string][] = [];
  let transacciones = 0;
  const marcas: LecturaPublicaDeMarcas = {
    resolverHost(host, superficie) {
      pedidos.push([host, superficie]);
      return Promise.resolve(respuesta);
    },
  };
  const tx: TransaccionesPublicas<TxPublica> = {
    leer(trabajo) {
      transacciones += 1;
      return trabajo({ marcas }).then((valor) => ok(valor));
    },
  };
  return { resolucion: crearResolucionDeHost(tx), pedidos, transacciones: () => transacciones };
}

describe("crearResolucionDeHost", () => {
  it("pide a la lectura el host NORMALIZADO y la superficie, y devuelve lo que ella devuelve", async () => {
    const { resolucion, pedidos } = conLectura(servible);
    expect(await resolucion.porHost("APP.Marca.TEST:443", "APP")).toEqual(ok(servible));
    expect(pedidos).toEqual([["app.marca.test", "APP"]]);
  });

  it("un host que la lectura no encuentra es ok(null)", async () => {
    const { resolucion } = conLectura(null);
    expect(await resolucion.porHost("app.marca.test", "CARTA")).toEqual(ok(null));
  });

  it.each(["", "127.0.0.1", "[::1]", "a b", "ñandú.test", "x".repeat(300), "app.marca.test/x"])(
    "el host %j no normaliza: ok(null) sin abrir una transacción",
    async (host) => {
      const { resolucion, transacciones } = conLectura(servible);
      expect(await resolucion.porHost(host, "APP")).toEqual(ok(null));
      expect(transacciones()).toBe(0);
    },
  );

  it("una superficie que no es de la lista tampoco sirve nada ni toca la base", async () => {
    const { resolucion, transacciones } = conLectura(servible);
    expect(await resolucion.porHost("app.marca.test", "OTRA" as "APP")).toEqual(ok(null));
    expect(transacciones()).toBe(0);
  });

  it.each(["APP", "CARTA", "LANDING", "CONSOLA"] as const)("acepta la superficie %s", async (s) => {
    const { resolucion, pedidos } = conLectura(null);
    await resolucion.porHost("app.marca.test", s);
    expect(pedidos).toEqual([["app.marca.test", s]]);
  });

  it("un error de la base vuelve como err, no como neutral", async () => {
    const roto: TransaccionesPublicas<TxPublica> = {
      leer: () => Promise.resolve(err({ tipo: "AccesoDenegado" as const })),
    };
    expect(await crearResolucionDeHost(roto).porHost("app.marca.test", "APP")).toEqual(
      err({ tipo: "AccesoDenegado" }),
    );
  });
});
