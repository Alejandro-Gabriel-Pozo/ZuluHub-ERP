import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { COMPONENTES_DE_CAMPO, REGISTRO_DE_DATOS } from "../../src/capacidades/datos/registro";
import { analizarArchivo, EXTENSIONES_DE_CODIGO, type Contexto } from "./campos-con-dato-apoyo";
import {
  problemasDeComponente,
  problemasDeDeuda,
  problemasDelRegistro,
  type Cuenta,
} from "./campos-con-dato-registro-apoyo";

/**
 * REGLA (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; dueño, 2026-11-05): sin dato registrado no hay campo.
 * En todas las aplicaciones (`apps/*`, se descubren: una nueva entra sola):
 *  1. un `<input>`, `<textarea>` o `<select>` crudo solo puede vivir en un componente de campo (`COMPONENTES_DE_CAMPO`);
 *  2. todo uso de un componente de campo lleva `dato="…"` con un literal que existe en el registro (o `"pendiente"`, que es deuda);
 *  3. el archivo que lo usa figura entre los `consumidores` de ese dato; un dato sin consumidor que lo pida es huérfano;
 *  4. la deuda (lo `pendiente` y los controles crudos) tiene un presupuesto por archivo, `arquitectura/deuda/campos-sin-dato.json`,
 *     que coincide EXACTO con el código y solo puede bajar (contra la base lo comprueba `arquitectura/deuda/campos-sin-dato.cjs`
 *     en el CI), y sus archivos están en el registro de deuda (`campos-sin-dato--*`, con motivo, aprobadoPor y vencimiento).
 * Las evasiones (alias, createElement, tag dinámico, dangerouslySetInnerHTML, spread) fallan: ver `campos-con-dato-apoyo.ts`.
 * Previene: la primitiva del CUIT existía y el campo de documento de «Emitir» no la usaba (el CUIT quedó escrito como nombre).
 * Cada violación está inyectada en `campos-con-dato-evasiones.test.ts`: si se debilita el analizador, esa prueba falla.
 */

const RAIZ = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const presupuestoCjs = require("../../arquitectura/deuda/campos-sin-dato.cjs") as {
  PRESUPUESTOS: { archivo: string; claves: string[]; deQue: string }[];
  problemasDeForma: (p: unknown, presupuesto: unknown) => string[];
};
const PRESUPUESTO_DE_CAMPOS = presupuestoCjs
  .PRESUPUESTOS[0] as (typeof presupuestoCjs.PRESUPUESTOS)[number];
const PREFIJO_DE_DEUDA = "campos-sin-dato--";
const CONTEXTO: Contexto = { componentes: COMPONENTES_DE_CAMPO, registro: REGISTRO_DE_DATOS };

/** Las carpetas de las aplicaciones: los `workspaces` de `apps/` del `package.json` (una nueva entra sola). */
function aplicaciones(): string[] {
  const { workspaces } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  return workspaces
    .filter((w) => w.startsWith("apps/"))
    .flatMap((w) =>
      w.endsWith("/*")
        ? readdirSync(join(RAIZ, w.slice(0, -2)), { withFileTypes: true })
            .filter((d) => d.isDirectory())
            .map((d) => `${w.slice(0, -2)}/${d.name}`)
        : [w],
    );
}

/** TODO el código de las aplicaciones (todas las extensiones; los tests entran porque el tsconfig los compila). */
function archivosDeAplicaciones(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const app of aplicaciones()) {
    for (const r of readdirSync(join(RAIZ, app), { recursive: true, encoding: "utf8" })) {
      if (r.split("/").some((p) => p === "node_modules" || p === ".next")) continue;
      if (
        !EXTENSIONES_DE_CODIGO.includes(
          r.split(".").pop() as (typeof EXTENSIONES_DE_CODIGO)[number],
        )
      )
        continue;
      mapa.set(`${app}/${r}`, readFileSync(join(RAIZ, app, r), "utf8"));
    }
  }
  return mapa;
}

type Entrada = { id: string; archivos: string[]; verificacion?: { contiene: string } } & Record<
  string,
  unknown
>;

function deudaRegistrada(): Entrada[] {
  const libro = JSON.parse(
    readFileSync(join(RAIZ, "arquitectura/deuda/registro.json"), "utf8"),
  ) as Entrada[];
  return libro.filter((e) => e.id.startsWith(PREFIJO_DE_DEUDA));
}

