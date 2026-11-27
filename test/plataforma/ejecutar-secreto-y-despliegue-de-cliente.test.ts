import { describe, expect, it, vi } from "vitest";
import { VARIABLE_DEL_PAQUETE_DE_CLIENTE } from "../../scripts/ejecutar-alta-de-cliente";
import {
  PEDIDOS_DE_SALUD,
  datosDelDespliegue,
  verificarDespliegue,
} from "../../scripts/ejecutar-despliegue-de-cliente";
import {
  prepararSecretoDeInvitaciones,
  type EntradaDelSecretoDeInvitaciones,
} from "../../scripts/ejecutar-secreto-de-invitaciones-de-cliente";
import { PROYECTOS_DE_VERCEL_DE_CLIENTES } from "../../src/adaptadores/vercel/plan-de-variables";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * Los dos pasos de apoyo del alta y del despliegue de un cliente, con todo inyectado: el secreto de invitaciones (se escribe en Vercel solo si la empresa no existe, y nunca se imprime) y
 * los datos y la verificación del despliegue (el proyecto sale de la lista cerrada; una dirección protegida no cuenta como OK).
 */

const PROYECTO = PROYECTOS_DE_VERCEL_DE_CLIENTES["cliente-hdn"] as string;
const TOKEN = ["tok", "centinela", "ABCdef123456"].join("-");
const CADENA = "postgres://dueno-centinela:clave-dueno-centinela@host-centinela.test/base";
const GENERADO = "ab12".repeat(16);
const PAQUETE = JSON.stringify({
  adminEmail: "admin.centinela@ejemplo.test",
  vigenteDesde: "2026-11-27T12:00:00-03:00",
  marca: { codigo: "hdn", nombreVisible: "Hoteles" },
  plan: { codigo: "p", nombreComercial: "Plan", perillas: {} },
  dominios: [
    {
      host: "app.centinela.test",
      superficie: "APP",
      titular: "OPERADOR",
      verificadoEn: "2026-11-26T09:00:00-03:00",
    },
  ],
  empresa: {
    nombreDeTenant: "Tenant Centinela",
    cuit: "20123456786",
    razonSocial: "Razon Centinela SRL",
    zonaHoraria: "America/Argentina/Buenos_Aires",
    moneda: "ARS",
    emailGerente: "gerente.centinela@ejemplo.test",
  },
});

function armarSecreto(
  opciones: {
    ambiente?: string | undefined;
    existe?: boolean | "falla";
    escritura?: ReturnType<typeof ok> | ReturnType<typeof err>;
    entorno?: Record<string, string | undefined>;
  } = {},
) {
  const entregadas: string[] = [];
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const escribir = vi.fn(() =>
    Promise.resolve(opciones.escritura ?? ok(null)),
  ) as unknown as ReturnType<EntradaDelSecretoDeInvitaciones["clienteDeVercel"]>["escribir"];
  const proyectos: string[] = [];
  const entrada: EntradaDelSecretoDeInvitaciones = {
    ambiente: "ambiente" in opciones ? opciones.ambiente : "cliente-hdn",
    entorno: {
      PEDERNAL_DB_MIGRACIONES: CADENA,
      PEDERNAL_VERCEL_TOKEN: TOKEN,
      PEDERNAL_HOST_DE_LA_BASE: "host-centinela.test",
      [VARIABLE_DEL_PAQUETE_DE_CLIENTE]: PAQUETE,
      ...opciones.entorno,
    },
    empresaExiste: () =>
      opciones.existe === "falla"
        ? Promise.reject(new Error("falló " + CADENA))
        : Promise.resolve(opciones.existe === true),
    clienteDeVercel: (_token, proyecto) => {
      proyectos.push(proyecto);
      return { escribir } as unknown as ReturnType<
        EntradaDelSecretoDeInvitaciones["clienteDeVercel"]
      >;
    },
    entregar: (l) => entregadas.push(l),
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    comando: (l) => comandos.push(l),
    generar: () => GENERADO,
  };
  return { entrada, entregadas, escribir, proyectos, salida, errores, comandos };
}

