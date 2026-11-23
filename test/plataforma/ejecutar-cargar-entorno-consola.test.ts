import { describe, expect, it } from "vitest";
import {
  ejecutarCargaDeLaConsola,
  VARIABLE_DEL_TOKEN_DE_LA_CONSOLA,
  type EntradaDeCargaDeLaConsola,
} from "../../scripts/ejecutar-cargar-entorno-consola";
import type { CambioDeLaConsola } from "../../src/adaptadores/postgres/consola-de-plataforma";
import type { ClienteDeVariables } from "../../src/adaptadores/vercel/cliente-vercel";
import {
  PROYECTO_DE_VERCEL,
  PROYECTO_DE_VERCEL_DE_LA_CONSOLA,
  type VariableRemota,
} from "../../src/adaptadores/vercel/plan-de-variables";
import { err, ok } from "../../src/primitivas/resultado/resultado";

/**
 * La carga de la consola con todo inyectado (sin base ni Vercel): solo `preview`; qué escribe y en qué orden; que la base se
 * deshaga si Vercel falla; que repetirla sin `rotar` no cambie nada (solo renueva vigencia); que no se reemplace a ciegas una
 * variable rara; y que ningún secreto salga por la salida.
 */

const DUENO =
  "postgres://dueno-centinela:clave-dueno-centinela@ep-prueba-1.sa-east-1.aws.neon.tech/base";
const TOKEN = "token-centinela-1234567890";
const BYTES = Buffer.from("cd".repeat(32), "hex");
const HEX = BYTES.toString("hex");

const variable = (key: string, cambios: Partial<VariableRemota> = {}): VariableRemota => ({
  id: `id-${key}`,
  key,
  type: "sensitive",
  target: ["preview"],
  gitBranch: null,
  customEnvironmentIds: [],
  ...cambios,
});
const TODAS_DE_LA_CONSOLA = [
  "PEDERNAL_CLAVE_CONTEXTO",
  "PEDERNAL_SECRETO_INVITACIONES",
  "PEDERNAL_DB_AUTENTICACION",
  "PEDERNAL_DB_PLATAFORMA",
  "PEDERNAL_HOST_DE_LA_CONSOLA",
  "PEDERNAL_AUTH_SECRETO_PLATAFORMA",
  "GOOGLE_CLIENT_ID_PLATAFORMA",
  "GOOGLE_CLIENT_SECRET_PLATAFORMA",
].map((k) => variable(k));

type Escritura = { proyecto: string; key: string; valor: string; destino: string };

