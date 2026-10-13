import { randomBytes } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { armarConexiones, type Conexiones } from "./conexiones";
import {
  ErrorDeEntorno,
  NOMBRES_DE_ENTORNO,
  VARIABLES_PROHIBIDAS,
  type FuenteDeEntorno,
} from "./entorno";
import { armarTrabajos } from "./trabajos";
import { armarWeb } from "./web";

/**
 * P-12 y P-13 sobre la composición real: no lee variables al importarse ni al armarse; en ejecución,
 * una variable que falta o sobra responde fallo cerrado y el NOMBRE va solo al registro. Los valores
 * de acá se inventan en cada corrida (aleatorios o de relleno): ninguno es un valor de verdad. Nada
 * abre una conexión: los pools de la base se crean con la primera consulta.
 */

const valida = (): Record<string, string> => ({
  ZULUHUB_CLAVE_CONTEXTO: `1:${randomBytes(32).toString("hex")}`,
  ZULUHUB_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
  ZULUHUB_RESEND_API_KEY: "clave-de-relleno",
  ZULUHUB_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
  ZULUHUB_NOMBRE_DE_MARCA: "Marca de relleno",
  ZULUHUB_URL_BASE: "https://app.ejemplo.test",
  ZULUHUB_DB_APP: "postgres://usuario:relleno@127.0.0.1:1/base",
  ZULUHUB_DB_TRABAJOS: "postgres://usuario:relleno@127.0.0.1:1/base",
});

const conFuente = (fuente: FuenteDeEntorno) => {
  const registrados: string[] = [];
  const conexiones = armarConexiones({
    fuente: () => fuente,
    registrar: (detalle) => registrados.push(detalle),
  });
  return { conexiones, registrados };
};

/** Cada forma de pedir una pieza a la composición, con las variables que tiene que nombrar. */
const PEDIDOS: { nombre: string; pedir: (c: Conexiones) => unknown; nombra: string }[] = [
  { nombre: "transaccionesDeApp", pedir: (c) => c.transaccionesDeApp(), nombra: "ZULUHUB_DB_APP" },
  {
    nombre: "transaccionesDeTrabajos",
    pedir: (c) => c.transaccionesDeTrabajos(),
    nombra: "ZULUHUB_DB_TRABAJOS",
  },
  { nombre: "tokens", pedir: (c) => c.tokens(), nombra: "ZULUHUB_SECRETO_INVITACIONES" },
  { nombre: "correo", pedir: (c) => c.correo(), nombra: "ZULUHUB_RESEND_API_KEY" },
  {
    nombre: "configuracionDeCorreo",
    pedir: (c) => c.configuracionDeCorreo(),
    nombra: "ZULUHUB_URL_BASE",
  },
  {
    nombre: "web.casosDeUsoDeEmpresas",
    pedir: (c) => armarWeb(c).casosDeUsoDeEmpresas(),
    nombra: "ZULUHUB_DB_APP",
  },
  {
    nombre: "web.consultasDeEmpresas",
    pedir: (c) => armarWeb(c).consultasDeEmpresas(),
    nombra: "ZULUHUB_DB_APP",
  },
  {
    nombre: "web.casosDeUsoDeIdentidad",
    pedir: (c) => armarWeb(c).casosDeUsoDeIdentidad(),
    nombra: "ZULUHUB_DB_APP",
  },
  {
    nombre: "web.consultasDeIdentidad",
    pedir: (c) => armarWeb(c).consultasDeIdentidad(),
    nombra: "ZULUHUB_DB_APP",
  },
  {
    nombre: "web.consultasDeSesion",
    pedir: (c) => armarWeb(c).consultasDeSesion(),
    nombra: "ZULUHUB_DB_APP",
  },
  {
    nombre: "trabajos.procesador",
    pedir: (c) => armarTrabajos(c).procesador(),
    nombra: "ZULUHUB_URL_BASE",
  },
];

/**
 * Las variables del producto: las de la lista, las prohibidas y la familia `POSTGRES_*`. Las que lee
 * la propia herramienta de pruebas (`ZULUHUB_SIN_INTEGRACION`, `ZULUHUB_FILTRO_PRUEBAS`) no cuentan.
 */
const NOMBRES_DEL_PRODUCTO = new Set<string>([
  ...NOMBRES_DE_ENTORNO.map((e) => e.nombre as string),
  ...VARIABLES_PROHIBIDAS,
]);
const esDelProducto = (clave: string | symbol): clave is string =>
  typeof clave === "string" && (NOMBRES_DEL_PRODUCTO.has(clave) || clave.startsWith("POSTGRES_"));