describe("secreto de invitaciones del cliente", () => {
  it("empresa nueva: lo escribe en el proyecto de Vercel DE LA LISTA CERRADA (pisando) y lo entrega al alta, tapado", async () => {
    const t = armarSecreto();
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(0);
    expect(t.proyectos).toEqual([PROYECTO]);
    expect(t.escribir).toHaveBeenCalledWith(
      "PEDERNAL_SECRETO_INVITACIONES",
      GENERADO,
      "production",
      {
        pisar: true,
      },
    );
    expect(t.entregadas).toEqual([`PEDERNAL_SECRETO_INVITACIONES=${GENERADO}`]);
    expect(t.comandos).toContain(`::add-mask::${GENERADO}`);
  });

  it("«ya hay alta» no depende del CUIT del paquete: la consulta recibe solo la cadena", async () => {
    const t = armarSecreto({ existe: true });
    const consulta = vi.fn(() => Promise.resolve(true));
    expect(await prepararSecretoDeInvitaciones({ ...t.entrada, empresaExiste: consulta })).toBe(0);
    expect(consulta).toHaveBeenCalledWith(CADENA);
    expect(t.escribir).not.toHaveBeenCalled();
  });

  it("empresa ya creada: NO escribe nada en Vercel (la invitación emitida sigue válida) y entrega un valor de relleno", async () => {
    const t = armarSecreto({ existe: true });
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(0);
    expect(t.escribir).not.toHaveBeenCalled();
    expect(t.entregadas).toHaveLength(1);
    expect(t.salida.join("\n")).toContain("NO se toca");
  });

  it("si Vercel rechaza la escritura, no entrega nada y falla (no se crea la empresa)", async () => {
    const t = armarSecreto({ escritura: err({ motivo: "403", incierta: false }) });
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(1);
    expect(t.entregadas).toEqual([]);
  });

  it("si la base no responde, falla sin repetir la cadena", async () => {
    const t = armarSecreto({ existe: "falla" });
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(1);
    expect(t.escribir).not.toHaveBeenCalled();
    expect(t.errores.join("\n")).not.toContain("clave-dueno-centinela");
  });

  it.each([
    ["ambiente fuera de la lista", { ambiente: "preview" }],
    ["sin ambiente", { ambiente: undefined }],
    ["sin cadena", { entorno: { PEDERNAL_DB_MIGRACIONES: "" } }],
    ["cadena al pooler", { entorno: { PEDERNAL_DB_MIGRACIONES: "postgres://u:p@h-pooler.x/db" } }],
    ["sin token", { entorno: { PEDERNAL_VERCEL_TOKEN: undefined } }],
    [
      "cadena de otra base",
      { entorno: { PEDERNAL_DB_MIGRACIONES: "postgres://u:p@otro.test/db" } },
    ],
    ["sin host declarado", { entorno: { PEDERNAL_HOST_DE_LA_BASE: undefined } }],
    ["paquete roto", { entorno: { [VARIABLE_DEL_PAQUETE_DE_CLIENTE]: "{" } }],
  ])("cierra ante la duda: %s", async (_n, cambios) => {
    const t = armarSecreto(cambios);
    expect(await prepararSecretoDeInvitaciones(t.entrada)).toBe(2);
    expect(t.escribir).not.toHaveBeenCalled();
    expect(t.entregadas).toEqual([]);
  });

  it("nada sensible sale en lo que se imprime", async () => {
    for (const opciones of [{}, { existe: true as const }, { existe: "falla" as const }]) {
      const t = armarSecreto(opciones);
      await prepararSecretoDeInvitaciones(t.entrada);
      const texto = [...t.salida, ...t.errores].join("\n");
      for (const p of [
        TOKEN,
        GENERADO,
        "clave-dueno-centinela",
        "20123456786",
        "admin.centinela",
      ]) {
        expect(texto).not.toContain(p);
      }
    }
  });
});