function armar(opciones: {
  entorno?: Record<string, string | undefined>;
  web?: VariableRemota[];
  consola?: VariableRemota[];
  fallaAlEscribir?: { proyecto: string; key: string };
  rolesQueEntran?: boolean;
  faltaElRol?: string;
  kidMaximo?: number | null;
  aplicarLanza?: boolean;
}) {
  const salida: string[] = [];
  const errores: string[] = [];
  const comandos: string[] = [];
  const escrituras: Escritura[] = [];
  const cambios: CambioDeLaConsola[] = [];
  let transaccionAbierta = false;
  let confirmada: boolean | null = null;
  const crearCliente = (token: string, proyecto: string): ClienteDeVariables => {
    expect(token).toBe(TOKEN);
    return {
      listar: () =>
        Promise.resolve(
          ok(proyecto === PROYECTO_DE_VERCEL ? (opciones.web ?? []) : (opciones.consola ?? [])),
        ),
      escribir: async (key, valor, destino) => {
        await Promise.resolve();
        expect(transaccionAbierta).toBe(true); // Vercel se escribe con la transacción de la base ABIERTA
        if (
          opciones.fallaAlEscribir?.proyecto === proyecto &&
          opciones.fallaAlEscribir.key === key
        ) {
          return err({
            motivo: `Vercel respondió 500: falla del lado de Vercel (${valor.slice(0, 8)})`,
            incierta: true,
          });
        }
        escrituras.push({ proyecto, key, valor, destino });
        return ok(null);
      },
      borrar: () => Promise.resolve(ok(null)),
      quitarDestinos: () => Promise.resolve(ok(null)),
    };
  };
  const rol = (nombre: string) => ({
    existe: opciones.faltaElRol !== nombre,
    puedeEntrar: opciones.rolesQueEntran ?? false,
  });
  const entrada: EntradaDeCargaDeLaConsola = {
    entorno: {
      PEDERNAL_DB_MIGRACIONES: DUENO,
      [VARIABLE_DEL_TOKEN_DE_LA_CONSOLA]: TOKEN,
      DESTINO: "preview",
      ROTAR: "true",
      ...opciones.entorno,
    },
    info: (l) => salida.push(l),
    error: (l) => errores.push(l),
    comando: (l) => comandos.push(l),
    crearCliente,
    bytesAlAzar: () => BYTES,
    leerEstado: () =>
      Promise.resolve({
        kidMaximo: opciones.kidMaximo === undefined ? 1 : opciones.kidMaximo,
        roles: {
          pedernal_plataforma: rol("pedernal_plataforma"),
          pedernal_autenticacion_plataforma: rol("pedernal_autenticacion_plataforma"),
        },
      }),
    aplicar: async (_cadena, cambio, entreTanto) => {
      cambios.push(cambio);
      transaccionAbierta = true;
      try {
        if (opciones.aplicarLanza) throw new Error(`falla con ${DUENO}`);
        const sigue = await entreTanto();
        confirmada = sigue;
        return sigue;
      } finally {
        transaccionAbierta = false;
      }
    },
  };
  return {
    entrada,
    salida,
    errores,
    comandos,
    escrituras,
    cambios,
    confirmada: () => confirmada,
    todoLoQueSale: () => [...salida, ...errores].join("\n"),
  };
}

