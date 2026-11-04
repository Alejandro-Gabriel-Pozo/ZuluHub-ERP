import { describe, expect, it } from "vitest";
import {
  CARACTERES_DISTINTOS_PEDIDOS,
  EQUIPO_DE_VERCEL,
  NOMBRE_DE_LA_CADENA_DE_DUENO,
  PROYECTO_DE_VERCEL,
  VARIABLE_CLAVE_CONTEXTO,
  VARIABLES_GENERABLES,
  VARIABLE_CLAVE_CERTIFICADOS,
  VARIABLE_DEL_TOKEN,
  VARIABLE_SECRETO_DEL_CRON,
  VARIABLE_SECRETO_DE_AUTENTICACION,
  VARIABLE_SECRETO_INVITACIONES,
  generarSecretos,
  generarValor,
  leerDestino,
  leerTokenDeVercel,
  leerVariablesRemotas,
  noDebeEstarEnVercel,
  planificar,
  sobraEnVercel,
  type VariableRemota,
} from "./plan-de-variables";

function variable(parcial: Partial<VariableRemota> & { key: string }): VariableRemota {
  return {
    id: `id_${parcial.key}`,
    type: "sensitive",
    target: ["preview"],
    gitBranch: null,
    customEnvironmentIds: [],
    ...parcial,
  };
}

describe("constantes", () => {
  it("el proyecto, el equipo y los nombres de variable son los de Pedernal", () => {
    expect(PROYECTO_DE_VERCEL).toBe("prj_BZ5e86RcBcfYCAzSW2vVbPpkj7jG");
    expect(EQUIPO_DE_VERCEL).toBe("alepozod");
    expect(VARIABLE_DEL_TOKEN).toBe("PEDERNAL_VERCEL_TOKEN");
    expect(NOMBRE_DE_LA_CADENA_DE_DUENO).toBe("PEDERNAL_DB_MIGRACIONES");
    expect(VARIABLE_CLAVE_CONTEXTO).toBe("PEDERNAL_CLAVE_CONTEXTO");
    expect(VARIABLE_SECRETO_INVITACIONES).toBe("PEDERNAL_SECRETO_INVITACIONES");
  });
});

describe("leerDestino", () => {
  it("acepta exactamente preview y production", () => {
    expect(leerDestino("preview")).toBe("preview");
    expect(leerDestino("production")).toBe("production");
  });

  it.each(["Preview", "PRODUCTION", "development", "prod", "", " preview"])(
    "rechaza %j",
    (texto) => {
      expect(leerDestino(texto)).toBeNull();
    },
  );

  it("rechaza lo que falta", () => {
    expect(leerDestino(undefined)).toBeNull();
  });
});

describe("sobraEnVercel", () => {
  it.each([
    "BETTER_AUTH_TELEMETRY",
    "BETTER_AUTH_SECRET",
    "BETTER_AUTH_URL",
    "BETTER_AUTH_SECRETS",
    "BETTER_AUTH_TRUSTED_ORIGINS",
    "BETTER_AUTH_TELEMETRY_ENDPOINT",
    "BETTER_AUTH_TELEMETRY_ID",
    "AUTH_SECRET",
    "AUTH_URL",
    "DATABASE_URL",
    "DATABASE_URL_UNPOOLED",
    "POSTGRES_URL",
    "POSTGRES_USER",
    "POSTGRES_",
    "PEDERNAL_DB_MIGRACIONES",
  ])("sobra %s", (nombre) => {
    expect(sobraEnVercel(nombre)).toBe(true);
  });

  it.each([
    "PEDERNAL_DB_APP",
    "PEDERNAL_DB_TRABAJOS",
    "PEDERNAL_DB_PUBLICO",
    "PEDERNAL_CLAVE_CONTEXTO",
    "PEDERNAL_SECRETO_INVITACIONES",
    "MI_POSTGRES_URL",
    "postgres_url",
    "DATABASE_URL_OTRA",
    "BETTER_AUTH",
  ])("no sobra %s", (nombre) => {
    expect(sobraEnVercel(nombre)).toBe(false);
  });
});

