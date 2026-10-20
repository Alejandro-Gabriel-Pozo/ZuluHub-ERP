import { describe, expect, it } from "vitest";
import type {
  ConfiguracionPublica,
  HostServible,
  LecturaPublicaDeMarcas,
} from "../../modulos/marcas/publico";
import { err, ok } from "../../primitivas/resultado/resultado";
import { marcaComercialId } from "../../primitivas/identificadores/marca";
import type { TransaccionesPublicas } from "../../puertos/transacciones-publicas";
import { crearConfiguracionPublicaDeHost } from "./configuracion-publica-de-marca";
import type { TxPublica } from "./resolucion-de-host";

/**
 * El adaptador de la configuración pública sin base: lo que decide ANTES de tocarla (normalizar el host,
 * validar la superficie) y lo que deja salir. La consulta real, contra el rol público, está en
 * `test/integracion/configuracion-publica-de-marca.test.ts`.
 */

const configuracion: ConfiguracionPublica = {
  marcaId: marcaComercialId("marca-del-host"),
  nombre: "Mi Calendario",
  tema: { primary: "#112233" },
  aspecto: {
    estilo: "MODERNO",
    superficie: "CALIDA",
    esquinas: "REDONDEADA",
    titulos: "SERIF",
    ingreso: "CON_IMAGEN",
  },
  hostCanonico: "app.micalendario.test" as ConfiguracionPublica["hostCanonico"],
};

function conLectura(respuesta: ConfiguracionPublica | null) {
  const pedidos: [string, string][] = [];
  let transacciones = 0;
  const marcas: LecturaPublicaDeMarcas = {
    resolverHost: () => Promise.resolve(null as HostServible | null),
    configuracionDeHost(host, superficie) {
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
  return {
    puerto: crearConfiguracionPublicaDeHost(tx),
    pedidos,
    transacciones: () => transacciones,
  };
}

describe("crearConfiguracionPublicaDeHost", () => {
  it("pide a la lectura el host NORMALIZADO y la superficie, y devuelve marcaId, nombre, tema, aspecto y host canónico", async () => {
    const { puerto, pedidos } = conLectura(configuracion);
    expect(await puerto.porHost("APP.Marca.TEST:443", "LANDING")).toEqual(
      ok({
        marcaId: "marca-del-host",
        nombre: "Mi Calendario",
        tema: { primary: "#112233" },
        aspecto: {
          estilo: "MODERNO",
          superficie: "CALIDA",
          esquinas: "REDONDEADA",
          titulos: "SERIF",
          ingreso: "CON_IMAGEN",
        },
        hostCanonico: "app.micalendario.test",
      }),
    );
    expect(pedidos).toEqual([["app.marca.test", "LANDING"]]);
  });

  it("solo deja salir marcaId, nombre, tema, aspecto y hostCanonico: un campo de más de la lectura no sale por la puerta", async () => {
    const conDeMas = {
      ...configuracion,
      empresaId: "e1",
      tenantId: "t1",
    } as unknown as ConfiguracionPublica;
    const { puerto } = conLectura(conDeMas);
    const r = await puerto.porHost("app.marca.test", "APP");
    expect(r.ok && r.valor !== null && Object.keys(r.valor).sort()).toEqual([
      "aspecto",
      "hostCanonico",
      "marcaId",
      "nombre",
      "tema",
    ]);
  });

  it("un host sin configuración es ok(null)", async () => {
    const { puerto } = conLectura(null);
    expect(await puerto.porHost("app.marca.test", "CARTA")).toEqual(ok(null));
  });

  it.each(["", "127.0.0.1", "[::1]", "a b", "ñandú.test", "x".repeat(300), "app.marca.test/x"])(
    "el host %j no normaliza: ok(null) sin abrir una transacción",
    async (host) => {
      const { puerto, transacciones } = conLectura(configuracion);
      expect(await puerto.porHost(host, "APP")).toEqual(ok(null));
      expect(transacciones()).toBe(0);
    },
  );

  it("una superficie que no es de la lista tampoco sirve nada ni toca la base", async () => {
    const { puerto, transacciones } = conLectura(configuracion);
    expect(await puerto.porHost("app.marca.test", "OTRA" as "APP")).toEqual(ok(null));
    expect(transacciones()).toBe(0);
  });

  it.each(["APP", "CARTA", "LANDING", "CONSOLA"] as const)("acepta la superficie %s", async (s) => {
    const { puerto, pedidos } = conLectura(null);
    await puerto.porHost("app.marca.test", s);
    expect(pedidos).toEqual([["app.marca.test", s]]);
  });

  it("un error de la base vuelve como err, no como neutral", async () => {
    const roto: TransaccionesPublicas<TxPublica> = {
      leer: () => Promise.resolve(err({ tipo: "AccesoDenegado" as const })),
    };
    expect(await crearConfiguracionPublicaDeHost(roto).porHost("app.marca.test", "APP")).toEqual(
      err({ tipo: "AccesoDenegado" }),
    );
  });
});
