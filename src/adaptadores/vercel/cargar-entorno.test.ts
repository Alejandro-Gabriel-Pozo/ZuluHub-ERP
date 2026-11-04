import { describe, expect, it } from "vitest";
import {
  VARIABLES_A_MANO,
  cargarEntorno,
  lineasDelInforme,
  type BaseDeLaClave,
  type EntradaDeCargaDeEntorno,
  type Informe,
} from "./cargar-entorno";
import type { ClienteDeVariables, FallaDeVercel, RespuestaDeVercel } from "./cliente-vercel";
import {
  VARIABLES_GENERABLES,
  VARIABLE_CLAVE_CERTIFICADOS,
  VARIABLE_CLAVE_CONTEXTO,
  VARIABLE_SECRETO_DE_AUTENTICACION,
  VARIABLE_SECRETO_DEL_CRON,
  VARIABLE_SECRETO_INVITACIONES,
  type Destino,
  type VariableRemota,
} from "./plan-de-variables";

/**
 * `cargarEntorno` con un Vercel y una base en memoria. Los valores generados (y su parte secreta) no se saben de
 * antemano: cada prueba los lee de lo que quedó guardado en el Vercel falso y comprueba que no aparecen en ningún lado.
 */

function remota(key: string, parcial: Partial<VariableRemota> = {}): VariableRemota {
  return {
    id: `id_${key}_${(parcial.target ?? ["preview"]).join("")}`,
    key,
    type: "sensitive",
    target: ["preview"],
    gitBranch: null,
    customEnvironmentIds: [],
    ...parcial,
  };
}

const fallo = (motivo: string, incierta = false): RespuestaDeVercel<never> => ({
  ok: false,
  error: { motivo, incierta } satisfies FallaDeVercel,
});
const ok = { ok: true, valor: null } as const;

type Llamada = Readonly<{ tipo: string; clave: string; pisar?: boolean }>;

type Comportamiento = Readonly<{
  /** Qué hace el intento número `n` (desde 1) de escribir `clave`. */
  escribir?: (
    clave: string,
    n: number,
  ) => "ok" | "falla" | "falla-pero-se-aplico" | "falla-incierta";
  /** Qué hace la lectura número `n` (desde 1). */
  listar?: (n: number) => "ok" | "falla";
  /** Cambia lo que Vercel devuelve en la lectura número `n` (para que lo guardado figure distinto de lo pedido). */
  alListar?: (n: number, variables: readonly VariableRemota[]) => readonly VariableRemota[];
}>;

function vercelEnMemoria(
  iniciales: readonly VariableRemota[],
  comportamiento: Comportamiento = {},
) {
  const variables = [...iniciales];
  const valores = new Map<string, string>();
  const llamadas: Llamada[] = [];
  const eventos: string[] = [];
  let lecturas = 0;
  const intentos = new Map<string, number>();
  const cliente: ClienteDeVariables = {
    listar: () => {
      lecturas += 1;
      eventos.push("listar");
      if (comportamiento.listar?.(lecturas) === "falla") {
        return Promise.resolve(fallo("Vercel no contestó a tiempo", true));
      }
      return Promise.resolve({
        ok: true,
        valor: comportamiento.alListar?.(lecturas, variables) ?? [...variables],
      });
    },
    escribir: (clave, valor, destino, opciones) => {
      const n = (intentos.get(clave) ?? 0) + 1;
      intentos.set(clave, n);
      llamadas.push({ tipo: "escribir", clave, pisar: opciones?.pisar ?? true });
      eventos.push(`escribir ${clave}`);
      const que = comportamiento.escribir?.(clave, n) ?? "ok";
      const existe = variables.some((v) => v.key === clave && v.target.includes(destino));
      if (que === "falla") return Promise.resolve(fallo("Vercel respondió 500: falla", false));
      if (que === "falla-incierta") {
        return Promise.resolve(fallo("Vercel no contestó a tiempo", true));
      }
      if (existe && opciones?.pisar === false) {
        return Promise.resolve(fallo("Vercel rechazó el pedido (ENV_CONFLICT)", false));
      }
      variables.push(remota(clave, { target: [destino] }));
      valores.set(clave, valor);
      if (que === "falla-pero-se-aplico")
        return Promise.resolve(fallo("no se pudo confirmar", true));
      return Promise.resolve(ok);
    },
    borrar: (id) => {
      llamadas.push({ tipo: "borrar", clave: id });
      return Promise.resolve(ok);
    },
    quitarDestinos: (id) => {
      llamadas.push({ tipo: "quitar", clave: id });
      return Promise.resolve(ok);
    },
  };
  return { cliente, variables, valores, llamadas, eventos };
}

/** Una base falsa: lleva la cuenta de lo instalado y anota en el mismo registro de eventos que el Vercel falso. */
function baseEnMemoria(
  eventos: string[],
  opciones: {
    claves?: number;
    instalar?: "ok" | "falla";
    hay?: "ok" | "falla";
  } = {},
) {
  let instaladas = opciones.claves ?? 0;
  const instaladasAhora: string[] = [];
  const base: BaseDeLaClave = {
    hayClavesInstaladas: () => {
      eventos.push("base: hay claves?");
      return Promise.resolve(
        opciones.hay === "falla"
          ? { ok: false, motivo: "la base no aceptó la conexión" }
          : { ok: true, hay: instaladas > 0 },
      );
    },
    instalar: (clave) => {
      eventos.push("base: instalar");
      if (opciones.instalar === "falla") {
        return Promise.resolve({ ok: false, motivo: "la base rechazó la instalación" });
      }
      instaladas += 1;
      instaladasAhora.push(clave);
      return Promise.resolve({ ok: true });
    },
  };
  return { base, instaladasAhora, instaladas: () => instaladas };
}

