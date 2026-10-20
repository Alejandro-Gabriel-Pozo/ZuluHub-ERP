import { describe, expect, it } from "vitest";
import {
  LARGO_DE_CLAVE,
  cadenaDeRol,
  claveAlAzar,
  esVariableDeRespaldo,
  esVariableProvisoria,
  rolesPorPreparar,
} from "./roles-de-la-aplicacion";

describe("rolesPorPreparar", () => {
  it("sin la bandera, exactamente los tres roles de la aplicación web con las variables que declara el entorno", () => {
    expect(rolesPorPreparar(false)).toEqual([
      { rol: "pedernal_app", variable: "PEDERNAL_DB_APP" },
      { rol: "pedernal_trabajos", variable: "PEDERNAL_DB_TRABAJOS" },
      { rol: "pedernal_publico", variable: "PEDERNAL_DB_PUBLICO" },
    ]);
  });

  it("con la bandera suma autenticación y captación, y nunca grupo ni plataforma", () => {
    const roles = rolesPorPreparar(true).map((r) => r.rol);
    expect(roles).toEqual([
      "pedernal_app",
      "pedernal_trabajos",
      "pedernal_publico",
      "pedernal_autenticacion",
      "pedernal_captacion",
    ]);
    expect(roles).not.toContain("pedernal_grupo");
    expect(roles).not.toContain("pedernal_plataforma");
  });

  it("el rol de respaldo solo con su bandera, al final, y nunca por defecto", () => {
    expect(rolesPorPreparar(false, false)).toEqual(rolesPorPreparar(false));
    expect(rolesPorPreparar(true, false)).toEqual(rolesPorPreparar(true));
    expect(rolesPorPreparar(false, true)).toEqual([
      ...rolesPorPreparar(false),
      { rol: "pedernal_respaldo", variable: "PEDERNAL_DB_RESPALDO" },
    ]);
    expect(rolesPorPreparar(true, true).map((r) => r.rol)).toEqual([
      ...rolesPorPreparar(true).map((r) => r.rol),
      "pedernal_respaldo",
    ]);
    expect(rolesPorPreparar(true).map((r) => r.rol)).not.toContain("pedernal_respaldo");
  });

  it("solo la variable del rol de respaldo es de respaldo", () => {
    expect(esVariableDeRespaldo("PEDERNAL_DB_RESPALDO")).toBe(true);
    for (const { variable } of rolesPorPreparar(true)) {
      expect(esVariableDeRespaldo(variable), variable).toBe(false);
    }
  });

  it("solo son provisorias las variables que la aplicación todavía no declara", () => {
    expect(esVariableProvisoria("PEDERNAL_DB_AUTENTICACION")).toBe(true);
    expect(esVariableProvisoria("PEDERNAL_DB_CAPTACION")).toBe(true);
    expect(esVariableProvisoria("PEDERNAL_DB_APP")).toBe(false);
    expect(esVariableProvisoria("PEDERNAL_DB_TRABAJOS")).toBe(false);
    expect(esVariableProvisoria("PEDERNAL_DB_PUBLICO")).toBe(false);
  });
});

