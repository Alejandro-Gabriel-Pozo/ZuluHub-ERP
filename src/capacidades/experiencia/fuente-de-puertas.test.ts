import { describe, expect, it } from "vitest";
import { err, ok } from "../../primitivas/resultado/resultado";
import type {
  ConfiguracionPublicaDeHost,
  ConfiguracionPublicaDeMarca,
  HostResuelto,
  ResolucionDeHost,
} from "../../puertos/marcas";
import { armarFuenteDePuertas } from "./fuente-de-puertas";

const ERROR_DE_BASE = {
  tipo: "Inesperado",
  sqlstate: null,
  mensaje: "detalle secreto de la base",
} as const;
const resuelto = {
  host: "app.a.test",
  superficie: "APP",
  duenio: { tipo: "EMPRESA", empresaId: "empresa-secreta" },
  marcaId: "marca-a",
} as unknown as HostResuelto;
const configuracion: ConfiguracionPublicaDeMarca = {
  marcaId: "marca-a" as ConfiguracionPublicaDeMarca["marcaId"],
  nombre: "Marca A",
  tema: { primary: "#112233", fondo: "#000000" } as ConfiguracionPublicaDeMarca["tema"],
  aspecto: {
    estilo: "CLARO_CON_BORDES",
    superficie: "NEUTRA",
    esquinas: "SUAVE",
    titulos: "SANS",
    ingreso: "CENTRADO",
  },
  hostCanonico: "app.a.test",
};

function armar(
  porHostResolucion: ResolucionDeHost["porHost"],
  porHostConfiguracion: ConfiguracionPublicaDeHost["porHost"],
) {
  const pedidos: string[] = [];
  const fuente = armarFuenteDePuertas({
    resolucion: () => ({
      porHost: (h, s) => {
        pedidos.push(`resolucion|${h}|${s}`);
        return porHostResolucion(h, s);
      },
    }),
    configuracion: () => ({
      porHost: (h, s) => {
        pedidos.push(`configuracion|${h}|${s}`);
        return porHostConfiguracion(h, s);
      },
    }),
  });
  return { fuente, pedidos };
}

describe("armarFuenteDePuertas.consultarHost", () => {
  it("pasa host y superficie al puerto y devuelve SOLO el marcaId (nada del dueño ni de la empresa)", async () => {
    const { fuente, pedidos } = armar(
      () => Promise.resolve(ok(resuelto)),
      () => Promise.resolve(ok(null)),
    );
    const r = await fuente.consultarHost("app.a.test", "APP");
    expect(r).toEqual({ ok: true, valor: { marcaId: "marca-a" } });
    expect(JSON.stringify(r)).not.toContain("empresa-secreta");
    expect(pedidos).toEqual(["resolucion|app.a.test|APP"]);
  });

  it("el host que no se sirve es ok(null), sin leer la marca", async () => {
    const { fuente, pedidos } = armar(
      () => Promise.resolve(ok(null)),
      () => Promise.resolve(ok(configuracion)),
    );
    expect(await fuente.consultarHost("x.test", "CARTA")).toEqual({ ok: true, valor: null });
    expect(pedidos).toEqual(["resolucion|x.test|CARTA"]);
  });

  it("un error de la base vuelve como error, no como null", async () => {
    const { fuente } = armar(
      () => Promise.resolve(err(ERROR_DE_BASE)),
      () => Promise.resolve(ok(null)),
    );
    const r = await fuente.consultarHost("app.a.test", "APP");
    expect(r.ok).toBe(false);
  });

  it("si pedir el puerto lanza (entorno sin configurar), la consulta es un rechazo, no un null", async () => {
    const fuente = armarFuenteDePuertas({
      resolucion: () => {
        throw new Error("falta la variable");
      },
      configuracion: () => {
        throw new Error("falta la variable");
      },
    });
    await expect(fuente.consultarHost("app.a.test", "APP")).rejects.toThrow("falta la variable");
    await expect(fuente.leerMarca("m", "app.a.test", "APP")).rejects.toThrow("falta la variable");
  });
});

describe("armarFuenteDePuertas.leerMarca", () => {
  it("lee la configuración POR HOST y superficie y la traduce a la marca pública", async () => {
    const { fuente, pedidos } = armar(
      () => Promise.resolve(ok(null)),
      () => Promise.resolve(ok(configuracion)),
    );
    expect(await fuente.leerMarca("marca-a", "app.a.test", "APP")).toEqual({
      nombre: "Marca A",
      tema: { primary: "#112233" },
      hostDeApp: "app.a.test",
    });
    expect(pedidos).toEqual(["configuracion|app.a.test|APP"]);
  });

  it("sin configuración servible (neutral) es null", async () => {
    const { fuente } = armar(
      () => Promise.resolve(ok(null)),
      () => Promise.resolve(ok(null)),
    );
    expect(await fuente.leerMarca("marca-a", "app.a.test", "APP")).toBeNull();
  });

  it("una configuración con nombre vacío es null", async () => {
    const { fuente } = armar(
      () => Promise.resolve(ok(null)),
      () => Promise.resolve(ok({ ...configuracion, nombre: " " })),
    );
    expect(await fuente.leerMarca("marca-a", "app.a.test", "APP")).toBeNull();
  });

  it("un error de la base LANZA, con un mensaje sin ningún detalle", async () => {
    const { fuente } = armar(
      () => Promise.resolve(ok(null)),
      () => Promise.resolve(err(ERROR_DE_BASE)),
    );
    const error = await fuente.leerMarca("marca-a", "app.a.test", "APP").catch((e: unknown) => e);
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toBe("no se pudo leer la configuración pública de la marca");
    expect((error as Error).message).not.toContain("secreto");
  });
});
