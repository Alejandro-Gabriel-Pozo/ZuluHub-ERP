import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CARACTERES_DISTINTOS_MINIMOS,
  PEDERNAL_AUTH_SECRETO_EMPRESA,
  leerSecretoDeAutenticacion,
} from "../../src/adaptadores/autenticacion/configuracion";
import {
  PEDERNAL_CLAVE_CERTIFICADOS,
  parsearClaveMaestra,
} from "../../src/adaptadores/cifrado/aes-gcm";
import {
  PEDERNAL_CLAVE_CONTEXTO,
  leerClaveDeContexto,
} from "../../src/adaptadores/postgres/contexto-firmado";
import { rolesPorPreparar } from "../../src/adaptadores/postgres/roles-de-la-aplicacion";
import {
  PEDERNAL_SECRETO_INVITACIONES,
  leerSecretoDeInvitaciones,
} from "../../src/adaptadores/tokens/tokens-hmac";
import { VARIABLES_A_MANO } from "../../src/adaptadores/vercel/cargar-entorno";
import {
  CARACTERES_DISTINTOS_PEDIDOS,
  VARIABLES_GENERABLES,
  VARIABLE_CLAVE_CERTIFICADOS,
  VARIABLE_CLAVE_CONTEXTO,
  VARIABLE_SECRETO_DE_AUTENTICACION,
  VARIABLE_SECRETO_DEL_CRON,
  VARIABLE_SECRETO_INVITACIONES,
  generarValor,
  noDebeEstarEnVercel,
} from "../../src/adaptadores/vercel/plan-de-variables";
import { leerClaveDeCertificados } from "../../src/composicion/clave-de-certificados";
import { NOMBRES_DE_ENTORNO, valoresDeLaPieza } from "../../src/composicion/entorno";

/**
 * `cargar-entorno` genera secretos y los carga en Vercel sin que nadie los vea: si uno sale con una forma que la
 * aplicación rechaza, el dueño lo descubre cuando la web no arranca. Estas pruebas atan lo que se GENERA a los
 * validadores REALES de la aplicación (no a una copia de su regla) y los NOMBRES de las listas del flujo a los que
 * declara `src/composicion/entorno.ts`. El script se carga con Node sin compilar y no puede importar esos validadores
 * (sus archivos importan sin extensión): por eso la forma se repite allá y se vigila acá.
 */

const REPETICIONES = 300;

describe("los nombres del flujo son los de la aplicación", () => {
  it("cada variable generable usa el nombre exacto que declara su adaptador", () => {
    expect(VARIABLE_CLAVE_CONTEXTO).toBe(PEDERNAL_CLAVE_CONTEXTO);
    expect(VARIABLE_CLAVE_CERTIFICADOS).toBe(PEDERNAL_CLAVE_CERTIFICADOS);
    expect(VARIABLE_SECRETO_INVITACIONES).toBe(PEDERNAL_SECRETO_INVITACIONES);
    expect(VARIABLE_SECRETO_DE_AUTENTICACION).toBe(PEDERNAL_AUTH_SECRETO_EMPRESA);
    const declaradas = NOMBRES_DE_ENTORNO.map((e) => e.nombre) as string[];
    expect(declaradas).toContain(VARIABLE_SECRETO_DEL_CRON);
    for (const nombre of VARIABLES_GENERABLES) expect(declaradas).toContain(nombre);
  });

  it("toda variable que la aplicación exige tiene dueño: se genera, la da el dueño a mano o la carga el comando de los roles", () => {
    // Previene: sumar una variable a `entorno.ts` y que ningún flujo ni lista del dueño la nombre.
    const deLosRoles = rolesPorPreparar(true, false).map((r) => r.variable);
    const conDueno = new Set<string>([...VARIABLES_GENERABLES, ...VARIABLES_A_MANO, ...deLosRoles]);
    const sinDueno = NOMBRES_DE_ENTORNO.map((e) => e.nombre as string).filter(
      (nombre) => !conDueno.has(nombre),
    );
    expect(sinDueno).toEqual([]);
  });

  it("y las de mano son variables que la aplicación de verdad declara (no quedan nombres viejos)", () => {
    const declaradas = NOMBRES_DE_ENTORNO.map((e) => e.nombre as string);
    for (const nombre of VARIABLES_A_MANO) expect(declaradas).toContain(nombre);
    for (const nombre of VARIABLES_A_MANO) {
      expect((VARIABLES_GENERABLES as readonly string[]).includes(nombre)).toBe(false);
    }
  });

  it("el piso de variedad es el de la aplicación", () => {
    expect(CARACTERES_DISTINTOS_PEDIDOS).toBe(CARACTERES_DISTINTOS_MINIMOS);
  });
});

