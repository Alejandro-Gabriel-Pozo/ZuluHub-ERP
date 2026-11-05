import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";
import {
  COMPONENTES_DE_CAMPO,
  DATO_PENDIENTE,
  REGISTRO_DE_DATOS,
  type DefinicionDeDato,
} from "../../src/capacidades/datos/registro";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";

/**
 * REGLA (regla 5 de `Pedernal-docs/01-vision/primitivas-de-negocio.md`; dueño, 2026-11-05): sin dato registrado no hay campo.
 * En `apps/web` y `apps/plataforma`:
 *  1. un `<input>`, `<textarea>` o `<select>` crudo solo puede vivir en un componente de campo (`COMPONENTES_DE_CAMPO`); el
 *     `<input type="hidden" name=…>` no es un campo del usuario y se admite;
 *  2. todo uso de un componente de campo lleva `dato="…"` con un literal que existe en el registro (o `"pendiente"`, que es deuda);
 *  3. el archivo que lo usa figura entre los `consumidores` de ese dato (consumidor no declarado falla);
 *  4. un dato registrado cuyos consumidores no lo usan, o sin consumidores, falla (huérfano);
 *  5. lo `pendiente` y los controles crudos existentes están en `arquitectura/deuda/registro.json` (entradas `campos-sin-dato--*`,
 *     con motivo, aprobadoPor y vencimiento); lo nuevo falla y lo saldado se saca del registro (el trinquete solo baja).
 * Previene: la primitiva del CUIT existía y el campo de documento de «Emitir» no la usaba (el CUIT quedó escrito como nombre).
 *
 * Fail-closed: un `dato` que no es un literal, un `{...props}` después del `dato` (podría pisarlo), o un componente de campo sin la prop `dato`
 * tipada como `DatoDeCampo` fallan. No se mira (límite declarado): un componente de campo que otro componente envuelve y reenvía
 * (su `dato` llegaría dinámico: falla igual y se declara `pendiente` dentro del envoltorio hasta que se ligue al registro).
 * Cada violación está inyectada abajo: si se debilita el analizador, la prueba falla.
 */

const RAIZ = join(import.meta.dirname, "../..");
const PREFIJO_DE_DEUDA = "campos-sin-dato--";
const CONTROLES_CRUDOS = new Set(["input", "textarea", "select"]);

type Registro = Readonly<Record<string, DefinicionDeDato>>;
type Contexto = Readonly<{
  componentes: readonly string[];
  registro: Registro;
}>;
export type ResultadoDeArchivo = Readonly<{
  problemas: string[];
  pendientes: number;
  crudos: number;
  usos: ReadonlyMap<string, number>;
}>;

const nombreDeComponente = (ruta: string): string =>
  (ruta.split("/").pop() ?? ruta).replace(/\.tsx$/, "");

function atributo(
  atributos: readonly ts.JsxAttributeLike[],
  nombre: string,
  fuente: ts.SourceFile,
): ts.JsxAttribute | undefined {
  return atributos.find(
    (a): a is ts.JsxAttribute => ts.isJsxAttribute(a) && a.name.getText(fuente) === nombre,
  );
}

/** El literal de texto de un atributo JSX (`x="a"` o `x={"a"}`), o `undefined` si es dinámico. */
function literalDe(attr: ts.JsxAttribute): string | undefined {
  const valor = attr.initializer;
  if (valor === undefined) return undefined;
  if (ts.isStringLiteral(valor)) return valor.text;
  if (ts.isJsxExpression(valor) && valor.expression !== undefined) {
    const e = valor.expression;
    if (ts.isStringLiteral(e) || ts.isNoSubstitutionTemplateLiteral(e)) return e.text;
  }
  return undefined;
}