describe("cargar entorno de la consola", () => {
  it("con rotar: invitaciones en la web y la consola (en ese orden), clave con kid 3, y las dos cadenas; todo a preview", async () => {
    const t = armar({
      consola: [...TODAS_DE_LA_CONSOLA],
      web: [variable("PEDERNAL_SECRETO_INVITACIONES")],
    });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(0);
    expect(
      t.escrituras.map((e) => `${e.proyecto === PROYECTO_DE_VERCEL ? "web" : "consola"}:${e.key}`),
    ).toEqual([
      "web:PEDERNAL_SECRETO_INVITACIONES",
      "consola:PEDERNAL_SECRETO_INVITACIONES",
      "consola:PEDERNAL_CLAVE_CONTEXTO",
      "consola:PEDERNAL_DB_AUTENTICACION",
      "consola:PEDERNAL_DB_PLATAFORMA",
    ]);
    expect(t.escrituras.every((e) => e.destino === "preview")).toBe(true);
    expect(
      t.escrituras.filter((e) => e.proyecto === PROYECTO_DE_VERCEL_DE_LA_CONSOLA),
    ).toHaveLength(4);
    // El mismo secreto de invitaciones en los dos proyectos.
    const inv = t.escrituras.filter((e) => e.key === "PEDERNAL_SECRETO_INVITACIONES");
    expect(inv[0]?.valor).toBe(inv[1]?.valor);
    // Clave nueva con kid 3 (el 1 es de la web y el 2 no quedó en la base) y las cadenas con el rol de cada una.
    expect(t.escrituras[2]?.valor).toBe(`3:${HEX}`);
    expect(t.cambios[0]?.claveDeContexto?.kid).toBe(3);
    expect(t.escrituras[3]?.valor).toContain("//pedernal_autenticacion_plataforma:");
    expect(t.escrituras[4]?.valor).toContain("//pedernal_plataforma:");
    expect(t.escrituras[3]?.valor).toContain("-pooler");
    expect(t.cambios[0]?.loginsNuevos.map((l) => l.rol)).toEqual([
      "pedernal_autenticacion_plataforma",
      "pedernal_plataforma",
    ]);
    expect(t.confirmada()).toBe(true);
  });

  it("el kid de la clave es el siguiente al más alto de la base, nunca menor que 3", async () => {
    const t = armar({ kidMaximo: 7 });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(0);
    expect(t.cambios[0]?.claveDeContexto?.kid).toBe(8);
    const sinClaves = armar({ kidMaximo: null });
    expect(await ejecutarCargaDeLaConsola(sinClaves.entrada)).toBe(0);
    expect(sinClaves.cambios[0]?.claveDeContexto?.kid).toBe(3);
  });

  it("ningún secreto sale por la salida y todo valor generado se enmascara antes de usarse", async () => {
    const t = armar({});
    await ejecutarCargaDeLaConsola(t.entrada);
    const salida = t.todoLoQueSale();
    for (const secreto of [
      HEX,
      TOKEN,
      "clave-dueno-centinela",
      ...t.escrituras.map((e) => e.valor),
    ]) {
      expect(salida).not.toContain(secreto);
    }
    for (const e of t.escrituras) expect(t.comandos).toContain(`::add-mask::${e.valor}`);
    for (const l of t.cambios[0]?.loginsNuevos ?? [])
      expect(t.comandos).toContain(`::add-mask::${l.clave}`);
  });

  it("sin rotar y con todo cargado: no escribe nada, renueva la vigencia de los roles que ya entran y avisa por nombre lo que carga el dueño", async () => {
    const t = armar({
      entorno: { ROTAR: "false" },
      consola: [...TODAS_DE_LA_CONSOLA],
      web: [variable("PEDERNAL_SECRETO_INVITACIONES")],
      rolesQueEntran: true,
    });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(0);
    expect(t.escrituras).toEqual([]);
    expect(t.cambios[0]).toEqual({
      claveDeContexto: null,
      loginsNuevos: [],
      renovar: ["pedernal_autenticacion_plataforma", "pedernal_plataforma"],
    });
    expect(t.salida.join("\n")).toContain("nada para cargar");
  });

  it("sin rotar: crea solo lo que falta; si un rol no puede entrar, le pone clave nueva aunque la cadena exista", async () => {
    const t = armar({
      entorno: { ROTAR: "false" },
      consola: TODAS_DE_LA_CONSOLA.filter((v) => v.key !== "PEDERNAL_DB_AUTENTICACION"),
      web: [variable("PEDERNAL_SECRETO_INVITACIONES")],
      rolesQueEntran: false,
    });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(0);
    // Las cadenas se renuevan (los roles no entran) y no se toca ni la clave ni el secreto que ya estaban.
    expect(t.escrituras.map((e) => e.key)).toEqual([
      "PEDERNAL_DB_AUTENTICACION",
      "PEDERNAL_DB_PLATAFORMA",
    ]);
    expect(t.cambios[0]?.claveDeContexto).toBeNull();
  });

  it("falta el secreto de invitaciones en la web: se escribe en los dos aunque no se rote", async () => {
    const t = armar({
      entorno: { ROTAR: "false" },
      consola: [...TODAS_DE_LA_CONSOLA],
      web: [],
      rolesQueEntran: true,
    });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(0);
    expect(
      t.escrituras.map((e) => `${e.proyecto === PROYECTO_DE_VERCEL ? "web" : "consola"}:${e.key}`),
    ).toEqual(["web:PEDERNAL_SECRETO_INVITACIONES", "consola:PEDERNAL_SECRETO_INVITACIONES"]);
  });

  it("si Vercel falla a mitad, la base se deshace, se nombra lo que ya quedó escrito y no se filtra ningún valor", async () => {
    const t = armar({
      fallaAlEscribir: {
        proyecto: PROYECTO_DE_VERCEL_DE_LA_CONSOLA,
        key: "PEDERNAL_CLAVE_CONTEXTO",
      },
    });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(1);
    expect(t.confirmada()).toBe(false);
    const errores = t.errores.join("\n");
    expect(errores).toContain("La base NO se cambió");
    expect(errores).toContain("web PEDERNAL_SECRETO_INVITACIONES");
    expect(errores).toContain("rotar");
    for (const secreto of [HEX, TOKEN, ...t.escrituras.map((e) => e.valor)]) {
      expect(t.todoLoQueSale()).not.toContain(secreto);
    }
    // No siguió escribiendo después de la falla.
    expect(t.escrituras.map((e) => e.key)).toEqual([
      "PEDERNAL_SECRETO_INVITACIONES",
      "PEDERNAL_SECRETO_INVITACIONES",
    ]);
  });

  it("si falla la base, no se escribe nada de lo que falta y no se muestra la cadena del dueño", async () => {
    const t = armar({ aplicarLanza: true });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(1);
    expect(t.escrituras).toEqual([]);
    expect(t.todoLoQueSale()).not.toContain("clave-dueno-centinela");
  });

  it("fail closed: producción, sin DESTINO, rotar ambiguo, sin token o sin cadena del dueño no hacen nada", async () => {
    for (const entorno of [
      { DESTINO: "production" },
      { DESTINO: "" },
      { DESTINO: undefined },
      { DESTINO: "Preview" },
      { ROTAR: "si" },
      { ROTAR: undefined },
      { [VARIABLE_DEL_TOKEN_DE_LA_CONSOLA]: undefined },
      { [VARIABLE_DEL_TOKEN_DE_LA_CONSOLA]: "token con espacios" },
      { PEDERNAL_DB_MIGRACIONES: undefined },
      { PEDERNAL_DB_MIGRACIONES: "postgres://u:p@ep-x-pooler.sa-east-1.aws.neon.tech/b" },
    ]) {
      const t = armar({ entorno });
      expect(await ejecutarCargaDeLaConsola(t.entrada), JSON.stringify(entorno)).toBe(1);
      expect(t.escrituras).toEqual([]);
      expect(t.cambios).toEqual([]);
    }
  });

  it("si falta un rol en la base (0088 sin aplicar) frena antes de escribir", async () => {
    const t = armar({ faltaElRol: "pedernal_autenticacion_plataforma" });
    expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(1);
    expect(t.errores.join("\n")).toContain("Migrar");
    expect(t.escrituras).toEqual([]);
    expect(t.cambios).toEqual([]);
  });

  it("una variable que existe con otro destino, con rama o duplicada no se reemplaza a ciegas", async () => {
    for (const rara of [
      variable("PEDERNAL_CLAVE_CONTEXTO", { target: ["preview", "production"] }),
      variable("PEDERNAL_CLAVE_CONTEXTO", { gitBranch: "rama" }),
      variable("PEDERNAL_CLAVE_CONTEXTO", { customEnvironmentIds: ["env_1"] }),
    ]) {
      const t = armar({ consola: [rara] });
      expect(await ejecutarCargaDeLaConsola(t.entrada)).toBe(1);
      expect(t.escrituras).toEqual([]);
      expect(t.cambios).toEqual([]);
    }
    const duplicada = armar({
      consola: [variable("PEDERNAL_DB_PLATAFORMA"), variable("PEDERNAL_DB_PLATAFORMA")],
    });
    expect(await ejecutarCargaDeLaConsola(duplicada.entrada)).toBe(1);
    expect(duplicada.escrituras).toEqual([]);
  });

  it("si no se puede leer Vercel (web o consola), no se toca nada", async () => {
    const t = armar({});
    const original = t.entrada.crearCliente!;
    const entrada: EntradaDeCargaDeLaConsola = {
      ...t.entrada,
      crearCliente: (token, proyecto) => ({
        ...original(token, proyecto),
        listar: () =>
          Promise.resolve(
            err({ motivo: "Vercel respondió 401: el token no sirve", incierta: false }),
          ),
      }),
    };
    expect(await ejecutarCargaDeLaConsola(entrada)).toBe(1);
    expect(t.cambios).toEqual([]);
  });

  it("repetirla dos veces seguidas con rotar da dos corridas completas y consistentes (nunca valores a medias)", async () => {
    const a = armar({});
    const b = armar({});
    expect(await ejecutarCargaDeLaConsola(a.entrada)).toBe(0);
    expect(await ejecutarCargaDeLaConsola(b.entrada)).toBe(0);
    expect(a.escrituras.map((e) => e.key)).toEqual(b.escrituras.map((e) => e.key));
  });
});