describe("P-12: la composición no lee variables al importarse ni al armarse", () => {
  const original = process.env;
  afterEach(() => {
    process.env = original;
    vi.resetModules();
  });

  it("importar los módulos, armar las conexiones, la web y los trabajos no toca ninguna variable", async () => {
    const leidas: string[] = [];
    process.env = new Proxy(
      { ...original },
      {
        get(destino, clave, receptor) {
          if (esDelProducto(clave)) leidas.push(clave);
          return Reflect.get(destino, clave, receptor) as unknown;
        },
        ownKeys(destino) {
          leidas.push("<se listaron las variables>");
          return Reflect.ownKeys(destino);
        },
      },
    );
    vi.resetModules();
    const { armarConexiones: armar } = await import("./conexiones");
    const { armarWeb: web } = await import("./web");
    const { armarTrabajos: trabajos } = await import("./trabajos");
    await import("./entorno");
    await import("./contextos");
    const conexiones = armar();
    web(conexiones);
    trabajos(conexiones);
    expect(leidas).toEqual([]);
  });

  it("recién al pedir una pieza se lee el entorno", () => {
    const leidas: string[] = [];
    process.env = new Proxy(
      { ...original },
      {
        get(destino, clave, receptor) {
          if (esDelProducto(clave)) leidas.push(clave);
          return Reflect.get(destino, clave, receptor) as unknown;
        },
      },
    );
    const conexiones = armarConexiones();
    expect(leidas).toEqual([]);
    expect(() => conexiones.tokens()).toThrow(ErrorDeEntorno);
    expect(leidas).toEqual(["ZULUHUB_SECRETO_INVITACIONES"]);
  });
});

describe("P-12: en ejecución, una variable faltante falla cerrado y el nombre va solo al registro", () => {
  it.each(PEDIDOS)("$nombre con el entorno vacío", ({ pedir, nombra }) => {
    const { conexiones, registrados } = conFuente({});
    let error: unknown;
    try {
      pedir(conexiones);
    } catch (e) {
      error = e;
    }
    expect(error).toBeInstanceOf(ErrorDeEntorno);
    const e = error as ErrorDeEntorno;
    // A la respuesta no puede llegar ningún nombre: el mensaje es genérico.
    for (const texto of [e.message, String(e.stack).split("\n")[0] ?? "", JSON.stringify(e)]) {
      expect(texto).not.toMatch(/ZULUHUB|DATABASE|POSTGRES|BETTER_AUTH/);
    }
    // Al registro del servidor sí va, y es lo mismo que guarda el error.
    expect(registrados).toEqual([e.detalleParaElRegistro()]);
    expect(registrados[0]).toContain(nombra);
  });

  it("cada intento fallido se vuelve a registrar y no se memoriza el fallo", () => {
    let fuente: FuenteDeEntorno = {};
    const registrados: string[] = [];
    const conexiones = armarConexiones({
      fuente: () => fuente,
      registrar: (d) => registrados.push(d),
    });
    expect(() => conexiones.tokens()).toThrow(ErrorDeEntorno);
    expect(() => conexiones.tokens()).toThrow(ErrorDeEntorno);
    expect(registrados).toHaveLength(2);
    fuente = valida();
    expect(conexiones.tokens()).toBeDefined();
    expect(registrados).toHaveLength(2);
  });

  it("una variable que falta en un solo lugar solo rompe a las piezas que la usan", () => {
    const sinTrabajos: Record<string, string> = valida();
    delete sinTrabajos["ZULUHUB_DB_TRABAJOS"];
    const { conexiones, registrados } = conFuente(sinTrabajos);
    expect(conexiones.transaccionesDeApp()).toBeDefined();
    expect(conexiones.tokens()).toBeDefined();
    expect(conexiones.correo()).toBeDefined();
    expect(() => conexiones.transaccionesDeTrabajos()).toThrow(ErrorDeEntorno);
    expect(registrados).toEqual(["pieza transacciones-trabajos: ZULUHUB_DB_TRABAJOS falta"]);
  });

  it.each([
    ["ZULUHUB_CLAVE_CONTEXTO", "1:no-es-hexadecimal", (c: Conexiones) => c.transaccionesDeApp()],
    ["ZULUHUB_SECRETO_INVITACIONES", "corto", (c: Conexiones) => c.tokens()],
    [
      "ZULUHUB_URL_BASE",
      "http://publico.ejemplo.test",
      (c: Conexiones) => c.configuracionDeCorreo(),
    ],
  ])(
    "el formato fino lo valida el adaptador, y su error también sale genérico (%s)",
    (nombre, malo, pedir) => {
      const { conexiones, registrados } = conFuente({ ...valida(), [nombre]: malo });
      let error: unknown;
      try {
        pedir(conexiones);
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorDeEntorno);
      expect((error as ErrorDeEntorno).message).not.toContain("ZULUHUB");
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toContain(nombre);
      expect(registrados[0]).not.toContain(malo);
    },
  );
});