function correr(
  vercel: ReturnType<typeof vercelEnMemoria>,
  base: BaseDeLaClave | null,
  extra: Partial<EntradaDeCargaDeEntorno> = {},
) {
  const tapados: string[] = [];
  const entrada: EntradaDeCargaDeEntorno = {
    destino: "preview",
    cliente: vercel.cliente,
    base,
    tapar: (secreto) => {
      vercel.eventos.push("tapar");
      tapados.push(secreto);
    },
    ...extra,
  };
  return { tapados, informe: cargarEntorno(entrada) };
}

const estadoDe = (informe: Informe, nombre: string) =>
  informe.generables.find((f) => f.nombre === nombre)?.estado;
const estados = (informe: Informe) => informe.generables.map((f) => `${f.nombre}: ${f.estado}`);
const sinContexto = VARIABLES_GENERABLES.filter((n) => n !== VARIABLE_CLAVE_CONTEXTO);

describe("cargarEntorno: crea solo las que faltan", () => {
  it("con todo vacío crea las cinco, como sensibles y solo en el destino, y las deja en orden", async () => {
    const vercel = vercelEnMemoria([]);
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos);
    const { informe, tapados } = correr(vercel, base);
    const r = await informe;
    expect(estados(r)).toEqual(VARIABLES_GENERABLES.map((n) => `${n}: creada`));
    expect(r.ok).toBe(true);
    expect(r.detenido).toBeNull();
    expect(vercel.llamadas.map((l) => l.clave)).toEqual([...sinContexto, VARIABLE_CLAVE_CONTEXTO]);
    expect(vercel.variables.map((v) => [v.key, v.type, v.target.join()] as const).sort()).toEqual(
      VARIABLES_GENERABLES.map((n) => [n, "sensitive", "preview"] as const).sort(),
    );
    // La que se instaló en la base es la misma que quedó en Vercel.
    expect(instaladasAhora).toEqual([vercel.valores.get(VARIABLE_CLAVE_CONTEXTO)]);
    // Cada valor se entregó para taparlo (y la parte secreta de las dos claves `<kid>:<hex>`).
    for (const valor of vercel.valores.values()) expect(tapados).toContain(valor);
    expect(tapados).toContain((vercel.valores.get(VARIABLE_CLAVE_CONTEXTO) ?? "").slice(2));
    expect(tapados).toContain((vercel.valores.get(VARIABLE_CLAVE_CERTIFICADOS) ?? "").slice(3));
  });

  it("solo crea las que faltan: no escribe ni pisa las que ya estaban", async () => {
    const vercel = vercelEnMemoria([
      remota(VARIABLE_SECRETO_DEL_CRON),
      remota(VARIABLE_SECRETO_INVITACIONES),
    ]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(estados(r)).toEqual([
      `${VARIABLE_SECRETO_INVITACIONES}: ya existía`,
      `${VARIABLE_SECRETO_DE_AUTENTICACION}: creada`,
      `${VARIABLE_SECRETO_DEL_CRON}: ya existía`,
      `${VARIABLE_CLAVE_CERTIFICADOS}: creada`,
      `${VARIABLE_CLAVE_CONTEXTO}: creada`,
    ]);
    expect(vercel.llamadas.map((l) => l.clave)).toEqual([
      VARIABLE_SECRETO_DE_AUTENTICACION,
      VARIABLE_CLAVE_CERTIFICADOS,
      VARIABLE_CLAVE_CONTEXTO,
    ]);
  });

  it("lo que existe solo en el OTRO destino cuenta como faltante, y esa variable no se toca", async () => {
    const deProduccion = remota(VARIABLE_SECRETO_DEL_CRON, { target: ["production"] });
    const vercel = vercelEnMemoria([deProduccion]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base, { destino: "preview" }).informe;
    expect(estadoDe(r, VARIABLE_SECRETO_DEL_CRON)).toBe("creada");
    expect(vercel.variables.filter((v) => v.key === VARIABLE_SECRETO_DEL_CRON)).toEqual([
      deProduccion,
      expect.objectContaining({ target: ["preview"], type: "sensitive" }),
    ]);
    expect(vercel.llamadas.some((l) => l.tipo !== "escribir")).toBe(false);
  });

  it("en production escribe solo en production", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base, { destino: "production" as Destino }).informe;
    expect(r.ok).toBe(true);
    expect(vercel.variables.every((v) => v.target.join() === "production")).toBe(true);
  });
});