describe("leerVariablesRemotas", () => {
  it("lee los campos de cada variable", () => {
    expect(
      leerVariablesRemotas({
        envs: [
          {
            id: "a1",
            key: "PEDERNAL_DB_APP",
            type: "sensitive",
            target: ["preview", "production"],
            gitBranch: "feature-x",
            customEnvironmentIds: ["env_1"],
            value: "no se usa",
          },
        ],
      }),
    ).toEqual([
      {
        id: "a1",
        key: "PEDERNAL_DB_APP",
        type: "sensitive",
        target: ["preview", "production"],
        gitBranch: "feature-x",
        customEnvironmentIds: ["env_1"],
      },
    ]);
  });

  it("completa lo que falta: destino como texto o ausente, rama vacía, tipo desconocido", () => {
    expect(
      leerVariablesRemotas({
        envs: [
          { id: "a", key: "A", target: "preview", gitBranch: "" },
          { id: "b", key: "B", type: 7, gitBranch: null },
          { id: "c", key: "C", target: null, customEnvironmentIds: null },
        ],
      }),
    ).toEqual([
      {
        id: "a",
        key: "A",
        type: "",
        target: ["preview"],
        gitBranch: null,
        customEnvironmentIds: [],
      },
      { id: "b", key: "B", type: "", target: [], gitBranch: null, customEnvironmentIds: [] },
      { id: "c", key: "C", type: "", target: [], gitBranch: null, customEnvironmentIds: [] },
    ]);
  });

  it("una lista vacía es válida: no hay variables", () => {
    expect(leerVariablesRemotas({ envs: [] })).toEqual([]);
  });

  it.each([
    ["sin envs", {}],
    ["envs que no es lista", { envs: "x" }],
    ["cuerpo nulo", null],
    ["cuerpo que no es objeto", "texto"],
    ["una variable nula", { envs: [null] }],
    ["una variable sin id", { envs: [{ key: "A" }] }],
    ["una variable con id numérico", { envs: [{ id: 1, key: "A" }] }],
    ["una variable sin nombre", { envs: [{ id: "a" }] }],
    ["una variable con nombre numérico", { envs: [{ id: "a", key: 1 }] }],
    ["destino con algo que no es texto", { envs: [{ id: "a", key: "A", target: [1] }] }],
    ["destino numérico", { envs: [{ id: "a", key: "A", target: 1 }] }],
    [
      "destino mezclado con algo que no es texto",
      { envs: [{ id: "a", key: "A", target: ["preview", 1] }] },
    ],
    [
      "entornos propios que no son texto",
      { envs: [{ id: "a", key: "A", customEnvironmentIds: [1] }] },
    ],
    ["una buena y una mala", { envs: [{ id: "a", key: "A" }, { key: "B" }] }],
  ])("no se entiende: %s", (_nombre, cuerpo) => {
    expect(leerVariablesRemotas(cuerpo)).toBeNull();
  });
});

describe("generarSecretos", () => {
  it("la clave de contexto es `1:` + 64 dígitos hexadecimales y el secreto de invitaciones, 64", () => {
    const secretos = generarSecretos();
    expect(secretos.map((s) => s.key)).toEqual([
      "PEDERNAL_CLAVE_CONTEXTO",
      "PEDERNAL_SECRETO_INVITACIONES",
    ]);
    expect(secretos[0]?.value).toMatch(/^1:[0-9a-f]{64}$/);
    expect(secretos[1]?.value).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pide 32 bytes por secreto y los pasa a hexadecimal", () => {
    const pedidos: number[] = [];
    let siguiente = 0;
    const secretos = generarSecretos((cuantos) => {
      pedidos.push(cuantos);
      siguiente += 1;
      return new Uint8Array(cuantos).fill(siguiente === 1 ? 0xab : 0x0f);
    });
    expect(pedidos).toEqual([32, 32]);
    expect(secretos[0]?.value).toBe(`1:${"ab".repeat(32)}`);
    expect(secretos[1]?.value).toBe("0f".repeat(32));
  });

  it("son distintos entre sí y entre corridas", () => {
    const a = generarSecretos();
    const b = generarSecretos();
    expect(a[0]?.value.slice(2)).not.toBe(a[1]?.value);
    expect(a[0]?.value).not.toBe(b[0]?.value);
    expect(a[1]?.value).not.toBe(b[1]?.value);
  });
});

