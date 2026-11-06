import { describe, expect, it } from "vitest";
import {
  abrirLoginDePlataforma,
  cerrarLoginDePlataforma,
  type ClienteDeBase,
} from "./login-temporal-de-plataforma";

/**
 * El login temporal del rol de plataforma con un cliente de base falso (la prueba contra una base real está en
 * `test/integracion/login-temporal-de-plataforma.test.ts`): qué sentencias manda, que no toca un rol que ya tiene login,
 * que el cierre VERIFICA el estado final y falla fuerte si no quedó cerrado, y que la clave no sale en ningún error.
 */

const DUENO = "postgres://dueno:clave-dueno@ep-prueba-123.sa-east-1.aws.neon.tech/base";
const CLAVE = "ClaveDeLaCorridaCentinela0123456789";

type Estado = {
  existe: boolean;
  puede: boolean;
  noCierra?: boolean;
  claveNula?: boolean;
  claveIlegible?: boolean;
  falla?: "abrir";
};

function falso(estado: Estado) {
  const consultas: string[] = [];
  const textosDeFormato: string[] = [];
  const parametros: unknown[][] = [];
  let terminado = false;
  let conectado = false;
  const cliente: ClienteDeBase = {
    connect: () => {
      conectado = true;
      return Promise.resolve();
    },
    end: () => {
      terminado = true;
      return Promise.resolve();
    },
    query: (texto, valores) => {
      if (texto.startsWith("SELECT format")) {
        textosDeFormato.push(texto);
        parametros.push(valores ?? []);
      }
      consultas.push(texto.startsWith("SELECT format") ? `format:${String(valores?.[0])}` : texto);
      if (texto.startsWith("SELECT rolcanlogin")) {
        return Promise.resolve({ rows: estado.existe ? [{ puede: estado.puede }] : [] });
      }
      if (texto.includes("WITH LOGIN PASSWORD")) {
        return Promise.resolve({ rows: [{ sentencia: `ABRIR ${String(valores?.[0])}` }] });
      }
      if (texto.includes("WITH NOLOGIN PASSWORD NULL")) {
        return Promise.resolve({ rows: [{ sentencia: `CERRAR ${String(valores?.[0])}` }] });
      }
      if (texto.startsWith("ABRIR")) {
        if (estado.falla === "abrir") return Promise.reject(new Error("falla de la base"));
        estado.puede = true;
      }
      if (texto.startsWith("CERRAR")) estado.puede = estado.noCierra === true;
      if (texto.includes("pg_authid")) {
        if (estado.claveIlegible === true) {
          return Promise.reject(Object.assign(new Error("permission denied"), { code: "42501" }));
        }
        return Promise.resolve({ rows: [{ sin_clave: estado.claveNula ?? true }] });
      }
      return Promise.resolve({ rows: [] });
    },
  };
  return {
    cliente,
    consultas,
    textosDeFormato,
    parametros,
    estado: () => ({ terminado, conectado }),
  };
}

const opciones = (f: ReturnType<typeof falso>) => ({
  crearCliente: () => f.cliente,
  generarClave: () => CLAVE,
});