describe("cargarEntorno: nunca sobrescribe", () => {
  it("con las cinco ya cargadas no escribe nada, no toca la base y ni siquiera genera un valor", async () => {
    const vercel = vercelEnMemoria(VARIABLES_GENERABLES.map((n) => remota(n)));
    const { base } = baseEnMemoria(vercel.eventos);
    const { informe, tapados } = correr(vercel, base);
    const r = await informe;
    expect(estados(r)).toEqual(VARIABLES_GENERABLES.map((n) => `${n}: ya existía`));
    expect(r.ok).toBe(true);
    expect(vercel.llamadas).toEqual([]);
    expect(vercel.eventos).toEqual(["listar"]);
    expect(tapados).toEqual([]);
  });

  it("toda escritura va sin `upsert` (pisar: false): una variable que apareció entre la lectura y la escritura no se pisa", async () => {
    // La lectura no la ve, pero la escritura la encuentra: Vercel rechaza y la variable sigue intacta.
    const vercel = vercelEnMemoria([]);
    const original = remota(VARIABLE_SECRETO_DE_AUTENTICACION);
    const cliente: ClienteDeVariables = {
      ...vercel.cliente,
      listar: () => Promise.resolve({ ok: true, valor: [] }),
    };
    vercel.variables.push(original);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await cargarEntorno({
      destino: "preview",
      cliente,
      base,
      tapar: () => undefined,
    });
    expect(estadoDe(r, VARIABLE_SECRETO_DE_AUTENTICACION)).toBe("no se pudo cargar");
    expect(vercel.valores.has(VARIABLE_SECRETO_DE_AUTENTICACION)).toBe(false);
    expect(vercel.variables.filter((v) => v.key === VARIABLE_SECRETO_DE_AUTENTICACION)).toEqual([
      original,
    ]);
    expect(
      vercel.llamadas.filter((l) => l.tipo === "escribir").every((l) => l.pisar === false),
    ).toBe(true);
    expect(r.ok).toBe(false);
  });

  it("PEDERNAL_CLAVE_CERTIFICADOS ya cargada no se rota nunca, aunque todo lo demás falte", async () => {
    const vercel = vercelEnMemoria([remota(VARIABLE_CLAVE_CERTIFICADOS)]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(estadoDe(r, VARIABLE_CLAVE_CERTIFICADOS)).toBe("ya existía");
    expect(vercel.llamadas.map((l) => l.clave)).not.toContain(VARIABLE_CLAVE_CERTIFICADOS);
  });

  it("una existente rara se saltea igual y avisa qué tiene de raro (sin valores)", async () => {
    const vercel = vercelEnMemoria([
      remota(VARIABLE_SECRETO_DEL_CRON, { type: "plain" }),
      remota(VARIABLE_SECRETO_INVITACIONES, { target: ["preview", "production"] }),
      remota(VARIABLE_SECRETO_DE_AUTENTICACION, { gitBranch: "una-rama" }),
      remota(VARIABLE_CLAVE_CERTIFICADOS, { customEnvironmentIds: ["env_x"] }),
      remota(VARIABLE_CLAVE_CONTEXTO),
    ]);
    const r = await correr(vercel, null).informe;
    expect(r.generables.map((f) => [f.nombre, f.estado, f.nota])).toEqual([
      [VARIABLE_SECRETO_INVITACIONES, "ya existía", "vale también para otro destino"],
      [VARIABLE_SECRETO_DE_AUTENTICACION, "ya existía", "está atada a una rama"],
      [VARIABLE_SECRETO_DEL_CRON, "ya existía", "no es sensible"],
      [VARIABLE_CLAVE_CERTIFICADOS, "ya existía", "vale también para un entorno personalizado"],
      [VARIABLE_CLAVE_CONTEXTO, "ya existía", null],
    ]);
    expect(vercel.llamadas).toEqual([]);
  });
});

describe("cargarEntorno: nunca devuelve ni imprime un valor", () => {
  /** Todo lo que sale: el informe, sus líneas y los errores (aquí, lo que devuelve cada camino). */
  const salida = (informe: Informe) =>
    JSON.stringify(informe) + "\n" + JSON.stringify(lineasDelInforme(informe));

  it("cuando todo sale bien", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    for (const valor of vercel.valores.values()) {
      expect(salida(r)).not.toContain(valor);
      const secreto = valor.slice(valor.indexOf(":") + 1);
      expect(salida(r)).not.toContain(secreto);
    }
    expect(vercel.valores.size).toBeGreaterThan(0);
  });

  it("tampoco cuando algo falla: Vercel, la instalación o el reintento", async () => {
    const casos: Comportamiento[] = [
      { escribir: (c) => (c === VARIABLE_SECRETO_DEL_CRON ? "falla" : "ok") },
      { escribir: (c) => (c === VARIABLE_CLAVE_CONTEXTO ? "falla" : "ok") },
      { escribir: () => "falla-incierta" },
      { listar: (n) => (n >= 2 ? "falla" : "ok") },
    ];
    for (const comportamiento of casos) {
      const vercel = vercelEnMemoria([], comportamiento);
      const { base } = baseEnMemoria(vercel.eventos);
      const { informe, tapados } = correr(vercel, base);
      const r = await informe;
      for (const valor of [...vercel.valores.values(), ...tapados]) {
        expect(salida(r)).not.toContain(valor);
      }
    }
    const vercel = vercelEnMemoria([]);
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos, { instalar: "falla" });
    const r = await correr(vercel, base).informe;
    expect(instaladasAhora).toEqual([]);
    for (const valor of vercel.valores.values()) expect(salida(r)).not.toContain(valor);
  });

  it("cada valor llega a `tapar` ANTES de la primera escritura", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    await correr(vercel, base).informe;
    const primeraEscritura = vercel.eventos.findIndex((e) => e.startsWith("escribir"));
    const ultimoTapado = vercel.eventos.lastIndexOf("tapar");
    expect(primeraEscritura).toBeGreaterThan(0);
    expect(ultimoTapado).toBeLessThan(primeraEscritura);
  });
});