describe("planificar", () => {
  const escribir = [
    { key: "PEDERNAL_DB_APP", value: "v1" },
    { key: "PEDERNAL_DB_TRABAJOS", value: "v2" },
  ];

  it("sin nada en Vercel solo escribe, en el orden pedido", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [],
      paraEscribir: escribir,
      intactas: [],
    });
    expect(plan.pasos).toEqual([
      { tipo: "escribir", key: "PEDERNAL_DB_APP", value: "v1" },
      { tipo: "escribir", key: "PEDERNAL_DB_TRABAJOS", value: "v2" },
    ]);
    expect(plan.yaCargadas).toEqual([]);
    expect(plan.faltaRotar).toEqual([]);
  });

  it("una variable que ya es sensible y solo del destino se sobrescribe sin liberarla antes", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [variable({ key: "PEDERNAL_DB_APP" })],
      paraEscribir: escribir,
      intactas: [],
    });
    expect(plan.pasos.map((p) => p.tipo)).toEqual(["escribir", "escribir"]);
  });

  it("una variable compartida con otro destino pierde el pedido, conserva los demás, y recién ahí se escribe", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [
        variable({ key: "PEDERNAL_DB_APP", id: "x1", target: ["production", "preview"] }),
      ],
      paraEscribir: [escribir[0] as { key: string; value: string }],
      intactas: [],
    });
    expect(plan.pasos).toEqual([
      { tipo: "recortar", id: "x1", key: "PEDERNAL_DB_APP", target: ["production"] },
      { tipo: "escribir", key: "PEDERNAL_DB_APP", value: "v1" },
    ]);
  });

  it("una variable no sensible solo del destino se borra antes de escribir", () => {
    const plan = planificar({
      destino: "production",
      existentes: [
        variable({ key: "PEDERNAL_DB_APP", id: "x2", type: "plain", target: ["production"] }),
      ],
      paraEscribir: [escribir[0] as { key: string; value: string }],
      intactas: [],
    });
    expect(plan.pasos).toEqual([
      { tipo: "borrar", id: "x2", key: "PEDERNAL_DB_APP" },
      { tipo: "escribir", key: "PEDERNAL_DB_APP", value: "v1" },
    ]);
  });

  it("una variable atada a una rama se borra antes de escribir (pisaría a la general)", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [variable({ key: "PEDERNAL_DB_APP", id: "x3", gitBranch: "main" })],
      paraEscribir: [escribir[0] as { key: string; value: string }],
      intactas: [],
    });
    expect(plan.pasos[0]).toEqual({ tipo: "borrar", id: "x3", key: "PEDERNAL_DB_APP" });
  });

  it("una variable con entornos propios no se borra entera: se le quita el destino", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [variable({ key: "PEDERNAL_DB_APP", id: "x4", customEnvironmentIds: ["env_1"] })],
      paraEscribir: [escribir[0] as { key: string; value: string }],
      intactas: [],
    });
    expect(plan.pasos[0]).toEqual({
      tipo: "recortar",
      id: "x4",
      key: "PEDERNAL_DB_APP",
      target: [],
    });
  });

  it("lo que vale solo para otro destino, o es de otro nombre, no se toca", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [
        variable({ key: "PEDERNAL_DB_APP", target: ["production"], type: "plain" }),
        variable({ key: "OTRA", type: "plain", target: ["preview", "production"], gitBranch: "x" }),
      ],
      paraEscribir: [escribir[0] as { key: string; value: string }],
      intactas: [],
    });
    expect(plan.pasos).toEqual([{ tipo: "escribir", key: "PEDERNAL_DB_APP", value: "v1" }]);
  });

  it("borra del destino lo prohibido y la cadena de dueño, después de las escrituras", () => {
    const plan = planificar({
      destino: "production",
      existentes: [
        variable({ key: "DATABASE_URL", id: "p1", target: ["production"] }),
        variable({ key: "POSTGRES_URL", id: "p2", target: ["production"], type: "encrypted" }),
        variable({
          key: "PEDERNAL_DB_MIGRACIONES",
          id: "p3",
          target: ["production"],
          type: "plain",
        }),
        variable({ key: "BETTER_AUTH_SECRET", id: "p4", target: ["production"] }),
      ],
      paraEscribir: escribir,
      intactas: [],
    });
    expect(plan.pasos).toEqual([
      { tipo: "escribir", key: "PEDERNAL_DB_APP", value: "v1" },
      { tipo: "escribir", key: "PEDERNAL_DB_TRABAJOS", value: "v2" },
      { tipo: "borrar", id: "p1", key: "DATABASE_URL" },
      { tipo: "borrar", id: "p2", key: "POSTGRES_URL" },
      { tipo: "borrar", id: "p3", key: "PEDERNAL_DB_MIGRACIONES" },
      { tipo: "borrar", id: "p4", key: "BETTER_AUTH_SECRET" },
    ]);
  });

  it("una prohibida compartida solo pierde el destino pedido; la de otro destino no se toca", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [
        variable({
          key: "DATABASE_URL",
          id: "c1",
          target: ["production", "preview", "development"],
        }),
        variable({ key: "DATABASE_URL_UNPOOLED", id: "c2", target: ["production"] }),
        variable({ key: "POSTGRES_USER", id: "c3", target: ["preview"] }),
      ],
      paraEscribir: [],
      intactas: [],
    });
    expect(plan.pasos).toEqual([
      { tipo: "recortar", id: "c1", key: "DATABASE_URL", target: ["production", "development"] },
      { tipo: "borrar", id: "c3", key: "POSTGRES_USER" },
    ]);
  });

  it("separa los roles intactos: con la variable en el destino ya están; sin ella (o solo en otro destino) falta rotar", () => {
    const plan = planificar({
      destino: "preview",
      existentes: [
        variable({ key: "PEDERNAL_DB_APP", target: ["preview"] }),
        variable({ key: "PEDERNAL_DB_TRABAJOS", target: ["production"] }),
      ],
      paraEscribir: [],
      intactas: ["PEDERNAL_DB_APP", "PEDERNAL_DB_TRABAJOS", "PEDERNAL_DB_PUBLICO"],
    });
    expect(plan.yaCargadas).toEqual(["PEDERNAL_DB_APP"]);
    expect(plan.faltaRotar).toEqual(["PEDERNAL_DB_TRABAJOS", "PEDERNAL_DB_PUBLICO"]);
    expect(plan.pasos).toEqual([]);
  });
});