describe("campos con dato: el código real", () => {
  const archivos = archivosDeAplicaciones();
  const esComponente = (r: string) => (COMPONENTES_DE_CAMPO as readonly string[]).includes(r);
  const resultados = new Map(
    [...archivos]
      .filter(([r]) => !esComponente(r))
      .map(([r, t]) => [r, analizarArchivo(r, t, CONTEXTO)]),
  );

  it("mira todas las aplicaciones y los componentes de campo (no pasa en vacío)", () => {
    expect(aplicaciones().length).toBeGreaterThanOrEqual(2);
    expect(COMPONENTES_DE_CAMPO.every((c) => archivos.has(c))).toBe(true);
    expect(resultados.size).toBeGreaterThan(20);
    // también los tests (el tsconfig los compila) y no solo los .tsx
    expect([...resultados.keys()].some((r) => r.includes(".test."))).toBe(true);
    expect([...resultados.keys()].some((r) => r.endsWith(".ts"))).toBe(true);
    expect([...resultados.values()].some((r) => r.pendientes > 0)).toBe(true);
    expect([...resultados.values()].some((r) => r.usos.size > 0)).toBe(true);
    expect(new Set([...resultados.keys()].map((r) => r.split("/")[1])).size).toBe(
      aplicaciones().length,
    );
  });

  it("ningún campo, tag ni evasión queda fuera del registro (todo nace cerrado)", () => {
    expect([...resultados.values()].flatMap((r) => r.problemas)).toEqual([]);
  });

  it("todo componente de campo declara la prop dato", () => {
    const problemas = COMPONENTES_DE_CAMPO.flatMap((c) =>
      problemasDeComponente(c, archivos.get(c) ?? ""),
    );
    expect(problemas).toEqual([]);
  });

  it("el registro coincide con la realidad: fichas, acciones, módulos, fuentes y consumidores", () => {
    const usos = new Map([...resultados].map(([r, v]) => [r, v.usos]));
    expect(problemasDelRegistro(REGISTRO_DE_DATOS, usos, (r) => existsSync(join(RAIZ, r)))).toEqual(
      [],
    );
  });

  const presupuesto = JSON.parse(
    readFileSync(join(RAIZ, PRESUPUESTO_DE_CAMPOS.archivo), "utf8"),
  ) as Record<string, Cuenta>;

  it("el presupuesto de deuda tiene buena forma y coincide EXACTO con el código", () => {
    expect(presupuestoCjs.problemasDeForma(presupuesto, PRESUPUESTO_DE_CAMPOS)).toEqual([]);
    const reales = new Map(
      [...resultados].map(([r, v]) => [
        r,
        { pendientes: v.pendientes, crudos: v.crudos, dinamicos: v.dinamicos },
      ]),
    );
    expect(problemasDeDeuda(reales, presupuesto)).toEqual([]);
  });

  it("el registro de deuda tiene motivo, aprobación y vencimiento, y cubre los archivos del presupuesto (cada uno con su texto)", () => {
    const entradas = deudaRegistrada();
    expect(entradas.length).toBeGreaterThan(0);
    for (const e of entradas) {
      expect(e["motivo"], e.id).toBeTruthy();
      expect(e["aprobadoPor"], e.id).toBeTruthy();
      expect(e["vence"], e.id).toBeTruthy();
      // El guardián solo exige que ALGÚN archivo de la entrada tenga el texto: acá, que TODOS lo tengan.
      // Las formas que el chequeo no analiza no tienen un texto común: los cubre el presupuesto, que coincide exacto con el código.
      if (e.id.endsWith("-otros")) continue;
      const texto = e.verificacion?.contiene ?? "";
      expect(texto, e.id).not.toBe("");
      for (const archivo of e.archivos)
        expect(archivos.get(archivo) ?? "", `${e.id}: ${archivo}`).toContain(texto);
    }
    const cubiertos = new Set(entradas.flatMap((e) => e.archivos));
    expect([...cubiertos].sort()).toEqual(Object.keys(presupuesto).sort());
  });

  it("la regla está escrita en CLAUDE.md (quitarla hace fallar la prueba)", () => {
    const claude = readFileSync(join(RAIZ, "CLAUDE.md"), "utf8");
    expect(claude).toContain("Sin dato registrado no hay campo");
    expect(claude).toContain("src/capacidades/datos/registro.ts");
  });

  it("revertir un componente de campo (sin la prop dato) se rechaza", () => {
    const ruta = COMPONENTES_DE_CAMPO[0];
    const texto = archivos.get(ruta) ?? "";
    const sinDato = texto.replace(/^\s*dato: DatoDeCampo;\n/m, "");
    expect(sinDato).not.toBe(texto);
    expect(problemasDeComponente(ruta, sinDato)).not.toEqual([]);
  });

  it("agregar un control crudo a un archivo ya listado hace fallar (el trinquete)", () => {
    const ruta = Object.keys(presupuesto)[0] ?? "";
    const texto = `${archivos.get(ruta) ?? ""}\nexport const Intruso = () => <input />;\n`;
    const r = analizarArchivo(ruta, texto, CONTEXTO);
    const reales = new Map([
      [ruta, { pendientes: r.pendientes, crudos: r.crudos, dinamicos: r.dinamicos }],
    ]);
    expect(
      problemasDeDeuda(reales, { ...presupuesto, [ruta]: presupuesto[ruta] as Cuenta }),
    ).not.toEqual([]);
    // y el mismo archivo sin tocar no falla por sí solo
    const igual = analizarArchivo(ruta, archivos.get(ruta) ?? "", CONTEXTO);
    expect(
      problemasDeDeuda(
        new Map([
          [
            ruta,
            { pendientes: igual.pendientes, crudos: igual.crudos, dinamicos: igual.dinamicos },
          ],
        ]),
        {
          [ruta]: presupuesto[ruta] as Cuenta,
        },
      ),
    ).toEqual([]);
  });
});