describe("cargarEntorno: la clave de contexto", () => {
  it("se INSTALA en la base antes de cargarse en Vercel, y primero se mira la base", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    await correr(vercel, base).informe;
    const sinTapar = vercel.eventos.filter((e) => e !== "tapar");
    expect(sinTapar).toEqual([
      "listar",
      "base: hay claves?",
      ...sinContexto.map((n) => `escribir ${n}`),
      "listar", // la verificación de lo cargado
      "base: instalar",
      `escribir ${VARIABLE_CLAVE_CONTEXTO}`,
      "listar",
    ]);
  });

  it("si la instalación falla, NO se carga en Vercel (y lo demás igual quedó cargado)", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos, { instalar: "falla" });
    const r = await correr(vercel, base).informe;
    expect(vercel.llamadas.map((l) => l.clave)).not.toContain(VARIABLE_CLAVE_CONTEXTO);
    expect(vercel.valores.has(VARIABLE_CLAVE_CONTEXTO)).toBe(false);
    const fila = r.generables.find((f) => f.nombre === VARIABLE_CLAVE_CONTEXTO);
    expect(fila?.estado).toBe("no se pudo cargar");
    expect(fila?.nota).toBe(
      "no se pudo instalar en la base (la base rechazó la instalación); no se cargó en Vercel",
    );
    expect(estadoDe(r, VARIABLE_SECRETO_DEL_CRON)).toBe("creada");
    expect(r.ok).toBe(false);
  });

  it("si una carga anterior falló en Vercel, ni siquiera se instala la clave", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (clave === VARIABLE_SECRETO_DE_AUTENTICACION ? "falla" : "ok"),
    });
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(instaladasAhora).toEqual([]);
    expect(estados(r)).toEqual([
      `${VARIABLE_SECRETO_INVITACIONES}: creada`,
      `${VARIABLE_SECRETO_DE_AUTENTICACION}: no se pudo cargar`,
      `${VARIABLE_SECRETO_DEL_CRON}: no se intentó`,
      `${VARIABLE_CLAVE_CERTIFICADOS}: no se intentó`,
      `${VARIABLE_CLAVE_CONTEXTO}: no se intentó`,
    ]);
    expect(r.ok).toBe(false);
  });

  it("la base YA tiene una clave y Vercel no: PARA antes de cambiar nada, con un mensaje claro", async () => {
    const vercel = vercelEnMemoria([remota(VARIABLE_SECRETO_DEL_CRON)]);
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos, { claves: 1 });
    const { informe, tapados } = correr(vercel, base);
    const r = await informe;
    expect(r.ok).toBe(false);
    expect(r.detenido).toContain("ya tiene una clave de contexto instalada");
    expect(r.detenido).toContain("no tiene PEDERNAL_CLAVE_CONTEXTO");
    expect(r.detenido).toContain("Lo decide el dueño");
    expect(r.detenido).toContain("No se cargó nada");
    expect(vercel.llamadas).toEqual([]);
    expect(instaladasAhora).toEqual([]);
    expect(tapados).toEqual([]);
    expect(estados(r)).toEqual([
      `${VARIABLE_SECRETO_INVITACIONES}: no se intentó`,
      `${VARIABLE_SECRETO_DE_AUTENTICACION}: no se intentó`,
      `${VARIABLE_SECRETO_DEL_CRON}: ya existía`,
      `${VARIABLE_CLAVE_CERTIFICADOS}: no se intentó`,
      `${VARIABLE_CLAVE_CONTEXTO}: no se intentó`,
    ]);
    expect(lineasDelInforme(r).error[0]).toMatch(/^SE DETUVO: la base de PREVIEW ya tiene/);
  });

  it("si Vercel ya tiene la clave no se mira la base ni se instala nada (aunque la base tenga otra)", async () => {
    const vercel = vercelEnMemoria([remota(VARIABLE_CLAVE_CONTEXTO)]);
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos, { claves: 3 });
    const r = await correr(vercel, base).informe;
    expect(vercel.eventos).not.toContain("base: hay claves?");
    expect(instaladasAhora).toEqual([]);
    expect(estadoDe(r, VARIABLE_CLAVE_CONTEXTO)).toBe("ya existía");
    expect(r.ok).toBe(true);
  });

  it("si no se puede mirar la base, PARA antes de cambiar nada", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos, { hay: "falla" });
    const { informe, tapados } = correr(vercel, base);
    const r = await informe;
    expect(r.detenido).toBe(
      "no se pudo mirar si la base ya tiene una clave de contexto: la base no aceptó la conexión. No se cambió nada.",
    );
    expect(vercel.llamadas).toEqual([]);
    expect(tapados).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it("sin cadena de la base: la clave de contexto queda para el dueño y lo demás se carga", async () => {
    const vercel = vercelEnMemoria([]);
    const r = await correr(vercel, null).informe;
    expect(estadoDe(r, VARIABLE_CLAVE_CONTEXTO)).toBe("falta que la cargues vos");
    expect(vercel.llamadas.map((l) => l.clave)).toEqual(sinContexto);
    expect(r.ok).toBe(false);
    expect(lineasDelInforme(r).error.join("\n")).toContain(
      `${VARIABLE_CLAVE_CONTEXTO}: falta que la cargues vos (falta la cadena de la base`,
    );
  });

  it("tras instalarla, si Vercel falla antes de aplicar, relee, reintenta UNA vez y queda cargada", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave, n) => (clave === VARIABLE_CLAVE_CONTEXTO && n === 1 ? "falla" : "ok"),
    });
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(estadoDe(r, VARIABLE_CLAVE_CONTEXTO)).toBe("creada");
    expect(vercel.llamadas.filter((l) => l.clave === VARIABLE_CLAVE_CONTEXTO)).toHaveLength(2);
    expect(r.ok).toBe(true);
  });

  it("tras instalarla, si Vercel la aplicó pero la respuesta se perdió, lo confirma releyendo y NO escribe de nuevo", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (clave === VARIABLE_CLAVE_CONTEXTO ? "falla-pero-se-aplico" : "ok"),
    });
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    const fila = r.generables.find((f) => f.nombre === VARIABLE_CLAVE_CONTEXTO);
    expect(fila).toEqual({
      nombre: VARIABLE_CLAVE_CONTEXTO,
      estado: "creada",
      nota: "confirmada al volver a leer Vercel",
    });
    expect(vercel.llamadas.filter((l) => l.clave === VARIABLE_CLAVE_CONTEXTO)).toHaveLength(1);
  });

  it("instalada pero imposible de cargar en Vercel: lo dice sin rodeos (quedó huérfana) y la corrida falla", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (clave === VARIABLE_CLAVE_CONTEXTO ? "falla" : "ok"),
    });
    const { base, instaladas } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    const fila = r.generables.find((f) => f.nombre === VARIABLE_CLAVE_CONTEXTO);
    expect(fila?.estado).toBe("no se pudo cargar");
    expect(fila?.nota).toContain("quedó instalada en la base pero NO en Vercel");
    expect(fila?.nota).toContain("Lo decide el dueño");
    expect(instaladas()).toBe(1);
    expect(r.ok).toBe(false);
  });

  it("si Vercel contesta pero la variable no quedó como sensible, no se da por cargada", async () => {
    const vercel = vercelEnMemoria([]);
    const cliente: ClienteDeVariables = {
      ...vercel.cliente,
      listar: async () => {
        const lectura = await vercel.cliente.listar();
        return lectura.ok
          ? {
              ok: true,
              valor: lectura.valor.map((v) =>
                v.key === VARIABLE_CLAVE_CONTEXTO ? { ...v, type: "plain" } : v,
              ),
            }
          : lectura;
      },
    };
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await cargarEntorno({ destino: "preview", cliente, base, tapar: () => undefined });
    const fila = r.generables.find((f) => f.nombre === VARIABLE_CLAVE_CONTEXTO);
    expect(fila?.estado).toBe("no se pudo cargar");
    expect(fila?.nota).toContain(
      "quedó instalada en la base pero NO en Vercel (Vercel la guardó distinta de lo pedido",
    );
  });
});