describe("abrirLoginDePlataforma", () => {
  it("abre el login del rol con la clave al azar dentro de una transacción y devuelve su cadena", async () => {
    const f = falso({ existe: true, puede: false });
    const r = await abrirLoginDePlataforma(DUENO, opciones(f));
    expect(r.clave).toBe(CLAVE);
    const url = new URL(r.cadena);
    expect(url.username).toBe("pedernal_plataforma");
    expect(url.password).toBe(CLAVE);
    expect(url.hostname).toBe("ep-prueba-123.sa-east-1.aws.neon.tech");
    expect(f.consultas).toEqual([
      "SELECT rolcanlogin AS puede FROM pg_roles WHERE rolname = $1",
      "format:pedernal_plataforma",
      "BEGIN",
      "ABRIR pedernal_plataforma",
      "COMMIT",
    ]);
    expect(f.estado().terminado).toBe(true);
  });

  it("el login vence solo a los 30 minutos (VALID UNTIL), por si el runner muere antes del cierre", async () => {
    const f = falso({ existe: true, puede: false });
    await abrirLoginDePlataforma(DUENO, opciones(f));
    expect(f.textosDeFormato[0]).toContain("VALID UNTIL");
    expect(f.parametros[0]).toEqual(["pedernal_plataforma", CLAVE, 30]);
  });

  it("si el rol YA tiene login no lo toca y falla (el cierre lo deja cerrado)", async () => {
    const f = falso({ existe: true, puede: true });
    await expect(abrirLoginDePlataforma(DUENO, opciones(f))).rejects.toThrow(/ya tiene login/);
    expect(f.consultas.some((c) => c.startsWith("ABRIR"))).toBe(false);
    expect(f.estado().terminado).toBe(true);
  });

  it("si el rol no existe, falla", async () => {
    const f = falso({ existe: false, puede: false });
    await expect(abrirLoginDePlataforma(DUENO, opciones(f))).rejects.toThrow(/no existe/);
  });

  it("la cadena del pooler se rechaza antes de conectar", async () => {
    const f = falso({ existe: true, puede: false });
    await expect(
      abrirLoginDePlataforma(DUENO.replace("ep-prueba-123", "ep-prueba-123-pooler"), opciones(f)),
    ).rejects.toThrow(/pooler/);
    expect(f.estado().conectado).toBe(false);
  });

  it("si la sentencia falla, revierte, cierra la conexión y la clave no aparece en el error", async () => {
    const f = falso({ existe: true, puede: false, falla: "abrir" });
    const falla = await abrirLoginDePlataforma(DUENO, opciones(f)).catch((e: unknown) => e);
    expect(String(falla)).not.toContain(CLAVE);
    expect(f.consultas).toContain("ROLLBACK");
    expect(f.estado().terminado).toBe(true);
  });
});

describe("cerrarLoginDePlataforma", () => {
  it("deja el rol sin login y sin clave, y verifica las dos cosas", async () => {
    const f = falso({ existe: true, puede: true });
    expect(await cerrarLoginDePlataforma(DUENO, opciones(f))).toEqual({ claveVerificada: true });
    expect(f.consultas).toContain("CERRAR pedernal_plataforma");
    expect(f.estado().terminado).toBe(true);
  });

  it("el cierre limpia el vencimiento (VALID UNTIL 'infinity')", async () => {
    const f = falso({ existe: true, puede: true });
    await cerrarLoginDePlataforma(DUENO, opciones(f));
    expect(f.textosDeFormato.at(-1)).toContain("NOLOGIN PASSWORD NULL VALID UNTIL");
  });

  it("es idempotente: cerrar lo cerrado también termina bien", async () => {
    const f = falso({ existe: true, puede: false });
    await expect(cerrarLoginDePlataforma(DUENO, opciones(f))).resolves.toEqual({
      claveVerificada: true,
    });
  });

  it("si el rol sigue pudiendo entrar, falla fuerte", async () => {
    const f = falso({ existe: true, puede: true, noCierra: true });
    await expect(cerrarLoginDePlataforma(DUENO, opciones(f))).rejects.toThrow(
      /sigue pudiendo entrar/,
    );
    expect(f.estado().terminado).toBe(true);
  });

  it("si conserva una clave, falla fuerte", async () => {
    const f = falso({ existe: true, puede: true, claveNula: false });
    await expect(cerrarLoginDePlataforma(DUENO, opciones(f))).rejects.toThrow(/conserva una clave/);
  });

  it("si la conexión no puede mirar la clave (pg_authid), verifica NOLOGIN y lo dice", async () => {
    const f = falso({ existe: true, puede: true, claveIlegible: true });
    await expect(cerrarLoginDePlataforma(DUENO, opciones(f))).resolves.toEqual({
      claveVerificada: false,
    });
  });

  it("si el rol no existe, falla", async () => {
    const f = falso({ existe: false, puede: false });
    await expect(cerrarLoginDePlataforma(DUENO, opciones(f))).rejects.toThrow(/no existe/);
  });
});