describe("claveAlAzar", () => {
  const ALFABETO = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";

  it("son 32 caracteres, solo letras y números, y no se repite entre llamadas", () => {
    const a = claveAlAzar();
    const b = claveAlAzar();
    expect(LARGO_DE_CLAVE).toBe(32);
    expect(a).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(b).toMatch(/^[A-Za-z0-9]{32}$/);
    expect(a).not.toBe(b);
  });

  it("cada byte elige una letra del alfabeto de 62: 0 es A, 25 es Z, 26 es a, 61 es 9, 62 vuelve a A", () => {
    const bytes = Uint8Array.from([0, 25, 26, 51, 52, 61, 62, 247]);
    const relleno = new Uint8Array(64);
    relleno.set(bytes);
    const clave = claveAlAzar(() => relleno);
    expect(clave.slice(0, 8)).toBe("AZaz09A9");
  });

  it("descarta los bytes de 248 a 255 (por el sesgo del módulo) y pide más hasta juntar 32", () => {
    let pedidos = 0;
    const clave = claveAlAzar((cuantos) => {
      pedidos += 1;
      // Primera tanda: todos descartables; la segunda alcanza.
      return pedidos === 1 ? new Uint8Array(cuantos).fill(248) : new Uint8Array(cuantos).fill(1);
    });
    expect(pedidos).toBe(2);
    expect(clave).toBe("B".repeat(32));
    expect(clave.split("").every((c) => ALFABETO.includes(c))).toBe(true);
    // 255 también se descarta; 247 es el último que vale.
    expect(claveAlAzar((n) => new Uint8Array(n).fill(247)).startsWith("9")).toBe(true);
    let tandas = 0;
    expect(
      claveAlAzar((n) => (++tandas === 1 ? new Uint8Array(n).fill(255) : new Uint8Array(n))),
    ).toBe("A".repeat(32));
  });

  it("nunca pasa de 32 aunque sobren bytes válidos", () => {
    expect(claveAlAzar((n) => new Uint8Array(n * 5).fill(3))).toHaveLength(32);
  });
});

describe("cadenaDeRol", () => {
  const NEON =
    "postgresql://dueno:secreto@ep-fria-luna-123456.sa-east-1.aws.neon.tech/neondb?sslmode=require";

  it("pone el usuario y la contraseña del rol y conserva host y base", () => {
    const { cadena, pooler } = cadenaDeRol(NEON, "pedernal_app", "Clave123", false);
    const url = new URL(cadena);
    expect(url.username).toBe("pedernal_app");
    expect(url.password).toBe("Clave123");
    expect(url.hostname).toBe("ep-fria-luna-123456.sa-east-1.aws.neon.tech");
    expect(url.pathname).toBe("/neondb");
    expect(url.searchParams.get("sslmode")).toBe("require");
    expect(cadena).not.toContain("dueno");
    expect(cadena).not.toContain("secreto");
    expect(pooler).toBe(false);
  });

  it("con pooler, agrega «-pooler» a la primera etiqueta del host de Neon", () => {
    const { cadena, pooler } = cadenaDeRol(NEON, "pedernal_app", "Clave123", true);
    expect(new URL(cadena).hostname).toBe("ep-fria-luna-123456-pooler.sa-east-1.aws.neon.tech");
    expect(pooler).toBe(true);
  });

  it("quita channel_binding (el pooler no lo soporta) y deja el resto de los parámetros", () => {
    const { cadena } = cadenaDeRol(
      `${NEON}&channel_binding=require`,
      "pedernal_app",
      "Clave123",
      true,
    );
    const parametros = new URL(cadena).searchParams;
    expect(parametros.has("channel_binding")).toBe(false);
    expect(parametros.get("sslmode")).toBe("require");
  });

  it("un host que no es de Neon no se puede deducir: queda el directo y lo dice", () => {
    for (const host of [
      "localhost",
      "bd.ejemplo.com",
      "ep-fria-123.ejemplo.com",
      "ep-fria-123.sa-east-1.aws.neon.tech.malo.com",
      "ep-fria-123.sa-east-1.malvadoneon.tech",
      "fria-123.sa-east-1.aws.neon.tech",
      "xep-fria-123.sa-east-1.aws.neon.tech",
      "ep-fria-123Z.sa-east-1.aws.neon.tech",
    ]) {
      const { cadena, pooler } = cadenaDeRol(
        `postgresql://d:c@${host}/b`,
        "pedernal_app",
        "K12",
        true,
      );
      expect(new URL(cadena).hostname).toBe(host);
      expect(pooler).toBe(false);
    }
  });

  it("el usuario y la contraseña se codifican en la URL (viajan íntegros)", () => {
    const { cadena } = cadenaDeRol(NEON, "rol con espacio", "a@b:c/d", false);
    const url = new URL(cadena);
    expect(decodeURIComponent(url.username)).toBe("rol con espacio");
    expect(decodeURIComponent(url.password)).toBe("a@b:c/d");
    expect(url.hostname).toBe("ep-fria-luna-123456.sa-east-1.aws.neon.tech");
  });
});
