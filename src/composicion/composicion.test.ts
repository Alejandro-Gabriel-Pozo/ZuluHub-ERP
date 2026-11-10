import {
  DECLARACIONES_DE_CATALOGO,
  DECLARACIONES_DE_CONSULTAS_DE_CATALOGO,
} from "../modulos/catalogo/publico";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DECLARACIONES_DE_CAJA, DECLARACIONES_DE_CONSULTAS_DE_CAJA } from "../modulos/caja/publico";
import {
  DECLARACIONES_DE_VENTAS,
  DECLARACIONES_DE_CONSULTAS_DE_VENTAS,
} from "../modulos/ventas/publico";
import {
  DECLARACIONES_DE_CIERRE,
  DECLARACIONES_DE_CONSULTAS_DE_CIERRE,
} from "../modulos/cierre/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS,
  DECLARACIONES_DE_EMPRESAS,
} from "../modulos/empresas/publico";
import { REGLAS_DE_REPETICION } from "../capacidades/permisos/declaracion";
import {
  DECLARACIONES_DE_CERTIFICADOS,
  DECLARACIONES_DE_CONFIGURACION_FISCAL,
  DECLARACIONES_DE_CONSULTAS_DE_FISCAL,
  DECLARACIONES_DE_FACTURACION,
  DECLARACIONES_DE_FISCAL,
} from "../modulos/fiscal/publico";
import {
  DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD,
  DECLARACIONES_DE_IDENTIDAD,
} from "../modulos/identidad/publico";
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
  PEDERNAL_CLAVE_CONTEXTO: `1:${randomBytes(32).toString("hex")}`,
  PEDERNAL_SECRETO_INVITACIONES: randomBytes(32).toString("hex"),
  PEDERNAL_CLAVE_CERTIFICADOS: `k1:${randomBytes(32).toString("hex")}`,
  PEDERNAL_RESEND_API_KEY: "clave-de-relleno",
  PEDERNAL_CORREO_REMITENTE: "Prueba <prueba@ejemplo.test>",
  PEDERNAL_NOMBRE_DE_MARCA: "Marca de relleno",
  PEDERNAL_URL_BASE: "https://app.ejemplo.test",
  PEDERNAL_DB_APP: "postgres://usuario:relleno@127.0.0.1:1/base",
  PEDERNAL_DB_TRABAJOS: "postgres://usuario:relleno@127.0.0.1:1/base",
  PEDERNAL_DB_PUBLICO: "postgres://usuario:relleno@127.0.0.1:1/base",
  PEDERNAL_DB_AUTENTICACION: "postgres://usuario:relleno@127.0.0.1:1/base",
  PEDERNAL_AUTH_SECRETO_EMPRESA: randomBytes(32).toString("hex"),
  GOOGLE_CLIENT_ID: "cliente-de-relleno",
  GOOGLE_CLIENT_SECRET: "secreto-de-relleno",
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
  { nombre: "transaccionesDeApp", pedir: (c) => c.transaccionesDeApp(), nombra: "PEDERNAL_DB_APP" },
  {
    nombre: "transaccionesDeTrabajos",
    pedir: (c) => c.transaccionesDeTrabajos(),
    nombra: "PEDERNAL_DB_TRABAJOS",
  },
  {
    nombre: "transaccionesPublicas",
    pedir: (c) => c.transaccionesPublicas(),
    nombra: "PEDERNAL_DB_PUBLICO",
  },
  { nombre: "resolucionDeHost", pedir: (c) => c.resolucionDeHost(), nombra: "PEDERNAL_DB_PUBLICO" },
  {
    nombre: "web.resolucionDeHost",
    pedir: (c) => armarWeb(c).resolucionDeHost(),
    nombra: "PEDERNAL_DB_PUBLICO",
  },
  {
    nombre: "configuracionPublicaDeHost",
    pedir: (c) => c.configuracionPublicaDeHost(),
    nombra: "PEDERNAL_DB_PUBLICO",
  },
  {
    nombre: "web.configuracionPublicaDeHost",
    pedir: (c) => armarWeb(c).configuracionPublicaDeHost(),
    nombra: "PEDERNAL_DB_PUBLICO",
  },
  {
    nombre: "autenticacion",
    pedir: (c) => c.autenticacion(),
    nombra: "PEDERNAL_AUTH_SECRETO_EMPRESA",
  },
  {
    nombre: "barridoDeAutenticacion",
    pedir: (c) => c.barridoDeAutenticacion(),
    nombra: "PEDERNAL_DB_AUTENTICACION",
  },
  {
    nombre: "revocacionDeSesiones",
    pedir: (c) => c.revocacionDeSesiones(),
    nombra: "PEDERNAL_DB_AUTENTICACION",
  },
  {
    nombre: "web.autenticacion",
    pedir: (c) => armarWeb(c).autenticacion(),
    nombra: "GOOGLE_CLIENT_SECRET",
  },
  { nombre: "tokens", pedir: (c) => c.tokens(), nombra: "PEDERNAL_SECRETO_INVITACIONES" },
  {
    nombre: "cifradorDeCertificados",
    pedir: (c) => c.cifradorDeCertificados(),
    nombra: "PEDERNAL_CLAVE_CERTIFICADOS",
  },
  { nombre: "correo", pedir: (c) => c.correo(), nombra: "PEDERNAL_RESEND_API_KEY" },
  {
    nombre: "configuracionDeCorreo",
    pedir: (c) => c.configuracionDeCorreo(),
    nombra: "PEDERNAL_URL_BASE",
  },
  {
    nombre: "web.casosDeUsoDeEmpresas",
    pedir: (c) => armarWeb(c).casosDeUsoDeEmpresas(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.consultasDeEmpresas",
    pedir: (c) => armarWeb(c).consultasDeEmpresas(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.casosDeUsoDeIdentidad",
    pedir: (c) => armarWeb(c).casosDeUsoDeIdentidad(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.consultasDeIdentidad",
    pedir: (c) => armarWeb(c).consultasDeIdentidad(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.casosDeUsoDeFacturacion",
    pedir: (c) => armarWeb(c).casosDeUsoDeFacturacion(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.casosDeUsoDeCertificados",
    pedir: (c) => armarWeb(c).casosDeUsoDeCertificados(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.consultasDeFacturacion",
    pedir: (c) => armarWeb(c).consultasDeFacturacion(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "web.consultasDeSesion",
    pedir: (c) => armarWeb(c).consultasDeSesion(),
    nombra: "PEDERNAL_DB_APP",
  },
  {
    nombre: "trabajos.procesador",
    pedir: (c) => armarTrabajos(c).procesador(),
    nombra: "PEDERNAL_DB_TRABAJOS",
  },
];

/**
 * Las variables del producto: las de la lista, las prohibidas y la familia `POSTGRES_*`. Las que lee
 * la propia herramienta de pruebas (`PEDERNAL_SIN_INTEGRACION`, `PEDERNAL_FILTRO_PRUEBAS`) no cuentan.
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
    expect(leidas).toEqual(["PEDERNAL_SECRETO_INVITACIONES"]);
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
      expect(texto).not.toMatch(/PEDERNAL|DATABASE|POSTGRES|BETTER_AUTH/);
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
    delete sinTrabajos["PEDERNAL_DB_TRABAJOS"];
    const { conexiones, registrados } = conFuente(sinTrabajos);
    expect(conexiones.transaccionesDeApp()).toBeDefined();
    expect(conexiones.tokens()).toBeDefined();
    expect(conexiones.correo()).toBeDefined();
    expect(() => conexiones.transaccionesDeTrabajos()).toThrow(ErrorDeEntorno);
    expect(registrados).toEqual(["pieza transacciones-trabajos: PEDERNAL_DB_TRABAJOS falta"]);
  });

  it.each([
    ["PEDERNAL_CLAVE_CONTEXTO", "1:no-es-hexadecimal", (c: Conexiones) => c.transaccionesDeApp()],
    ["PEDERNAL_SECRETO_INVITACIONES", "corto", (c: Conexiones) => c.tokens()],
    [
      "PEDERNAL_URL_BASE",
      "http://publico.ejemplo.test",
      (c: Conexiones) => c.configuracionDeCorreo(),
    ],
    ["PEDERNAL_AUTH_SECRETO_EMPRESA", "corto", (c: Conexiones) => c.autenticacion()],
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
      expect((error as ErrorDeEntorno).message).not.toContain("PEDERNAL");
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

  it("sin la clave de los certificados, la web de facturación y el procesador de la cola se arman igual: la pide recién quien habla con ARCA", () => {
    const sinClave: Record<string, string> = valida();
    delete sinClave["PEDERNAL_CLAVE_CERTIFICADOS"];
    const { conexiones, registrados } = conFuente(sinClave);
    const web = armarWeb(conexiones);
    expect(web.casosDeUsoDeFacturacion()).toBeDefined();
    expect(web.consultasDeFacturacion()).toBeDefined();
    expect(armarTrabajos(conexiones).procesador()).toBeDefined();
    expect(registrados).toEqual([]);
    // La pieza que SÍ la necesita falla cerrado y nombra la variable solo en el registro.
    expect(() => conexiones.cifradorDeCertificados()).toThrow(ErrorDeEntorno);
    expect(registrados).toEqual([
      "pieza cifrador-de-certificados: PEDERNAL_CLAVE_CERTIFICADOS falta",
    ]);
  });

  it("sin la clave de los certificados, las acciones del certificado fallan cerrado al pedirse y el nombre de la variable va solo al registro", () => {
    const sinClave: Record<string, string> = valida();
    delete sinClave["PEDERNAL_CLAVE_CERTIFICADOS"];
    const { conexiones, registrados } = conFuente(sinClave);
    const web = armarWeb(conexiones);
    expect(registrados).toEqual([]);
    expect(() => web.casosDeUsoDeCertificados()).toThrow(ErrorDeEntorno);
    expect(registrados).toEqual([
      "pieza cifrador-de-certificados: PEDERNAL_CLAVE_CERTIFICADOS falta",
    ]);
    // Nada se memoriza: con la clave corregida, el mismo grupo se arma.
    sinClave["PEDERNAL_CLAVE_CERTIFICADOS"] = valida()["PEDERNAL_CLAVE_CERTIFICADOS"] as string;
    expect(web.casosDeUsoDeCertificados()).toBeDefined();
  });

  it("la web ofrece de fiscal solo lo que una persona dispara: ni los trabajos de sistema ni la numeración suelta ni el modelo de impresión", () => {
    const { conexiones } = conFuente(valida());
    const web = armarWeb(conexiones);
    expect(Object.keys(web.casosDeUsoDeFacturacion()).sort()).toEqual([
      "cambiarAmbienteDePuntoDeVenta",
      "descartarComprobante",
      "emitirComprobanteManual",
      "emitirNotaDeCredito",
      "emitirNotaDeDebito",
      "reintentarComprobante",
      "resincronizarSerie",
    ]);
    // La configuración fiscal del gerente (D-43): solo los dos temas con acciones y sin la regla del emisor.
    expect(Object.keys(web.casosDeUsoDeConfiguracionFiscal()).sort()).toEqual([
      "activarPuntoDeVenta",
      "confirmarDatosFiscales",
      "crearPuntoDeVenta",
      "desactivarPuntoDeVenta",
      "editarPuntoDeVenta",
      "empezarCorreccionDeDatosFiscales",
      "guardarBorradorDeDatosFiscales",
    ]);
    // El certificado de ARCA: solo generar el pedido y cargar el certificado (el estado va por las consultas).
    expect(Object.keys(web.casosDeUsoDeCertificados()).sort()).toEqual([
      "cargarCertificado",
      "generarPedidoDeCertificado",
    ]);
    expect(Object.keys(web.consultasDeFacturacion()).sort()).toEqual([
      "datosFiscalesDelEmisor",
      "discriminaIvaAlEmitir",
      "estadoDeCertificados",
      "estadoDeLaConfiguracionFiscal",
      "listarComprobantes",
      "listarPuntosDeVentaDeLaSucursal",
      "listarPuntosDeVentaParaEmitir",
      "modeloDeImpresion",
      "puntosDeVentaDelEmisor",
      "verComprobante",
    ]);
  });

  it("las transacciones de la aplicación y las de los trabajos son instancias distintas", () => {
    const { conexiones } = conFuente(valida());
    expect(conexiones.transaccionesDeApp()).not.toBe(conexiones.transaccionesDeTrabajos());
  });

  it("la puerta pública es una pieza aparte: una sola instancia, y la resolución de host se arma una sola vez", () => {
    const { conexiones } = conFuente(valida());
    expect(conexiones.transaccionesPublicas()).toBe(conexiones.transaccionesPublicas());
    expect(conexiones.resolucionDeHost()).toBe(conexiones.resolucionDeHost());
    expect(armarWeb(conexiones).resolucionDeHost()).toBe(conexiones.resolucionDeHost());
    expect(conexiones.configuracionPublicaDeHost()).toBe(conexiones.configuracionPublicaDeHost());
    expect(armarWeb(conexiones).configuracionPublicaDeHost()).toBe(
      conexiones.configuracionPublicaDeHost(),
    );
  });

  it("sin la cadena de la puerta pública, el resto de las piezas se arma igual", () => {
    const sinPublico: Record<string, string> = valida();
    delete sinPublico["PEDERNAL_DB_PUBLICO"];
    const { conexiones, registrados } = conFuente(sinPublico);
    expect(conexiones.transaccionesDeApp()).toBeDefined();
    expect(conexiones.transaccionesDeTrabajos()).toBeDefined();
    expect(() => conexiones.resolucionDeHost()).toThrow(ErrorDeEntorno);
    expect(registrados).toEqual(["pieza transacciones-publicas: PEDERNAL_DB_PUBLICO falta"]);
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
      "permisosDelActor",
      "sucursalesElegibles",
    ]);
    expect(Object.keys(web.casosDeUsoDeIdentidad())).toEqual(
      expect.arrayContaining(["invitarUsuario", "aceptarInvitacion", "revocarInvitacion"]),
    );
    expect(Object.keys(web.consultasDeIdentidad()).length).toBeGreaterThan(0);
    expect(web.casosDeUsoDeEmpresas()).toBe(web.casosDeUsoDeEmpresas());
    expect(web.consultasDeIdentidad()).toBe(web.consultasDeIdentidad());
  });

  it("la clave de los certificados no puede ser la de contexto ni tener poca variedad: falla cerrado y solo el registro nombra la variable", () => {
    const hex = randomBytes(32).toString("hex");
    for (const clave of [`k1:${hex}`, `otro:${hex.toUpperCase()}`, `k1:${"0".repeat(64)}`]) {
      const fuente: Record<string, string> = {
        ...valida(),
        PEDERNAL_CLAVE_CONTEXTO: `1:${hex}`,
        PEDERNAL_CLAVE_CERTIFICADOS: clave,
      };
      const { conexiones, registrados } = conFuente(fuente);
      let error: unknown;
      try {
        conexiones.cifradorDeCertificados();
      } catch (e) {
        error = e;
      }
      expect(error).toBeInstanceOf(ErrorDeEntorno);
      expect((error as ErrorDeEntorno).message).not.toMatch(/PEDERNAL|\b[0-9a-f]{16,}\b/i);
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toContain("PEDERNAL_CLAVE_CERTIFICADOS");
      expect(registrados[0]).not.toContain(hex);
    }
    // Una distinta y variada sí sirve.
    const { conexiones } = conFuente(valida());
    expect(conexiones.cifradorDeCertificados()).toBeDefined();
  });

  it("el procesador de la cola se arma sin la configuración del correo ni el secreto de invitaciones: lo fiscal no depende de ellos", () => {
    const sinCorreo: Record<string, string> = valida();
    for (const nombre of [
      "PEDERNAL_RESEND_API_KEY",
      "PEDERNAL_CORREO_REMITENTE",
      "PEDERNAL_NOMBRE_DE_MARCA",
      "PEDERNAL_URL_BASE",
      "PEDERNAL_SECRETO_INVITACIONES",
    ]) {
      delete sinCorreo[nombre];
    }
    const { conexiones, registrados } = conFuente(sinCorreo);
    expect(armarTrabajos(conexiones).procesador()).toBeDefined();
    // Armar el procesador no pidió ninguna pieza del correo: recién el manejador de invitaciones la pide.
    expect(registrados).toEqual([]);
  });

  it("los trabajos arman el procesador una sola vez", () => {
    const { conexiones } = conFuente(valida());
    const trabajos = armarTrabajos(conexiones);
    const procesador = trabajos.procesador();
    expect(typeof procesador.procesarPendientes).toBe("function");
    expect(trabajos.procesador()).toBe(procesador);
  });

  it("la autenticación es una sola instancia, el barrido es el de la misma conexión, y el barrido no pide ni el secreto ni Google", () => {
    const { conexiones, registrados } = conFuente(valida());
    expect(conexiones.autenticacion()).toBe(conexiones.autenticacion());
    expect(armarWeb(conexiones).autenticacion()).toBe(conexiones.autenticacion());
    expect(typeof conexiones.autenticacion().sesionDe).toBe("function");
    expect(typeof conexiones.autenticacion().manejar).toBe("function");
    expect(conexiones.barridoDeAutenticacion()).toBe(conexiones.barridoDeAutenticacion());
    // La revocación de sesiones (trabajo `revocar_sesiones`) es de la misma conexión y tampoco pide el secreto ni Google.
    expect(conexiones.revocacionDeSesiones()).toBe(conexiones.revocacionDeSesiones());
    expect(typeof conexiones.revocacionDeSesiones().revocarDelUsuario).toBe("function");
    expect(registrados).toEqual([]);

    const soloLaBase: Record<string, string> = valida();
    for (const nombre of [
      "PEDERNAL_AUTH_SECRETO_EMPRESA",
      "GOOGLE_CLIENT_ID",
      "GOOGLE_CLIENT_SECRET",
    ]) {
      delete soloLaBase[nombre];
    }
    const otra = conFuente(soloLaBase);
    expect(otra.conexiones.barridoDeAutenticacion()).toBeDefined();
    expect(otra.conexiones.revocacionDeSesiones()).toBeDefined();
    expect(() => otra.conexiones.autenticacion()).toThrow(ErrorDeEntorno);
    expect(otra.registrados).toEqual([
      "pieza autenticacion: PEDERNAL_AUTH_SECRETO_EMPRESA falta; GOOGLE_CLIENT_ID falta; GOOGLE_CLIENT_SECRET falta",
    ]);
  });

  it("la composición no abrió ninguna conexión: cerrar no tiene nada que cerrar", async () => {
    const { conexiones } = conFuente(valida());
    armarWeb(conexiones).casosDeUsoDeIdentidad();
    await expect(conexiones.transaccionesDeApp().cerrar()).resolves.toBeUndefined();
  });
});

/**
 * Toda acción o consulta que `armarWeb` expone pasa por el guard, o figura aquí con su motivo («todo nace cerrado»).
 * Previene: un caso nuevo declarado `sinGuard` (o una entrada nueva de `web`) que sale a la web sin que ninguna prueba lo vea;
 * las pruebas por módulo miran sus propias tablas, no lo que `web.ts` realmente expone.
 */
type Declaraciones = Readonly<Record<string, Readonly<{ accion: string } | { sinGuard: string }>>>;
type Decision =
  | Readonly<{ conGuard: Declaraciones; exentos?: Readonly<Record<string, string>> }>
  | Readonly<{ sinGuard: string }>;

/** Lo que incumple la regla; vacío si cumple. Recibe `web` y las decisiones para poder probarla con un doble. */
function incumplimientosDeLaWeb(
  web: Readonly<Record<string, () => object>>,
  decisiones: Readonly<Record<string, Decision>>,
): string[] {
  const falta = Object.keys(web)
    .filter((nombre) => !(nombre in decisiones))
    .map((nombre) => `${nombre}: sin decidir (con guard, o sin guard con su motivo)`);
  const de = Object.entries(decisiones).flatMap(([nombre, decision]) => {
    const grupo = web[nombre];
    if (grupo === undefined) return [`${nombre}: decidida pero web no la expone`];
    if ("sinGuard" in decision) return [];
    const exentos = decision.exentos ?? {};
    const expuestos = Object.keys(grupo());
    return [
      ...expuestos.flatMap((caso) => {
        const declaracion = decision.conGuard[caso];
        if (declaracion === undefined) return [`${nombre}.${caso}: sin declaración`];
        return "accion" in declaracion || caso in exentos
          ? []
          : [`${nombre}.${caso}: sinGuard y no está en los exentos`];
      }),
      ...Object.keys(exentos)
        .filter((caso) => !expuestos.includes(caso) || "accion" in (decision.conGuard[caso] ?? {}))
        .map((caso) => `${nombre}.${caso}: exento que ya no corresponde`),
    ];
  });
  return [...falta, ...de];
}

/** Una entrada nueva de `armarWeb` no compila hasta que se la decide acá. */
const DECISIONES_DE_WEB: Record<keyof ReturnType<typeof armarWeb>, Decision> = {
  casosDeUsoDeCatalogo: { conGuard: DECLARACIONES_DE_CATALOGO },
  consultasDeCatalogo: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_CATALOGO },
  casosDeUsoDeEmpresas: { conGuard: DECLARACIONES_DE_EMPRESAS },
  consultasDeEmpresas: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_EMPRESAS },
  casosDeUsoDeCaja: { conGuard: DECLARACIONES_DE_CAJA },
  consultasDeCaja: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_CAJA },
  casosDeUsoDeCierre: { conGuard: DECLARACIONES_DE_CIERRE },
  consultasDeCierre: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_CIERRE },
  casosDeUsoDeVentas: { conGuard: DECLARACIONES_DE_VENTAS },
  consultasDeVentas: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_VENTAS },
  casosDeUsoDeIdentidad: {
    conGuard: DECLARACIONES_DE_IDENTIDAD,
    exentos: {
      // Fuente: identidad/casos-de-uso/declaraciones.ts:21-23 (el invitado aún no es miembro: autorizan el hash del token, la RLS y el email).
      aceptarInvitacion: "autoriza el token de la invitación (contexto INVITACION), no el guard",
    },
  },
  consultasDeIdentidad: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_IDENTIDAD },
  casosDeUsoDeFacturacion: { conGuard: DECLARACIONES_DE_FACTURACION },
  casosDeUsoDeConfiguracionFiscal: { conGuard: DECLARACIONES_DE_CONFIGURACION_FISCAL },
  casosDeUsoDeCertificados: { conGuard: DECLARACIONES_DE_CERTIFICADOS },
  consultasDeFacturacion: { conGuard: DECLARACIONES_DE_CONSULTAS_DE_FISCAL },
  // Sin guard por diseño. Fuentes: web.ts:23-26 (puerta pública), :36-38 (autenticación y barrido), :133 y de-la-sesion.ts:18-22 (sesión).
  resolucionDeHost: { sinGuard: "puerta pública: sin sesión, solo lectura" },
  configuracionPublicaDeHost: { sinGuard: "puerta pública: sin sesión, solo lectura" },
  autenticacion: { sinGuard: "dice QUIÉN es (usuario y email verificado, por host)" },
  barridoDeAutenticacion: { sinGuard: "lo llama el cron, no una persona" },
  lecturasCompartidas: {
    sinGuard:
      "no es una consulta: junta en una transacción de solo lectura las que ya hace el pedido, y cada una exige SU acción al guard",
  },
  consultasDeSesion: { sinGuard: "contexto SESION: todavía no hay empresa; acota la base (RLS)" },
};