describe("lo generado cumple los validadores reales", () => {
  const juego = () => ({
    invitaciones: generarValor(VARIABLE_SECRETO_INVITACIONES),
    autenticacion: generarValor(VARIABLE_SECRETO_DE_AUTENTICACION),
    cron: generarValor(VARIABLE_SECRETO_DEL_CRON),
    certificados: generarValor(VARIABLE_CLAVE_CERTIFICADOS),
    contexto: generarValor(VARIABLE_CLAVE_CONTEXTO),
  });

  it(`${REPETICIONES} veces con el azar real: las cinco pasan su validador`, () => {
    for (let i = 0; i < REPETICIONES; i++) {
      const v = juego();
      expect(() => leerSecretoDeInvitaciones(v.invitaciones)).not.toThrow();
      expect(() => leerSecretoDeAutenticacion(v.autenticacion)).not.toThrow();
      expect(() => valoresDeLaPieza({ CRON_SECRET: v.cron }, "cron")).not.toThrow();
      expect(() => leerClaveDeContexto(v.contexto)).not.toThrow();
      expect(() => parsearClaveMaestra(v.certificados)).not.toThrow();
      expect(() => leerClaveDeCertificados(v.certificados, v.contexto)).not.toThrow();
    }
  });

  it("la pieza del cron y la del facturador de la aplicación arrancan con lo generado", () => {
    const v = juego();
    expect(valoresDeLaPieza({ CRON_SECRET: v.cron }, "cron")["CRON_SECRET"]).toBe(v.cron);
    const piezaDeCertificados = valoresDeLaPieza(
      { [PEDERNAL_CLAVE_CERTIFICADOS]: v.certificados, [PEDERNAL_CLAVE_CONTEXTO]: v.contexto },
      "cifrador-de-certificados",
    );
    expect(piezaDeCertificados[PEDERNAL_CLAVE_CERTIFICADOS]).toBe(v.certificados);
    expect(piezaDeCertificados[PEDERNAL_CLAVE_CONTEXTO]).toBe(v.contexto);
  });

  it("la forma exacta: kid y 64 hexadecimales; sin espacios; la de certificados no es la de contexto", () => {
    const v = juego();
    expect(v.contexto).toMatch(/^1:[0-9a-f]{64}$/);
    expect(v.certificados).toMatch(/^c1:[0-9a-f]{64}$/);
    for (const valor of [v.invitaciones, v.autenticacion, v.cron]) {
      expect(valor).toMatch(/^[0-9a-f]{64}$/);
    }
    expect(v.cron.length).toBeGreaterThanOrEqual(16);
    expect(v.autenticacion.length).toBeGreaterThanOrEqual(32);
    expect(leerClaveDeContexto(v.contexto).kid).toBe(1);
    expect(parsearClaveMaestra(v.certificados).kid).toBe("c1");
    expect(v.certificados.slice(3)).not.toBe(v.contexto.slice(2));
    expect(new Set([v.invitaciones, v.autenticacion, v.cron]).size).toBe(3);
  });

  it("el generador rechaza lo que el validador rechazaría (poca variedad), en vez de cargarlo", () => {
    const ceros = (n: number) => new Uint8Array(n);
    for (const nombre of [
      VARIABLE_SECRETO_DE_AUTENTICACION,
      VARIABLE_SECRETO_DEL_CRON,
      VARIABLE_CLAVE_CERTIFICADOS,
    ] as const) {
      expect(() => generarValor(nombre, ceros)).toThrow(`no se pudo generar ${nombre}`);
    }
    // Los otros dos no piden variedad a su validador: lo que sirve para ellos se genera.
    expect(() =>
      leerSecretoDeInvitaciones(generarValor(VARIABLE_SECRETO_INVITACIONES, ceros)),
    ).not.toThrow();
    expect(() => leerClaveDeContexto(generarValor(VARIABLE_CLAVE_CONTEXTO, ceros))).not.toThrow();
    // Y el validador real de verdad los rechazaría: la regla del generador no es de más.
    expect(() => leerSecretoDeAutenticacion("0".repeat(64))).toThrow();
    expect(() => valoresDeLaPieza({ CRON_SECRET: "0".repeat(64) }, "cron")).toThrow();
    expect(() =>
      leerClaveDeCertificados(`c1:${"0".repeat(64)}`, `1:${"ab12".repeat(16)}`),
    ).toThrow();
  });

  it("pide 32 bytes al azar por valor (nunca menos)", () => {
    const pedidos: number[] = [];
    for (const nombre of VARIABLES_GENERABLES) {
      generarValor(nombre, (cuantos) => {
        pedidos.push(cuantos);
        return randomBytes(cuantos);
      });
    }
    expect(pedidos).toEqual([32, 32, 32, 32, 32]);
  });
});

describe("lo que no debe existir en Vercel", () => {
  const GUIA = readFileSync(
    join(import.meta.dirname, "../../apps/web/PRIMER-DESPLIEGUE.md"),
    "utf8",
  );

  it("el chequeo cubre cada nombre de la lista «Lo que NO debe existir» de la guía", () => {
    const desde = GUIA.indexOf("#### Lo que NO debe existir");
    const seccion = GUIA.slice(desde, GUIA.indexOf("\n### ", desde));
    const nombres = [...seccion.matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1] as string);
    expect(nombres.length).toBeGreaterThanOrEqual(12);
    for (const nombre of nombres) {
      // `POSTGRES_` es el prefijo de toda una familia.
      const ejemplo = nombre.endsWith("_") ? `${nombre}URL` : nombre;
      expect(noDebeEstarEnVercel(ejemplo), ejemplo).toBe(true);
    }
  });

  it("lo que genera y lo que da el dueño a mano no está en esa lista", () => {
    for (const nombre of [...VARIABLES_GENERABLES, ...VARIABLES_A_MANO]) {
      expect(noDebeEstarEnVercel(nombre), nombre).toBe(false);
    }
    expect(noDebeEstarEnVercel("PEDERNAL_DB_APP")).toBe(false);
  });
});