describe("generarValor", () => {
  const relleno = (byte: number) => (cuantos: number) => new Uint8Array(cuantos).fill(byte);
  const ascendente = (cuantos: number) => Uint8Array.from({ length: cuantos }, (_, i) => i);

  it("las cinco, con su forma exacta, sacadas de 32 bytes", () => {
    const pedidos: number[] = [];
    const bytes = (cuantos: number) => {
      pedidos.push(cuantos);
      return ascendente(cuantos);
    };
    const hex = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";
    expect(generarValor("PEDERNAL_CLAVE_CONTEXTO", bytes)).toBe(`1:${hex}`);
    expect(generarValor("PEDERNAL_CLAVE_CERTIFICADOS", bytes)).toBe(`c1:${hex}`);
    expect(generarValor("PEDERNAL_SECRETO_INVITACIONES", bytes)).toBe(hex);
    expect(generarValor("PEDERNAL_AUTH_SECRETO_EMPRESA", bytes)).toBe(hex);
    expect(generarValor("CRON_SECRET", bytes)).toBe(hex);
    expect(pedidos).toEqual([32, 32, 32, 32, 32]);
  });

  it("por defecto usa el azar real: dos valores no se repiten", () => {
    for (const nombre of VARIABLES_GENERABLES) {
      expect(generarValor(nombre)).not.toBe(generarValor(nombre));
    }
  });

  it.each([
    VARIABLE_SECRETO_DE_AUTENTICACION,
    VARIABLE_SECRETO_DEL_CRON,
    VARIABLE_CLAVE_CERTIFICADOS,
  ] as const)("%s exige variedad: con 9 caracteres distintos falla y con 10 sirve", (nombre) => {
    expect(CARACTERES_DISTINTOS_PEDIDOS).toBe(10);
    // 9 dígitos distintos: falla; 10: sirve (el piso está en el límite exacto).
    const con = (distintos: number) => (cuantos: number) =>
      Uint8Array.from({ length: cuantos }, (_, i) => {
        const d = i % distintos;
        return d * 16 + d;
      });
    expect(() => generarValor(nombre, con(9))).toThrow(
      new RangeError(`no se pudo generar ${nombre}: lo sorteado tiene muy poca variedad`),
    );
    expect(() => generarValor(nombre, con(10))).not.toThrow();
  });

  it("el error no repite lo sorteado", () => {
    try {
      generarValor(VARIABLE_SECRETO_DEL_CRON, relleno(0xab));
      expect.unreachable();
    } catch (falla) {
      expect(String(falla)).not.toContain("abab");
    }
  });

  it("la clave de contexto y el secreto de invitaciones no piden variedad (su validador no la pide)", () => {
    expect(generarValor("PEDERNAL_CLAVE_CONTEXTO", relleno(0))).toBe(`1:${"00".repeat(32)}`);
    expect(generarValor("PEDERNAL_SECRETO_INVITACIONES", relleno(0))).toBe("00".repeat(32));
  });

  it("las generables son exactamente estas cinco, en este orden", () => {
    expect(VARIABLES_GENERABLES).toEqual([
      "PEDERNAL_SECRETO_INVITACIONES",
      "PEDERNAL_AUTH_SECRETO_EMPRESA",
      "CRON_SECRET",
      "PEDERNAL_CLAVE_CERTIFICADOS",
      "PEDERNAL_CLAVE_CONTEXTO",
    ]);
  });
});