describe("toda acción o consulta de la web pasa por el guard o figura con su motivo", () => {
  it("la web real cumple la regla", () => {
    const web = armarWeb(conFuente(valida()).conexiones);
    expect(incumplimientosDeLaWeb(web, DECISIONES_DE_WEB)).toEqual([]);
  });

  it("violación inyectada: un caso sinGuard expuesto, una entrada sin decidir y una declaración faltante la hacen fallar", () => {
    const doble = {
      casos: () => ({ conPermiso: () => 1, nuevoSinGuard: () => 2, sinDeclarar: () => 3 }),
      entradaNueva: () => ({}),
    };
    const decisiones: Record<string, Decision> = {
      casos: {
        conGuard: {
          conPermiso: { accion: "sucursales.ver" },
          nuevoSinGuard: { sinGuard: "motivo cualquiera" },
        },
      },
    };
    expect(incumplimientosDeLaWeb(doble, decisiones)).toEqual([
      "entradaNueva: sin decidir (con guard, o sin guard con su motivo)",
      "casos.nuevoSinGuard: sinGuard y no está en los exentos",
      "casos.sinDeclarar: sin declaración",
    ]);
    // Con su excepción explícita pasa, y una excepción que ya no corresponde falla.
    const exento = {
      ...decisiones["casos"],
      exentos: { nuevoSinGuard: "motivo", conPermiso: "x" },
    } as Decision;
    expect(incumplimientosDeLaWeb({ casos: doble.casos }, { casos: exento })).toEqual([
      "casos.sinDeclarar: sin declaración",
      "casos.conPermiso: exento que ya no corresponde",
    ]);
  });
});