const TOKEN_DE_VERCEL = {
  PEDERNAL_VERCEL_TOKEN: TOKEN,
  PEDERNAL_DB_MIGRACIONES: CADENA,
  PEDERNAL_HOST_DE_LA_BASE: "host-centinela.test",
};

describe("datos del despliegue del cliente", () => {
  const armar = (
    respuesta: { estado: number; cuerpo: string } | "falla",
    ambiente: string | undefined,
    entorno: Record<string, string | undefined>,
  ) => {
    const entregadas: string[] = [];
    const errores: string[] = [];
    const pedidos: Array<{ url: string; encabezados: unknown }> = [];
    const entrada = {
      ambiente,
      entorno,
      pedir: (url: string, encabezados?: Readonly<Record<string, string>>) => {
        pedidos.push({ url, encabezados });
        return respuesta === "falla"
          ? Promise.reject(new Error(TOKEN))
          : Promise.resolve(respuesta);
      },
      entregar: (l: string) => entregadas.push(l),
      info: () => undefined,
      error: (l: string) => errores.push(l),
    };
    return { entrada, entregadas, errores, pedidos };
  };

  it("el proyecto sale de la lista cerrada, el token viaja solo en el encabezado y entrega la cuenta y el proyecto", async () => {
    const t = armar(
      { estado: 200, cuerpo: JSON.stringify({ id: PROYECTO, accountId: "team_abc123" }) },
      "cliente-hdn",
      TOKEN_DE_VERCEL,
    );
    expect(await datosDelDespliegue(t.entrada)).toBe(0);
    expect(t.pedidos).toHaveLength(1);
    expect(t.pedidos[0]?.url).toContain(`/v9/projects/${PROYECTO}`);
    expect(t.pedidos[0]?.url).not.toContain(TOKEN);
    expect(t.pedidos[0]?.encabezados).toEqual({ authorization: `Bearer ${TOKEN}` });
    expect(t.entregadas).toEqual(["VERCEL_ORG_ID=team_abc123", `VERCEL_PROJECT_ID=${PROYECTO}`]);
  });

  it.each([
    ["ambiente fuera de la lista", "preview", TOKEN_DE_VERCEL, 2],
    ["sin ambiente", undefined, TOKEN_DE_VERCEL, 2],
    ["sin token", "cliente-hdn", { ...TOKEN_DE_VERCEL, PEDERNAL_VERCEL_TOKEN: undefined }, 2],
    [
      "cadena de otra base",
      "cliente-hdn",
      { ...TOKEN_DE_VERCEL, PEDERNAL_DB_MIGRACIONES: "postgres://u:p@otro.test/db" },
      2,
    ],
    [
      "sin host declarado",
      "cliente-hdn",
      { ...TOKEN_DE_VERCEL, PEDERNAL_HOST_DE_LA_BASE: undefined },
      2,
    ],
  ])("cierra ante la duda: %s (no consulta nada)", async (_n, ambiente, entorno, codigo) => {
    const t = armar({ estado: 200, cuerpo: "{}" }, ambiente, entorno);
    expect(await datosDelDespliegue(t.entrada)).toBe(codigo);
    expect(t.pedidos).toEqual([]);
    expect(t.entregadas).toEqual([]);
  });

  it.each([
    ["Vercel dice 403", { estado: 403, cuerpo: "{}" }],
    ["cuerpo que no es JSON", { estado: 200, cuerpo: "<html>" }],
    [
      "otro proyecto",
      { estado: 200, cuerpo: JSON.stringify({ id: "prj_otro", accountId: "team_abc123" }) },
    ],
    ["sin cuenta", { estado: 200, cuerpo: JSON.stringify({ id: PROYECTO }) }],
    [
      "cuenta con caracteres raros",
      { estado: 200, cuerpo: JSON.stringify({ id: PROYECTO, accountId: "a b\nVERCEL_X=1" }) },
    ],
    ["falla de red", "falla" as const],
  ])("no entrega nada si Vercel no confirma el proyecto: %s", async (_n, respuesta) => {
    const t = armar(respuesta, "cliente-hdn", TOKEN_DE_VERCEL);
    expect(await datosDelDespliegue(t.entrada)).toBe(1);
    expect(t.entregadas).toEqual([]);
    expect(t.errores.join("\n")).not.toContain(TOKEN);
  });
});