describe("leerTokenDeVercel", () => {
  it("devuelve el token sin blancos en los extremos", () => {
    expect(leerTokenDeVercel({ PEDERNAL_VERCEL_TOKEN: "  vcp_Token123\n" })).toEqual({
      token: "vcp_Token123",
    });
  });

  it("el texto de cuando falta es éste, entero", () => {
    expect(leerTokenDeVercel({})).toEqual({
      problema:
        "falta la variable PEDERNAL_VERCEL_TOKEN: es el token con el que este comando escribe en Vercel. " +
        "Para crearlo: entrá a vercel.com, abrí Settings de tu cuenta > Tokens, creá uno con alcance limitado " +
        "al equipo «alepozod» y vencimiento corto, y ponelo en esa variable de entorno de la terminal " +
        "(no lo pegues en ningún archivo ni en un chat).",
    });
  });

  it.each([undefined, "", "   "])("sin token (%j) explica cómo crearlo", (valor) => {
    const r = leerTokenDeVercel({ PEDERNAL_VERCEL_TOKEN: valor });
    expect(r).toHaveProperty("problema");
    const { problema } = r as { problema: string };
    for (const parte of [
      "falta la variable PEDERNAL_VERCEL_TOKEN",
      "vercel.com",
      "Settings",
      "Tokens",
      "alepozod",
      "vencimiento corto",
    ]) {
      expect(problema).toContain(parte);
    }
  });

  it.each(["con espacio", "con\nsalto", "ñandú", "tab\tulado"])(
    "un token raro (%j) se rechaza sin repetirlo",
    (valor) => {
      const r = leerTokenDeVercel({ PEDERNAL_VERCEL_TOKEN: valor }) as { problema: string };
      expect(r.problema).toBe(
        "PEDERNAL_VERCEL_TOKEN tiene espacios, saltos de línea o letras raras: copialo de nuevo.",
      );
    },
  );
});

describe("noDebeEstarEnVercel", () => {
  it("incluye todo lo que `--vercel` borra, y además la cadena de GitHub y los roles que la web no recibe", () => {
    for (const nombre of [
      "DATABASE_URL",
      "BETTER_AUTH_SECRET",
      "POSTGRES_URL",
      "PEDERNAL_DB_MIGRACIONES",
    ]) {
      expect(noDebeEstarEnVercel(nombre)).toBe(true);
      expect(sobraEnVercel(nombre)).toBe(true);
    }
    for (const nombre of [
      "PEDERNAL_DB_DUENO_DIRECTA",
      "PEDERNAL_DB_PLATAFORMA",
      "PEDERNAL_DB_GRUPO",
    ]) {
      expect(noDebeEstarEnVercel(nombre)).toBe(true);
      // Esas tres solo se informan: `--vercel` no las borra.
      expect(sobraEnVercel(nombre)).toBe(false);
    }
    for (const nombre of ["PEDERNAL_DB_APP", "CRON_SECRET", "VERCEL_ENV", "PEDERNAL_DB_PUBLICO"]) {
      expect(noDebeEstarEnVercel(nombre)).toBe(false);
    }
  });
});