/**
 * Cada caso de uso declara cómo se repite sin duplicar (ADR-015 §4) y la prueba de «repetir la misma acción» que nombra existe.
 * La declaración nombra el archivo y el título exacto del `it`: así ni una prueba borrada, ni renombrada, ni salteada (`it.skip`)
 * deja una declaración que nadie respalda; sin el campo ni compila (`DeclaracionDeCasoDeUso`).
 * Previene: un caso de uso que se sube sin que nadie haya decidido ni probado qué pasa al repetirlo (doble clic, reintento de red),
 * o una declaración cuya prueba dejó de existir sin que nada lo note. No juzga que la prueba nombrada repita de verdad la acción:
 * eso lo ve quien revisa; lo que no se puede dejar pasar es que no exista.
 */
type Fuentes = (archivo: string) => string | null;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null;

/** Lo que incumple la regla; vacío si cumple. Recibe cómo leer un archivo para poder probarla con archivos inventados. */
function incumplimientosDeRepeticion(
  grupos: Readonly<Record<string, Readonly<Record<string, unknown>>>>,
  leer: Fuentes,
): string[] {
  return Object.entries(grupos).flatMap(([grupo, casos]) =>
    Object.entries(casos).flatMap(([caso, declaracion]) => {
      const donde = `${grupo}.${caso}`;
      const repeticion = esObjeto(declaracion) ? declaracion["repeticion"] : undefined;
      if (!esObjeto(repeticion)) return [`${donde}: no declara cómo se repite`];
      const { regla, prueba } = repeticion;
      if (!REGLAS_DE_REPETICION.some((r) => r === regla)) {
        return [`${donde}: regla de repetición desconocida`];
      }
      if (
        regla === "NO_APLICA" &&
        (typeof repeticion["motivo"] !== "string" || repeticion["motivo"].trim() === "")
      ) {
        return [`${donde}: NO_APLICA sin el motivo escrito`];
      }
      const archivo = esObjeto(prueba) ? prueba["archivo"] : undefined;
      const titulo = esObjeto(prueba) ? prueba["it"] : undefined;
      if (
        typeof archivo !== "string" ||
        typeof titulo !== "string" ||
        !archivo.endsWith(".test.ts")
      ) {
        return [`${donde}: la prueba no nombra un archivo .test.ts y el título de su it`];
      }
      const fuente = leer(archivo);
      if (fuente === null) return [`${donde}: no existe ${archivo}`];
      const apertura = `it(${JSON.stringify(titulo)},`;
      const veces = fuente
        .split("\n")
        .filter((linea) => linea.trimStart().startsWith(apertura)).length;
      if (veces === 0) {
        return [
          `${donde}: ${archivo} no tiene un it con el título «${titulo}» (¿borrado, renombrado o salteado?)`,
        ];
      }
      return veces === 1
        ? []
        : [`${donde}: ${archivo} tiene ${veces} it con el título «${titulo}»`];
    }),
  );
}

