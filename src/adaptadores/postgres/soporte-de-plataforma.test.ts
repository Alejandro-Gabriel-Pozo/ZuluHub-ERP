import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * La lectura de soporte de plataforma (H5 §B.5.9) solo toca lo que el rol de plataforma puede leer, y
 * nunca devuelve un secreto. Se comprueba sobre el TEXTO del adaptador (sin sus comentarios): las
 * pruebas de integración lo confirman contra la base, pero esta es la barrera que no depende de que
 * alguien se acuerde de sembrar el dato operativo justo en el caso que falla.
 */
const fuente = readFileSync(
  fileURLToPath(new URL("soporte-de-plataforma.ts", import.meta.url)),
  "utf8",
);
const codigo = fuente.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const PERMITIDAS = [
  "tenant",
  "empresa",
  "persona",
  "membresia",
  "invitacion",
  "invitacion_empresa",
  "trabajo",
  "auditoria_plataforma",
  "referencia_de_error",
  // La marca y el plan vigente de cada tenant en las listas de la consola (0007: `SELECT` de plataforma).
  "marca",
  "version_de_marca",
  "plan",
  "version_de_plan",
  "plan_de_tenant",
  "ajuste_de_perilla",
];
const OPERATIVAS = [
  "sucursal",
  "asignacion_sucursal",
  "invitacion_sucursal",
  "auditoria_empresa",
  "auditoria_acceso_grupo",
];

/** Las tablas que el código lee: la primera palabra de cada `selectFrom`/`innerJoin`/`leftJoin`. */
const tablasLeidas = [
  ...codigo.matchAll(/\.(?:selectFrom|innerJoin|leftJoin)\(\s*"([a-z_]+)(?: as \w+)?"/g),
].map((m) => m[1]);

describe("el adaptador de lectura de soporte", () => {
  it("lee tablas (hay algo que revisar)", () => {
    expect(new Set(tablasLeidas)).toEqual(new Set(PERMITIDAS));
  });

  it("solo lee tablas que el rol de plataforma puede leer", () => {
    for (const tabla of tablasLeidas) expect(PERMITIDAS, String(tabla)).toContain(tabla);
  });

  it("no nombra ninguna tabla operativa", () => {
    for (const tabla of OPERATIVAS) {
      expect(codigo, tabla).not.toMatch(new RegExp(`\\b${tabla}\\b`));
    }
  });

  it("declara solo las tablas permitidas en su tipo", () => {
    const declaradas = [...codigo.matchAll(/^ {2}([a-z_]+): \{/gm)].map((m) => m[1]);
    expect(new Set(declaradas)).toEqual(new Set(PERMITIDAS));
  });

  it("nunca pide el hash de un token, la clave de un trabajo ni todas las columnas", () => {
    expect(codigo).not.toMatch(/token_hash|clave_idempotencia|selectAll|returningAll/);
  });

  it("solo lee: no escribe ni borra", () => {
    expect(codigo).not.toMatch(/\.(insertInto|updateTable|deleteFrom|replaceInto)\(/);
    expect(codigo).not.toMatch(/\bsql`/);
  });

  it("de la membresía pide solo las cuatro columnas que la plataforma puede leer", () => {
    const membresia = codigo.match(/selectFrom\("membresia"\)\s*\.select\(\[([^\]]*)\]\)/);
    expect(membresia?.[1]?.replace(/\s+/g, "")).toBe('"empresa_id","persona_id","rol","activo"');
    expect(tablasLeidas.filter((t) => t === "membresia")).toHaveLength(1);
  });
});