describe("cargarEntorno: fallas parciales y repetir el flujo", () => {
  it("si falla la lectura inicial de Vercel no se cambia nada", async () => {
    const vercel = vercelEnMemoria([], { listar: () => "falla" });
    const { base } = baseEnMemoria(vercel.eventos);
    const { informe, tapados } = correr(vercel, base);
    const r = await informe;
    expect(r.detenido).toBe(
      "no se pudo leer el proyecto de Vercel (equipo alepozod): Vercel no contestó a tiempo. No se cambió nada.",
    );
    expect(vercel.llamadas).toEqual([]);
    expect(tapados).toEqual([]);
    expect(r.ok).toBe(false);
    expect(r.generables.every((f) => f.estado === "no se intentó")).toBe(true);
  });

  it("frena en la primera falla de Vercel: la anterior queda creada, la que falló lo dice, el resto no se intenta", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (clave === VARIABLE_SECRETO_DEL_CRON ? "falla-incierta" : "ok"),
    });
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(estados(r)).toEqual([
      `${VARIABLE_SECRETO_INVITACIONES}: creada`,
      `${VARIABLE_SECRETO_DE_AUTENTICACION}: creada`,
      `${VARIABLE_SECRETO_DEL_CRON}: no se pudo cargar`,
      `${VARIABLE_CLAVE_CERTIFICADOS}: no se intentó`,
      `${VARIABLE_CLAVE_CONTEXTO}: no se intentó`,
    ]);
    expect(r.generables[2]?.nota).toBe(
      "Vercel no contestó a tiempo (no se sabe si Vercel llegó a aplicarlo: repetir el flujo es seguro)",
    );
    expect(r.generables[3]?.nota).toBe("antes falló otra carga en Vercel");
    expect(instaladasAhora).toEqual([]);
  });

  it("repetir es seguro: la segunda corrida no escribe nada y deja el mismo estado", async () => {
    const vercel = vercelEnMemoria([]);
    const { base, instaladas } = baseEnMemoria(vercel.eventos);
    const primera = await correr(vercel, base).informe;
    expect(primera.ok).toBe(true);
    const foto = JSON.stringify([...vercel.variables]);
    const valores = JSON.stringify([...vercel.valores]);
    const escrituras = vercel.llamadas.length;
    vercel.eventos.length = 0;
    const segunda = await correr(vercel, base).informe;
    expect(estados(segunda)).toEqual(VARIABLES_GENERABLES.map((n) => `${n}: ya existía`));
    expect(segunda.ok).toBe(true);
    expect(vercel.llamadas).toHaveLength(escrituras);
    expect(JSON.stringify([...vercel.variables])).toBe(foto);
    expect(JSON.stringify([...vercel.valores])).toBe(valores);
    expect(instaladas()).toBe(1);
    expect(vercel.eventos).toEqual(["listar"]);
  });

  it("repetir después de una falla completa lo que faltó sin tocar lo ya cargado ni duplicar la clave de la base", async () => {
    let fallar = true;
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (fallar && clave === VARIABLE_CLAVE_CERTIFICADOS ? "falla" : "ok"),
    });
    const { base, instaladas } = baseEnMemoria(vercel.eventos);
    const primera = await correr(vercel, base).informe;
    expect(primera.ok).toBe(false);
    const valorPrevio = vercel.valores.get(VARIABLE_SECRETO_INVITACIONES);
    fallar = false;
    const segunda = await correr(vercel, base).informe;
    expect(estados(segunda)).toEqual([
      `${VARIABLE_SECRETO_INVITACIONES}: ya existía`,
      `${VARIABLE_SECRETO_DE_AUTENTICACION}: ya existía`,
      `${VARIABLE_SECRETO_DEL_CRON}: ya existía`,
      `${VARIABLE_CLAVE_CERTIFICADOS}: creada`,
      `${VARIABLE_CLAVE_CONTEXTO}: creada`,
    ]);
    expect(vercel.valores.get(VARIABLE_SECRETO_INVITACIONES)).toBe(valorPrevio);
    expect(instaladas()).toBe(1);
  });
});