/** Problemas, deuda y usos de un archivo de pantalla (no de un componente de campo). */
export function analizarArchivo(
  ruta: string,
  texto: string,
  contexto: Contexto,
): ResultadoDeArchivo {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const nombres = new Set(contexto.componentes.map(nombreDeComponente));
  const problemas: string[] = [];
  const usos = new Map<string, number>();
  let pendientes = 0;
  let crudos = 0;

  const mirar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const etiqueta = ts.isPropertyAccessExpression(nodo.tagName)
        ? nodo.tagName.name.text
        : nodo.tagName.getText(fuente);
      const linea = fuente.getLineAndCharacterOfPosition(nodo.getStart(fuente)).line + 1;
      const atributos = nodo.attributes.properties;
      if (CONTROLES_CRUDOS.has(etiqueta)) {
        const tipo = atributo(atributos, "type", fuente);
        const oculto = tipo !== undefined && literalDe(tipo) === "hidden";
        if (oculto && atributo(atributos, "name", fuente) !== undefined) {
          // No es un campo que el usuario escriba.
        } else {
          crudos += 1;
        }
      } else if (nombres.has(etiqueta)) {
        const donde = `${ruta}:${linea} <${etiqueta}>`;
        const dato = atributo(atributos, "dato", fuente);
        const literal = dato === undefined ? undefined : literalDe(dato);
        const despuesDelDato =
          dato === undefined
            ? []
            : atributos
                .slice(atributos.indexOf(dato) + 1)
                .filter((a) => ts.isJsxSpreadAttribute(a));
        if (despuesDelDato.length > 0) {
          problemas.push(`${donde} usa {...props} después de dato: podría pisarlo`);
        } else if (dato === undefined) {
          problemas.push(`${donde} no declara qué dato pide (falta la prop dato)`);
        } else if (literal === undefined) {
          problemas.push(`${donde} declara su dato con una expresión: tiene que ser un literal`);
        } else if (literal === DATO_PENDIENTE) {
          pendientes += 1;
        } else {
          const definicion = contexto.registro[literal];
          if (definicion === undefined) {
            problemas.push(
              `${donde} pide el dato «${literal}», que no está en el registro de datos`,
            );
          } else if (!definicion.consumidores.includes(ruta)) {
            problemas.push(
              `${donde} pide el dato «${literal}» pero ${ruta} no figura entre sus consumidores`,
            );
          } else {
            usos.set(literal, (usos.get(literal) ?? 0) + 1);
          }
        }
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  if (crudos > 0) {
    problemas.push(
      `${ruta} tiene ${crudos} control(es) crudo(s) (input, textarea o select) fuera de un componente de campo`,
    );
  }
  return { problemas, pendientes, crudos, usos };
}

/** Un componente de campo declara la prop `dato` tipada como `DatoDeCampo`. */
export function problemasDeComponente(ruta: string, texto: string): string[] {
  const fuente = ts.createSourceFile(ruta, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let correcto = false;
  const mirar = (nodo: ts.Node): void => {
    if (
      ts.isPropertySignature(nodo) &&
      nodo.name.getText(fuente) === "dato" &&
      nodo.questionToken === undefined &&
      nodo.type?.getText(fuente) === "DatoDeCampo"
    ) {
      correcto = true;
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return correcto
    ? []
    : [`${ruta} es un componente de campo y no declara «dato: DatoDeCampo» (obligatoria)`];
}

const accionesDelCatalogo = (): Set<string> =>
  new Set(Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones)));

/** El registro contra la realidad: fichas, acciones, módulos, fuentes y consumidores que de verdad lo piden. */
export function problemasDelRegistro(
  registro: Registro,
  usosPorArchivo: ReadonlyMap<string, ReadonlyMap<string, number>>,
  existe: (ruta: string) => boolean,
): string[] {
  const problemas: string[] = [];
  const acciones = accionesDelCatalogo();
  for (const [id, d] of Object.entries(registro)) {
    if (!existe(d.ficha)) problemas.push(`${id}: la ficha ${d.ficha} no existe`);
    if (d.propositos.length === 0) problemas.push(`${id}: no dice para qué existe`);
    for (const p of d.propositos) {
      if (p.para.trim() === "" || !/\.md\b/.test(p.fuente)) {
        problemas.push(
          `${id}: cada propósito lleva «para» y una fuente verificable (un documento .md)`,
        );
      }
    }
    if (d.consumidores.length === 0)
      problemas.push(`${id}: dato huérfano, no tiene consumidores declarados`);
    for (const c of d.consumidores) {
      if (!existe(c)) problemas.push(`${id}: el consumidor ${c} no existe`);
      else if ((usosPorArchivo.get(c)?.get(id) ?? 0) === 0) {
        problemas.push(
          `${id}: el consumidor ${c} declarado no pide el dato (huérfano o desactualizado)`,
        );
      }
    }
    if (d.ponerPor.length === 0) problemas.push(`${id}: no dice quién puede ponerlo`);
    for (const a of d.ponerPor) {
      if (!acciones.has(a))
        problemas.push(`${id}: la acción de permiso «${a}» no existe en el catálogo`);
    }
    if (!(d.requiere.modulo in CATALOGO_DE_MODULOS)) {
      problemas.push(`${id}: el módulo «${d.requiere.modulo}» no existe en el catálogo`);
    }
    if (d.requiere.estadoDeEmpresa.length === 0)
      problemas.push(`${id}: no dice en qué estado de empresa existe`);
  }
  return problemas;
}

/** Deuda: lo pendiente o crudo tiene que estar en el registro de deuda, y lo registrado tiene que seguir existiendo. */
export function problemasDeDeuda(
  conDeuda: ReadonlySet<string>,
  registrada: ReadonlySet<string>,
): string[] {
  return [
    ...[...conDeuda]
      .filter((r) => !registrada.has(r))
      .map(
        (r) =>
          `${r} tiene campos sin dato o controles crudos y no está en la deuda registrada (deuda nueva)`,
      ),
    ...[...registrada]
      .filter((r) => !conDeuda.has(r))
      .map(
        (r) =>
          `${r} ya no tiene deuda de campos: sacalo de ${PREFIJO_DE_DEUDA}* en arquitectura/deuda/registro.json`,
      ),
  ];
}

function archivosDeProduccion(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const app of ["apps/web", "apps/plataforma"]) {
    for (const r of readdirSync(join(RAIZ, app), { recursive: true, encoding: "utf8" })) {
      if (r.split("/").some((p) => p === "node_modules" || p === ".next")) continue;
      if (!r.endsWith(".tsx") || r.endsWith(".test.tsx")) continue;
      mapa.set(`${app}/${r}`, readFileSync(join(RAIZ, app, r), "utf8"));
    }
  }
  return mapa;
}

function deudaRegistrada(): { archivos: Set<string>; entradas: Record<string, unknown>[] } {
  const libro = JSON.parse(
    readFileSync(join(RAIZ, "arquitectura/deuda/registro.json"), "utf8"),
  ) as Record<string, unknown>[];
  const entradas = libro.filter((e) => String(e["id"]).startsWith(PREFIJO_DE_DEUDA));
  return {
    entradas,
    archivos: new Set(entradas.flatMap((e) => (e["archivos"] as string[] | undefined) ?? [])),
  };
}

const CONTEXTO_REAL: Contexto = { componentes: COMPONENTES_DE_CAMPO, registro: REGISTRO_DE_DATOS };

describe("campos con dato: el código real", () => {
  const archivos = archivosDeProduccion();
  const pantallas = [...archivos].filter(
    ([r]) => !(COMPONENTES_DE_CAMPO as readonly string[]).includes(r),
  );
  const resultados = new Map(pantallas.map(([r, t]) => [r, analizarArchivo(r, t, CONTEXTO_REAL)]));

  it("mira el código de las dos aplicaciones y de los componentes de campo (no pasa en vacío)", () => {
    expect(COMPONENTES_DE_CAMPO.every((c) => archivos.has(c))).toBe(true);
    expect(pantallas.length).toBeGreaterThan(20);
    expect([...resultados.values()].some((r) => r.pendientes > 0)).toBe(true);
    expect([...resultados.values()].some((r) => r.usos.size > 0)).toBe(true);
    expect(new Set(pantallas.map(([r]) => r.split("/")[1])).size).toBe(2);
  });

  it("ningún campo ni control crudo queda fuera del registro (todo nace cerrado)", () => {
    const problemas = [...resultados.values()].flatMap((r) => r.problemas);
    // Los controles crudos existentes se informan como deuda, no como problema nuevo: se juzgan abajo.
    expect(problemas.filter((p) => !p.includes("control(es) crudo(s)"))).toEqual([]);
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

  it("la deuda de campos está registrada con motivo, aprobación y vencimiento, y no crece", () => {
    const { archivos: registrada, entradas } = deudaRegistrada();
    expect(entradas.length).toBeGreaterThan(0);
    for (const e of entradas) {
      expect(e["motivo"], String(e["id"])).toBeTruthy();
      expect(e["aprobadoPor"], String(e["id"])).toBeTruthy();
      expect(e["vence"], String(e["id"])).toBeTruthy();
    }
    const conDeuda = new Set(
      [...resultados].filter(([, r]) => r.pendientes > 0 || r.crudos > 0).map(([ruta]) => ruta),
    );
    expect(problemasDeDeuda(conDeuda, registrada)).toEqual([]);
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
});

describe("campos con dato: violaciones inyectadas", () => {
  const contexto: Contexto = {
    componentes: ["x/Campo.tsx", "x/Selector.tsx"],
    registro: {
      cuit: {
        ficha: "f.ts",
        propositos: [{ para: "emitir", fuente: "doc.md §1" }],
        consumidores: ["p/Emitir.tsx"],
        ponerPor: ["comprobantes.emitir"],
        requiere: { modulo: "facturacion", estadoDeEmpresa: ["ACTIVE"] },
      },
    },
  };
  const analizar = (texto: string, ruta = "p/Emitir.tsx") => analizarArchivo(ruta, texto, contexto);
  const pantalla = (cuerpo: string) => `export const P = () => <div>${cuerpo}</div>;`;

  it("rechaza un input, textarea o select crudo", () => {
    for (const etiqueta of [
      "<input />",
      "<textarea />",
      "<select />",
      `<input type="text" name="a" />`,
    ]) {
      const r = analizar(pantalla(etiqueta));
      expect(r.crudos, etiqueta).toBe(1);
      expect(r.problemas, etiqueta).toHaveLength(1);
    }
  });

  it("admite el input oculto con name, y rechaza el oculto sin name", () => {
    expect(analizar(pantalla(`<input type="hidden" name="a" value="1" />`)).problemas).toEqual([]);
    expect(analizar(pantalla(`<input type="hidden" value="1" />`)).problemas).toHaveLength(1);
  });

  it("rechaza un campo sin dato, con dato dinámico o con {...props}", () => {
    expect(analizar(pantalla(`<Campo etiqueta="a" />`)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato={x} />`)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato={\`a\${x}\`} />`)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato="cuit" {...props} />`)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo {...props} />`)).problemas).toHaveLength(1);
    // Un {...props} ANTES del dato no puede pisarlo: el dato declarado es el que vale.
    expect(analizar(pantalla(`<Campo {...props} dato="cuit" />`)).problemas).toEqual([]);
    expect(analizar(pantalla(`<Ns.Selector />`)).problemas).toHaveLength(1);
  });

  it("rechaza un dato que no está en el registro", () => {
    const r = analizar(pantalla(`<Campo dato="inventado" />`));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("no está en el registro");
  });

  it("rechaza un consumidor no declarado", () => {
    const r = analizar(pantalla(`<Campo dato="cuit" />`), "p/Otra.tsx");
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("no figura entre sus consumidores");
  });

  it("acepta un dato registrado con su consumidor, en las dos formas del literal, y cuenta lo pendiente", () => {
    const r = analizar(
      pantalla(`<Campo dato="cuit" /><Selector dato={"cuit"} /><Campo dato="pendiente" />`),
    );
    expect(r.problemas).toEqual([]);
    expect(r.usos.get("cuit")).toBe(2);
    expect(r.pendientes).toBe(1);
  });

  it("no juzga lo que no es un componente de campo", () => {
    expect(analizar(pantalla(`<Boton dato={x} /><div />`)).problemas).toEqual([]);
  });

  it("rechaza un dato huérfano, sin consumidores, con ficha, acción o módulo inexistentes", () => {
    const base = contexto.registro["cuit"] as DefinicionDeDato;
    const usos = new Map([["p/Emitir.tsx", new Map([["cuit", 1]])]]);
    const siempre = () => true;
    expect(problemasDelRegistro(contexto.registro, usos, siempre)).toEqual([]);
    expect(problemasDelRegistro(contexto.registro, new Map(), siempre)).toHaveLength(1);
    const sin = (parcial: object) => ({ cuit: { ...base, ...parcial } }) as Registro;
    expect(problemasDelRegistro(sin({ consumidores: [] }), usos, siempre)).toHaveLength(1);
    expect(problemasDelRegistro(contexto.registro, usos, () => false)).toHaveLength(2);
    expect(problemasDelRegistro(sin({ ponerPor: ["x.y"] }), usos, siempre)).toHaveLength(1);
    expect(problemasDelRegistro(sin({ ponerPor: [] }), usos, siempre)).toHaveLength(1);
    expect(
      problemasDelRegistro(
        sin({ requiere: { modulo: "no", estadoDeEmpresa: ["ACTIVE"] } }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
    expect(
      problemasDelRegistro(
        sin({ requiere: { modulo: "facturacion", estadoDeEmpresa: [] } }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
    expect(problemasDelRegistro(sin({ propositos: [] }), usos, siempre)).toHaveLength(1);
    expect(
      problemasDelRegistro(
        sin({ propositos: [{ para: "a", fuente: "me lo dijo el backend" }] }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
  });

  it("rechaza deuda nueva sin registrar y deuda saldada que sigue en el registro", () => {
    expect(problemasDeDeuda(new Set(["a"]), new Set(["a"]))).toEqual([]);
    expect(problemasDeDeuda(new Set(["a", "b"]), new Set(["a"]))).toHaveLength(1);
    expect(problemasDeDeuda(new Set(["a"]), new Set(["a", "c"]))).toHaveLength(1);
  });

  it("rechaza un componente de campo sin la prop dato, opcional o con otro tipo", () => {
    const con = `export type P = Readonly<{ dato: DatoDeCampo; etiqueta: string }>;`;
    expect(problemasDeComponente("x/Campo.tsx", con)).toEqual([]);
    expect(
      problemasDeComponente("x/Campo.tsx", `export type P = Readonly<{ etiqueta: string }>;`),
    ).toHaveLength(1);
    expect(
      problemasDeComponente("x/Campo.tsx", `export type P = Readonly<{ dato?: DatoDeCampo }>;`),
    ).toHaveLength(1);
    expect(
      problemasDeComponente("x/Campo.tsx", `export type P = Readonly<{ dato: string }>;`),
    ).toHaveLength(1);
  });
});