/** Los casos de uso que sale a la web (cada grupo `casosDeUso…` decidido con guard) y los de numeración, que no salen a la web. */
const CASOS_DE_USO_A_REVISAR: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  ...Object.fromEntries(
    Object.entries(DECISIONES_DE_WEB).flatMap(([nombre, decision]) =>
      nombre.startsWith("casosDeUso") && "conGuard" in decision
        ? [[nombre, decision.conGuard]]
        : [],
    ),
  ),
  numeracionDeFiscal: DECLARACIONES_DE_FISCAL,
};

describe("cada caso de uso declara cómo se repite y la prueba que nombra existe", () => {
  it("los casos de uso reales cumplen la regla", () => {
    const raiz = join(import.meta.dirname, "..", "..");
    const leer: Fuentes = (archivo) =>
      existsSync(join(raiz, archivo)) ? readFileSync(join(raiz, archivo), "utf8") : null;
    const casos = Object.values(CASOS_DE_USO_A_REVISAR).flatMap((grupo) => Object.keys(grupo));
    expect(casos.length).toBeGreaterThan(0);
    expect(incumplimientosDeRepeticion(CASOS_DE_USO_A_REVISAR, leer)).toEqual([]);
  });

  it("violación inyectada: sin declarar, regla inventada, NO_APLICA sin motivo, archivo ausente, título renombrado, it salteado, título repetido y archivo que no es una prueba la hacen fallar", () => {
    const archivos: Record<string, string> = {
      "test/a.test.ts": [
        '  it("repetir no duplica", async () => {',
        '  it.skip("salteada", async () => {',
        '  it("doble", () => {',
        '  it("doble", () => {',
      ].join("\n"),
    };
    const prueba = (archivo: string, it: string) => ({ archivo, it });
    const grupos = {
      g: {
        bien: {
          repeticion: {
            regla: "YA_ESTABA",
            prueba: prueba("test/a.test.ts", "repetir no duplica"),
          },
        },
        sinDeclarar: { accion: "sucursales.crear" },
        reglaInventada: {
          repeticion: { regla: "A_VECES", prueba: prueba("test/a.test.ts", "repetir no duplica") },
        },
        noAplicaSinMotivo: {
          repeticion: {
            regla: "NO_APLICA",
            prueba: prueba("test/a.test.ts", "repetir no duplica"),
          },
        },
        noAplicaConMotivoVacio: {
          repeticion: {
            regla: "NO_APLICA",
            motivo: "  ",
            prueba: prueba("test/a.test.ts", "repetir no duplica"),
          },
        },
        noAplicaConMotivo: {
          repeticion: {
            regla: "NO_APLICA",
            motivo: "lo evita quien la llama",
            prueba: prueba("test/a.test.ts", "repetir no duplica"),
          },
        },
        sinArchivo: {
          repeticion: { regla: "SIN_CAMBIOS", prueba: prueba("test/no-esta.test.ts", "x") },
        },
        renombrada: {
          repeticion: { regla: "SIN_CAMBIOS", prueba: prueba("test/a.test.ts", "repetir duplica") },
        },
        salteada: {
          repeticion: { regla: "YA_ESTABA", prueba: prueba("test/a.test.ts", "salteada") },
        },
        repetida: { repeticion: { regla: "YA_ESTABA", prueba: prueba("test/a.test.ts", "doble") } },
        noEsPrueba: { repeticion: { regla: "YA_ESTABA", prueba: prueba("README.md", "x") } },
      },
    };
    expect(incumplimientosDeRepeticion(grupos, (archivo) => archivos[archivo] ?? null)).toEqual([
      "g.sinDeclarar: no declara cómo se repite",
      "g.reglaInventada: regla de repetición desconocida",
      "g.noAplicaSinMotivo: NO_APLICA sin el motivo escrito",
      "g.noAplicaConMotivoVacio: NO_APLICA sin el motivo escrito",
      "g.sinArchivo: no existe test/no-esta.test.ts",
      "g.renombrada: test/a.test.ts no tiene un it con el título «repetir duplica» (¿borrado, renombrado o salteado?)",
      "g.salteada: test/a.test.ts no tiene un it con el título «salteada» (¿borrado, renombrado o salteado?)",
      "g.repetida: test/a.test.ts tiene 2 it con el título «doble»",
      "g.noEsPrueba: la prueba no nombra un archivo .test.ts y el título de su it",
    ]);
  });
});