describe("cargarEntorno: valores que no sirven", () => {
  it("si lo sorteado no tiene variedad, para antes de cambiar nada", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base, { bytesAlAzar: (n) => new Uint8Array(n) }).informe;
    expect(r.detenido).toBe(
      `no se pudo generar ${VARIABLE_SECRETO_DE_AUTENTICACION}: lo sorteado tiene muy poca variedad. No se cambió nada.`,
    );
    expect(vercel.llamadas).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it("si el generador de bytes falla por otra razón, para antes de cambiar nada y sin repetir su mensaje", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base, {
      bytesAlAzar: () => {
        throw new Error("mensaje-que-no-debe-salir");
      },
    }).informe;
    expect(r.detenido).toBe("falla al generar un valor. No se cambió nada.");
    expect(JSON.stringify(r)).not.toContain("mensaje-que-no-debe-salir");
    expect(vercel.llamadas).toEqual([]);
  });

  it("si la clave de certificados saliera igual a la de contexto, para antes de cambiar nada", async () => {
    const vercel = vercelEnMemoria([]);
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos);
    // Se sortea en el orden de las generables: las tres primeras distintas entre sí; la cuarta (certificados) y la quinta
    // (contexto) iguales. Solo el cotejo de ESAS dos tiene que dispararse.
    let sorteos = 0;
    const r = await correr(vercel, base, {
      bytesAlAzar: (n) => {
        sorteos += 1;
        return Uint8Array.from({ length: n }, (_, i) =>
          sorteos < 4 ? (i * 7 + sorteos * 3) % 256 : i,
        );
      },
    }).informe;
    expect(sorteos).toBe(5);
    expect(r.detenido).toBe(
      `${VARIABLE_CLAVE_CERTIFICADOS} salió igual a ${VARIABLE_CLAVE_CONTEXTO}: no puede ser la misma. No se cambió nada.`,
    );
    expect(vercel.llamadas).toEqual([]);
    expect(instaladasAhora).toEqual([]);
  });
});

describe("cargarEntorno: el chequeo de lo que no debe existir y las de mano", () => {
  const ESTADO = [
    remota("DATABASE_URL"),
    remota("BETTER_AUTH_SECRET", { target: ["preview", "production"] }),
    remota("POSTGRES_URL"),
    remota("PEDERNAL_DB_MIGRACIONES"),
    remota("PEDERNAL_DB_DUENO_DIRECTA"),
    remota("PEDERNAL_DB_PLATAFORMA"),
    remota("PEDERNAL_DB_GRUPO"),
    remota("AUTH_URL", { target: ["production"] }),
    remota("PEDERNAL_DB_APP"),
    remota("PEDERNAL_URL_BASE"),
    remota("GOOGLE_CLIENT_ID", { target: ["production"] }),
  ];

  it("informa por nombre lo que existe en el destino (no en el otro), sin borrar ni recortar nada, y la corrida falla", async () => {
    const vercel = vercelEnMemoria(ESTADO);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(r.noDebenExistir).toEqual([
      "BETTER_AUTH_SECRET",
      "DATABASE_URL",
      "PEDERNAL_DB_DUENO_DIRECTA",
      "PEDERNAL_DB_GRUPO",
      "PEDERNAL_DB_MIGRACIONES",
      "PEDERNAL_DB_PLATAFORMA",
      "POSTGRES_URL",
    ]);
    expect(vercel.llamadas.filter((l) => l.tipo !== "escribir")).toEqual([]);
    expect(vercel.variables).toHaveLength(ESTADO.length + 5);
    expect(r.ok).toBe(false);
    expect(estados(r).every((e) => e.endsWith(": creada"))).toBe(true);
    expect(lineasDelInforme(r).error.join("\n")).toContain(
      "Están en PREVIEW y NO deben existir (no se borró nada; la aplicación no arranca con ellas):",
    );
  });

  it("lista las de mano con su estado en el destino y no las genera", async () => {
    const vercel = vercelEnMemoria(ESTADO);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(r.aMano).toEqual([
      { nombre: "PEDERNAL_RESEND_API_KEY", cargada: false },
      { nombre: "PEDERNAL_CORREO_REMITENTE", cargada: false },
      { nombre: "PEDERNAL_NOMBRE_DE_MARCA", cargada: false },
      { nombre: "PEDERNAL_URL_BASE", cargada: true },
      { nombre: "GOOGLE_CLIENT_ID", cargada: false },
      { nombre: "GOOGLE_CLIENT_SECRET", cargada: false },
    ]);
    expect(r.aMano.map((m) => m.nombre)).toEqual(VARIABLES_A_MANO);
    for (const nombre of VARIABLES_A_MANO) {
      expect(vercel.llamadas.map((l) => l.clave)).not.toContain(nombre);
    }
  });

  it("sin nada prohibido el informe lo dice y la corrida sale bien", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(lineasDelInforme(r)).toEqual({
      info: [
        "Cargar entorno en Vercel: PREVIEW (equipo alepozod).",
        "Variables que se generan solas:",
        ...VARIABLES_GENERABLES.map((n) => `  - ${n}: creada`),
        "Las que tenés que cargar vos (no se generan):",
        ...VARIABLES_A_MANO.map((n) => `  - ${n}: falta`),
        "Ninguna de las variables que no deben existir está en PREVIEW.",
        "RESULTADO: OK, lo generable en Vercel (PREVIEW) quedó cargado.",
      ],
      error: [],
    });
  });
});