describe("P-13: con una variable prohibida presente no se arma nada", () => {
  it.each([...VARIABLES_PROHIBIDAS, "POSTGRES_URL", "POSTGRES_PASSWORD"])(
    "con %s presente ninguna pieza se arma, aunque el resto esté bien",
    (prohibida) => {
      const { conexiones, registrados } = conFuente({ ...valida(), [prohibida]: "relleno" });
      for (const { pedir } of PEDIDOS) {
        expect(() => pedir(conexiones)).toThrow(ErrorDeEntorno);
      }
      expect(registrados).toHaveLength(PEDIDOS.length);
      for (const detalle of registrados) {
        expect(detalle).toBe(`variables prohibidas presentes: ${prohibida}`);
      }
    },
  );
});

describe("con el entorno completo", () => {
  it("arma cada pieza, y pedirla dos veces (también a la vez) da la misma instancia", async () => {
    const { conexiones, registrados } = conFuente(valida());
    const pedidos = await Promise.all([
      Promise.resolve().then(() => conexiones.transaccionesDeApp()),
      Promise.resolve().then(() => conexiones.transaccionesDeApp()),
      Promise.resolve().then(() => conexiones.transaccionesDeApp()),
    ]);
    expect(pedidos[1]).toBe(pedidos[0]);
    expect(pedidos[2]).toBe(pedidos[0]);
    expect(conexiones.transaccionesDeTrabajos()).toBe(conexiones.transaccionesDeTrabajos());
    expect(conexiones.tokens()).toBe(conexiones.tokens());
    expect(conexiones.correo()).toBe(conexiones.correo());
    expect(conexiones.configuracionDeCorreo()).toBe(conexiones.configuracionDeCorreo());
    expect(conexiones.configuracionDeCorreo()).toMatchObject({
      urlBase: "https://app.ejemplo.test",
      nombreDeMarca: "Marca de relleno",
    });
    expect(registrados).toEqual([]);
    await pedidos[0]?.cerrar();
  });

  it("las transacciones de la aplicación y las de los trabajos son instancias distintas", () => {
    const { conexiones } = conFuente(valida());
    expect(conexiones.transaccionesDeApp()).not.toBe(conexiones.transaccionesDeTrabajos());
  });

  it("la web ofrece los casos de uso y las consultas de empresas e identidad, una sola vez cada uno", () => {
    const { conexiones } = conFuente(valida());
    const web = armarWeb(conexiones);
    expect(Object.keys(web.casosDeUsoDeEmpresas()).sort()).toEqual([
      "crearSucursal",
      "desactivarSucursal",
      "editarSucursal",
      "reactivarSucursal",
    ]);
    expect(Object.keys(web.consultasDeEmpresas()).sort()).toEqual([
      "fichaDeSucursal",
      "listarSucursales",
    ]);
    expect(Object.keys(web.casosDeUsoDeIdentidad())).toEqual(
      expect.arrayContaining(["invitarUsuario", "aceptarInvitacion", "revocarInvitacion"]),
    );
    expect(Object.keys(web.consultasDeIdentidad()).length).toBeGreaterThan(0);
    expect(web.casosDeUsoDeEmpresas()).toBe(web.casosDeUsoDeEmpresas());
    expect(web.consultasDeIdentidad()).toBe(web.consultasDeIdentidad());
  });

  it("los trabajos arman el procesador una sola vez", () => {
    const { conexiones } = conFuente(valida());
    const trabajos = armarTrabajos(conexiones);
    const procesador = trabajos.procesador();
    expect(typeof procesador.procesarPendientes).toBe("function");
    expect(trabajos.procesador()).toBe(procesador);
  });

  it("la composición no abrió ninguna conexión: cerrar no tiene nada que cerrar", async () => {
    const { conexiones } = conFuente(valida());
    armarWeb(conexiones).casosDeUsoDeIdentidad();
    await expect(conexiones.transaccionesDeApp().cerrar()).resolves.toBeUndefined();
  });
});