describe("verificación del despliegue del cliente", () => {
  const URL = "https://pedernal-hdn-abc123.vercel.app";
  const armar = (
    respuestas: Array<{ estado: number; cuerpo: string } | "falla">,
    url: string | undefined,
  ) => {
    const cola = [...respuestas];
    const pedidos: string[] = [];
    const esperas: number[] = [];
    const salida: string[] = [];
    const errores: string[] = [];
    return {
      pedidos,
      esperas,
      salida,
      errores,
      entrada: {
        url,
        pedir: (u: string) => {
          pedidos.push(u);
          const r = cola.length > 1 ? cola.shift() : cola[0];
          return r === "falla" || r === undefined
            ? Promise.reject(new Error("red"))
            : Promise.resolve(r);
        },
        esperar: (ms: number) => {
          esperas.push(ms);
          return Promise.resolve();
        },
        info: (l: string) => salida.push(l),
        error: (l: string) => errores.push(l),
      },
    };
  };
  const SANO = { estado: 200, cuerpo: '{"ok":true}' };

  it("200 con ok=true: LISTO, pidiendo /api/salud", async () => {
    const t = armar([SANO], URL);
    expect(await verificarDespliegue(t.entrada)).toBe(0);
    expect(t.pedidos).toEqual([`${URL}/api/salud`]);
  });

  it("con el secreto de bypass lo manda solo en el encabezado y puede mirar una dirección protegida", async () => {
    const t = armar([SANO], URL);
    const pedidos: Array<unknown> = [];
    const pedir = (u: string, h?: Readonly<Record<string, string>>) => {
      pedidos.push([u, h]);
      return Promise.resolve(SANO);
    };
    expect(await verificarDespliegue({ ...t.entrada, pedir, bypass: "bypass-centinela-123" })).toBe(
      0,
    );
    expect(pedidos).toEqual([
      [`${URL}/api/salud`, { "x-vercel-protection-bypass": "bypass-centinela-123" }],
    ]);
    expect(await verificarDespliegue({ ...t.entrada, pedir, bypass: "con espacio" })).toBe(2);
    expect(t.salida.join("")).not.toContain("bypass-centinela");
  });

  it("reintenta un despliegue que todavía no contesta y termina en LISTO", async () => {
    const t = armar([{ estado: 502, cuerpo: "" }, "falla", SANO], URL);
    expect(await verificarDespliegue(t.entrada)).toBe(0);
    expect(t.pedidos).toHaveLength(3);
    expect(t.esperas).toHaveLength(2);
  });

  it.each([401, 403])("%s: NO VERIFICADO (código 3), nunca un OK silencioso", async (estado) => {
    const t = armar([{ estado, cuerpo: "" }], URL);
    expect(await verificarDespliegue(t.entrada)).toBe(3);
    expect(t.errores.join("\n")).toContain("NO VERIFICADO");
    expect(t.salida).toEqual([]);
  });

  it("200 sin ok=true no es sano: agota los intentos y falla", async () => {
    const t = armar([{ estado: 200, cuerpo: '{"ok":false}' }], URL);
    expect(await verificarDespliegue(t.entrada)).toBe(1);
    expect(t.pedidos).toHaveLength(PEDIDOS_DE_SALUD);
  });

  it.each([
    undefined,
    "",
    "http://pedernal-hdn.vercel.app",
    "https://evil.example/x.vercel.app",
    "https://a.vercel.app/ruta",
    "https://a.vercel.app@evil.test",
  ])(
    "una dirección que no es https://<nombre>.vercel.app (%s) se rechaza sin pedir nada",
    async (url) => {
      const t = armar([SANO], url);
      expect(await verificarDespliegue(t.entrada)).toBe(2);
      expect(t.pedidos).toEqual([]);
    },
  );
});