describe("cargarEntorno: el detalle exacto del informe", () => {
  const todasLasEscrituras = (v: ReturnType<typeof vercelEnMemoria>) =>
    v.llamadas.filter((l) => l.tipo === "escribir");

  it("todas las escrituras, la de la clave de contexto también, van con pisar: false", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    await correr(vercel, base).informe;
    expect(todasLasEscrituras(vercel)).toHaveLength(5);
    expect(todasLasEscrituras(vercel).map((l) => l.pisar)).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  it("se entregan a `tapar`, en orden, cada valor y su parte secreta (y nada más)", async () => {
    const vercel = vercelEnMemoria([]);
    const { base } = baseEnMemoria(vercel.eventos);
    const { informe, tapados } = correr(vercel, base);
    await informe;
    const esperados = VARIABLES_GENERABLES.flatMap((nombre) => {
      const valor = vercel.valores.get(nombre) ?? "";
      return [valor, valor.slice(valor.indexOf(":") + 1)];
    });
    expect(tapados).toEqual(esperados);
    // Las de `<kid>:<hex>` entregan el valor entero y el hex; las demás, el mismo valor dos veces.
    expect(tapados[6]).toMatch(/^c1:[0-9a-f]{64}$/);
    expect(tapados[7]).toMatch(/^[0-9a-f]{64}$/);
    expect(tapados[0]).toBe(tapados[1]);
  });

  it("sin cadena de la base no se genera ni se entrega la clave de contexto", async () => {
    const vercel = vercelEnMemoria([]);
    const { informe, tapados } = correr(vercel, null);
    await informe;
    expect(tapados).toHaveLength(8);
    expect(tapados.some((t) => t.startsWith("1:"))).toBe(false);
  });

  it("si la lectura inicial falla, el informe entero es éste", async () => {
    const vercel = vercelEnMemoria([], { listar: () => "falla" });
    const r = await cargarEntorno({
      destino: "production",
      cliente: vercel.cliente,
      base: null,
      tapar: () => undefined,
    });
    expect(r).toEqual({
      destino: "production",
      detenido:
        "no se pudo leer el proyecto de Vercel (equipo alepozod): Vercel no contestó a tiempo. No se cambió nada.",
      generables: VARIABLES_GENERABLES.map((nombre) => ({
        nombre,
        estado: "no se intentó",
        nota: "la corrida se detuvo antes de cambiar nada",
      })),
      aMano: [],
      noDebenExistir: [],
      ok: false,
    });
  });

  it("al parar porque la base ya tiene una clave, las que ya existían conservan su aviso y su estado", async () => {
    const vercel = vercelEnMemoria([
      remota(VARIABLE_SECRETO_DEL_CRON, { type: "plain" }),
      remota("DATABASE_URL"),
    ]);
    const { base } = baseEnMemoria(vercel.eventos, { claves: 1 });
    const r = await correr(vercel, base).informe;
    expect(r.generables.find((f) => f.nombre === VARIABLE_SECRETO_DEL_CRON)).toEqual({
      nombre: VARIABLE_SECRETO_DEL_CRON,
      estado: "ya existía",
      nota: "no es sensible",
    });
    expect(r.generables.filter((f) => f.estado === "no se intentó")).toHaveLength(4);
    expect(r.noDebenExistir).toEqual(["DATABASE_URL"]);
    expect(r.aMano).toHaveLength(6);
  });

  it("los avisos de una existente salen si ALGUNA de sus entradas es rara (no hace falta que lo sean todas) y se unen con coma", async () => {
    const vercel = vercelEnMemoria([
      remota(VARIABLE_SECRETO_DEL_CRON),
      remota(VARIABLE_SECRETO_DEL_CRON, { type: "plain" }),
      remota(VARIABLE_SECRETO_INVITACIONES),
      remota(VARIABLE_SECRETO_INVITACIONES, { target: ["preview", "production"] }),
      remota(VARIABLE_SECRETO_DE_AUTENTICACION),
      remota(VARIABLE_SECRETO_DE_AUTENTICACION, { gitBranch: "una-rama" }),
      remota(VARIABLE_CLAVE_CERTIFICADOS),
      remota(VARIABLE_CLAVE_CERTIFICADOS, { customEnvironmentIds: ["env_x"] }),
      remota(VARIABLE_CLAVE_CONTEXTO, { type: "plain", target: ["preview", "production"] }),
    ]);
    const r = await correr(vercel, null).informe;
    expect(r.generables.map((f) => f.nota)).toEqual([
      "vale también para otro destino",
      "está atada a una rama",
      "no es sensible",
      "vale también para un entorno personalizado",
      "no es sensible, vale también para otro destino",
    ]);
  });

  it("si Vercel guarda una de las cuatro distinta de lo pedido, queda como «no se pudo cargar» y la clave de contexto no se intenta ni se instala", async () => {
    const vercel = vercelEnMemoria([], {
      alListar: (n, variables) =>
        n === 2
          ? variables.map((v) =>
              v.key === VARIABLE_SECRETO_DEL_CRON ? { ...v, type: "plain" } : v,
            )
          : variables,
    });
    const { base, instaladasAhora } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(r.generables).toEqual([
      { nombre: VARIABLE_SECRETO_INVITACIONES, estado: "creada", nota: null },
      { nombre: VARIABLE_SECRETO_DE_AUTENTICACION, estado: "creada", nota: null },
      {
        nombre: VARIABLE_SECRETO_DEL_CRON,
        estado: "no se pudo cargar",
        nota: "Vercel la guardó distinta de lo pedido (tiene que ser sensible y solo de este entorno): revisala en Vercel",
      },
      { nombre: VARIABLE_CLAVE_CERTIFICADOS, estado: "creada", nota: null },
      {
        nombre: VARIABLE_CLAVE_CONTEXTO,
        estado: "no se intentó",
        nota: "antes falló otra carga en Vercel",
      },
    ]);
    expect(instaladasAhora).toEqual([]);
    expect(r.ok).toBe(false);
  });

  it("si no se puede volver a leer Vercel para verificar, las cargas quedan «creada» con esa salvedad", async () => {
    const vercel = vercelEnMemoria([], { listar: (n) => (n >= 2 ? "falla" : "ok") });
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    expect(r.generables.map((f) => [f.estado, f.nota])).toEqual(
      VARIABLES_GENERABLES.map(() => ["creada", "sin verificar: no se pudo volver a leer Vercel"]),
    );
    expect(r.ok).toBe(true);
  });

  it("la clave de contexto instalada que Vercel no deja confirmar cuenta el motivo, y si la falla es incierta lo aclara", async () => {
    const vercel = vercelEnMemoria([], {
      escribir: (clave) => (clave === VARIABLE_CLAVE_CONTEXTO ? "falla-incierta" : "ok"),
    });
    const { base } = baseEnMemoria(vercel.eventos);
    const r = await correr(vercel, base).informe;
    const fila = r.generables.find((f) => f.nombre === VARIABLE_CLAVE_CONTEXTO);
    expect(fila?.nota).toBe(
      "quedó instalada en la base pero NO en Vercel (Vercel no contestó a tiempo (no se sabe si Vercel llegó a aplicarlo: repetir el flujo es seguro)). " +
        "Su valor no se puede recuperar: repetir el flujo se va a detener porque la base ya tiene una clave. Lo decide el dueño (PRIMER-DESPLIEGUE.md, B.4)",
    );
    expect(
      todasLasEscrituras(vercel).filter((l) => l.clave === VARIABLE_CLAVE_CONTEXTO),
    ).toHaveLength(2);
  });
});

describe("lineasDelInforme", () => {
  const informe: Informe = {
    destino: "production",
    detenido: "un motivo",
    generables: [
      { nombre: "A", estado: "creada", nota: null },
      { nombre: "B", estado: "ya existía", nota: "no es sensible" },
      { nombre: "C", estado: "falta que la cargues vos", nota: "porque sí" },
      { nombre: "D", estado: "no se pudo cargar", nota: null },
      { nombre: "E", estado: "no se intentó", nota: "antes falló D" },
    ],
    aMano: [
      { nombre: "X", cargada: true },
      { nombre: "Y", cargada: false },
    ],
    noDebenExistir: ["DATABASE_URL", "POSTGRES_URL"],
    ok: false,
  };

  it("lo hecho va a `info`; lo que quedó sin hacer, lo que no debe existir y la falla, a `error`; solo nombres", () => {
    expect(lineasDelInforme(informe)).toEqual({
      info: [
        "Cargar entorno en Vercel: PRODUCTION (equipo alepozod).",
        "Variables que se generan solas:",
        "  - A: creada",
        "  - B: ya existía (no es sensible)",
        "Las que tenés que cargar vos (no se generan):",
        "  - X: ya cargada",
        "  - Y: falta",
      ],
      error: [
        "SE DETUVO: un motivo",
        "  - C: falta que la cargues vos (porque sí)",
        "  - D: no se pudo cargar",
        "  - E: no se intentó (antes falló D)",
        "Están en PRODUCTION y NO deben existir (no se borró nada; la aplicación no arranca con ellas):",
        "  - DATABASE_URL",
        "  - POSTGRES_URL",
        "RESULTADO: FALLA (ver arriba lo que quedó sin hacer).",
      ],
    });
  });

  it("con todo bien: sin errores, con la frase de que nada sobra y el resultado OK", () => {
    const bien: Informe = {
      ...informe,
      detenido: null,
      generables: [{ nombre: "A", estado: "creada", nota: null }],
      noDebenExistir: [],
      ok: true,
    };
    expect(lineasDelInforme(bien)).toEqual({
      info: [
        "Cargar entorno en Vercel: PRODUCTION (equipo alepozod).",
        "Variables que se generan solas:",
        "  - A: creada",
        "Las que tenés que cargar vos (no se generan):",
        "  - X: ya cargada",
        "  - Y: falta",
        "Ninguna de las variables que no deben existir está en PRODUCTION.",
        "RESULTADO: OK, lo generable en Vercel (PRODUCTION) quedó cargado.",
      ],
      error: [],
    });
  });
});
