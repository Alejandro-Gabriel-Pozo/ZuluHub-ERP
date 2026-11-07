import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

/**
 * REGLA: un `.tsx` que se renderiza en el SERVIDOR (alcanzable desde una página, un layout o una ruta de `app/` sin
 * cruzar antes un `"use client"`) no pone handlers (`onX`) en elementos HTML ni pasa una función (flecha, función o
 * una declarada en el mismo archivo) a una prop `onX`/`alX` de un componente. Lo que maneja eventos va en un
 * `.cliente.tsx` con `"use client"` y cruza la frontera ahí.
 * Previene: el error del servidor «Event handlers cannot be passed to Client Component props» (y «Functions cannot be
 * passed directly to Client Components»): una página o plantilla de servidor que renderiza `<Boton>` arma un
 * `<button onClick>` en el servidor y React no puede serializar la función al payload RSC. Pasó en la primera
 * prueba en vivo (digest 737071165): `next build` no ejecuta las páginas y las pruebas del navegador no renderizan
 * como RSC, así que nadie lo atrapó.
 *
 * Alcance: las aplicaciones son los `workspaces` del `package.json` (una nueva entra sola). Un archivo que solo
 * vive dentro del cliente (importado únicamente por `.cliente.tsx`) no se juzga: ya está del lado del navegador.
 * No se miran (decisión consciente): una función que llega como PARÁMETRO y se reenvía (`alTocar={alTocar}`),
 * porque no se puede juzgar sin tipos; las funciones con `"use server"` (acciones), que sí pueden cruzar; las
 * importaciones no relativas (las apps solo importan por ruta relativa).
 *
 * Cada violación está inyectada abajo: si se debilita el analizador o el recorrido, la prueba falla.
 */

const RAIZ = join(import.meta.dirname, "../..");

const ES_EVENTO_HOST = /^on[A-Z]/;
const ES_FUNCION_DE_COMPONENTE = /^(on|al)[A-Z]/;

function tieneDirectiva(cuerpo: readonly ts.Statement[], directiva: string): boolean {
  for (const sentencia of cuerpo) {
    if (!ts.isExpressionStatement(sentencia) || !ts.isStringLiteral(sentencia.expression))
      return false;
    if (sentencia.expression.text === directiva) return true;
  }
  return false;
}

function fuenteDe(nombre: string, texto: string): ts.SourceFile {
  return ts.createSourceFile(nombre, texto, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
}

const esDeCliente = (nombre: string, texto: string): boolean =>
  tieneDirectiva(fuenteDe(nombre, texto).statements, "use client");

function esFuncion(nodo: ts.Node): nodo is ts.ArrowFunction | ts.FunctionExpression {
  return ts.isArrowFunction(nodo) || ts.isFunctionExpression(nodo);
}

function esAccionDeServidor(nodo: ts.Node): boolean {
  const cuerpo =
    ts.isFunctionLike(nodo) && "body" in nodo && nodo.body !== undefined && ts.isBlock(nodo.body)
      ? nodo.body.statements
      : [];
  return tieneDirectiva(cuerpo, "use server");
}

/** Problemas de un archivo que se renderiza en el servidor (vacío si cumple, o si es de cliente). */
export function problemasDeFrontera(nombre: string, texto: string): string[] {
  const fuente = fuenteDe(nombre, texto);
  if (tieneDirectiva(fuente.statements, "use client")) return [];

  const funcionesLocales = new Set<string>();
  const recolectar = (nodo: ts.Node): void => {
    if (ts.isFunctionDeclaration(nodo) && nodo.name !== undefined && !esAccionDeServidor(nodo)) {
      funcionesLocales.add(nodo.name.text);
    }
    if (
      ts.isVariableDeclaration(nodo) &&
      ts.isIdentifier(nodo.name) &&
      nodo.initializer !== undefined &&
      esFuncion(nodo.initializer) &&
      !esAccionDeServidor(nodo.initializer)
    ) {
      funcionesLocales.add(nodo.name.text);
    }
    ts.forEachChild(nodo, recolectar);
  };
  recolectar(fuente);

  const problemas: string[] = [];
  const mirar = (nodo: ts.Node): void => {
    if (ts.isJsxOpeningElement(nodo) || ts.isJsxSelfClosingElement(nodo)) {
      const etiqueta = nodo.tagName.getText(fuente);
      const esHost = /^[a-z]/.test(etiqueta);
      for (const atributo of nodo.attributes.properties) {
        if (!ts.isJsxAttribute(atributo)) continue;
        const propiedad = atributo.name.getText(fuente);
        const linea = fuente.getLineAndCharacterOfPosition(atributo.getStart(fuente)).line + 1;
        if (esHost) {
          if (ES_EVENTO_HOST.test(propiedad)) {
            problemas.push(
              `${nombre}:${linea} <${etiqueta} ${propiedad}> pone un handler en un elemento HTML en el servidor`,
            );
          }
          continue;
        }
        if (!ES_FUNCION_DE_COMPONENTE.test(propiedad)) continue;
        const valor = atributo.initializer;
        if (valor === undefined || !ts.isJsxExpression(valor) || valor.expression === undefined)
          continue;
        const expresion = valor.expression;
        const esFuncionLocal = ts.isIdentifier(expresion) && funcionesLocales.has(expresion.text);
        if ((esFuncion(expresion) && !esAccionDeServidor(expresion)) || esFuncionLocal) {
          problemas.push(
            `${nombre}:${linea} <${etiqueta} ${propiedad}> pasa una función desde el servidor`,
          );
        }
      }
    }
    ts.forEachChild(nodo, mirar);
  };
  mirar(fuente);
  return problemas;
}

/** Importaciones (de valor) relativas de un archivo, resueltas contra los archivos conocidos. */
function importacionesDe(ruta: string, texto: string, conocidos: ReadonlySet<string>): string[] {
  const resueltas: string[] = [];
  for (const sentencia of fuenteDe(ruta, texto).statements) {
    const esImport = ts.isImportDeclaration(sentencia);
    const esExport = ts.isExportDeclaration(sentencia);
    if (!esImport && !esExport) continue;
    const especificador = sentencia.moduleSpecifier;
    if (especificador === undefined || !ts.isStringLiteral(especificador)) continue;
    if (esImport && sentencia.importClause?.isTypeOnly === true) continue;
    if (esExport && sentencia.isTypeOnly) continue;
    if (!especificador.text.startsWith(".")) continue;
    const base = normalize(join(dirname(ruta), especificador.text));
    const candidato = [
      base,
      `${base}.ts`,
      `${base}.tsx`,
      join(base, "index.ts"),
      join(base, "index.tsx"),
    ].find((c) => conocidos.has(c));
    if (candidato !== undefined) resueltas.push(candidato);
  }
  return resueltas;
}

/**
 * Los archivos que se ejecutan en el servidor: las entradas (todo lo que está bajo una carpeta `app/` de una
 * aplicación y no es de cliente) y lo que importan, sin atravesar nunca un archivo con `"use client"`.
 */
export function archivosDeServidor(archivos: ReadonlyMap<string, string>): string[] {
  const conocidos = new Set(archivos.keys());
  const alcanzados = new Set<string>();
  const pendientes: string[] = [];
  const sumar = (ruta: string): void => {
    const texto = archivos.get(ruta);
    if (texto === undefined || alcanzados.has(ruta) || esDeCliente(ruta, texto)) return;
    alcanzados.add(ruta);
    pendientes.push(ruta);
  };
  for (const ruta of conocidos) if (/(^|\/)app\//.test(ruta)) sumar(ruta);
  for (let ruta = pendientes.pop(); ruta !== undefined; ruta = pendientes.pop()) {
    for (const importada of importacionesDe(ruta, archivos.get(ruta) ?? "", conocidos))
      sumar(importada);
  }
  return [...alcanzados].sort();
}

/** Problemas de frontera de todo lo que corre en el servidor, dado el conjunto de archivos de las aplicaciones. */
export function problemasDelServidor(archivos: ReadonlyMap<string, string>): string[] {
  return archivosDeServidor(archivos)
    .filter((ruta) => ruta.endsWith(".tsx"))
    .flatMap((ruta) => problemasDeFrontera(ruta, archivos.get(ruta) ?? ""));
}

function fuentesDeProduccion(): Map<string, string> {
  const { workspaces } = JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
    workspaces: string[];
  };
  const mapa = new Map<string, string>();
  for (const patron of workspaces) {
    const carpeta = patron.replace(/\/\*$/, "");
    for (const ruta of readdirSync(join(RAIZ, carpeta), { recursive: true, encoding: "utf8" })) {
      const partes = ruta.split("/");
      if (partes.some((p) => p === "node_modules" || p === ".next")) continue;
      if (!/\.tsx?$/.test(ruta) || /\.test\.tsx?$/.test(ruta) || ruta.endsWith(".d.ts")) continue;
      mapa.set(join(carpeta, ruta), readFileSync(join(RAIZ, carpeta, ruta), "utf8"));
    }
  }
  return mapa;
}

describe("frontera servidor/cliente: el código real", () => {
  const archivos = fuentesDeProduccion();
  const delServidor = archivosDeServidor(archivos);

  it("mira el código de las aplicaciones y llega a las plantillas de servidor (no pasa en vacío)", () => {
    expect(delServidor.some((a) => a.endsWith("/app/layout.tsx"))).toBe(true);
    expect(delServidor.some((a) => a.includes("/ui/plantillas/"))).toBe(true);
    expect(new Set(delServidor.map((a) => a.split("/")[1])).size).toBeGreaterThan(1);
  });

  it("nada de lo que corre en el servidor pone handlers en un elemento HTML ni pasa funciones a un componente", () => {
    expect(problemasDelServidor(archivos)).toEqual([]);
  });

  it("sin la directiva, el Boton real se rechaza (revertir el arreglo hace fallar la regla)", () => {
    const ruta = [...archivos.keys()].find((a) =>
      /\/ui\/componentes\/Boton(\.cliente)?\.tsx$/.test(a),
    );
    expect(ruta).toBeDefined();
    const texto = archivos.get(ruta ?? "") ?? "";
    expect(esDeCliente(ruta ?? "", texto)).toBe(true);
    const sinDirectiva = texto.replace(/^\s*["']use client["'];?\s*/, "");
    expect(sinDirectiva).not.toBe(texto);
    expect(problemasDeFrontera("Boton.tsx", sinDirectiva)).not.toEqual([]);
    // Y dentro del recorrido real: con la directiva quitada, las plantillas de servidor que lo usan lo arrastran.
    const revertido = new Map(archivos).set(ruta ?? "", sinDirectiva);
    expect(problemasDelServidor(revertido).some((p) => p.includes("pone un handler"))).toBe(true);
  });
});

describe("frontera servidor/cliente: violaciones inyectadas", () => {
  const HOST = `export function A() { return <button onClick={() => {}}>x</button>; }`;

  it("rechaza un handler en un elemento HTML sin la directiva", () => {
    expect(problemasDeFrontera("A.tsx", HOST)).toHaveLength(1);
  });

  it("acepta el mismo archivo con la directiva en primera posición", () => {
    expect(problemasDeFrontera("A.tsx", `"use client";\n${HOST}`)).toEqual([]);
    expect(problemasDeFrontera("A.tsx", `// nota\n'use client'\n${HOST}`)).toEqual([]);
  });

  it("la directiva no cuenta si viene después de una importación ni si solo está en un comentario o texto", () => {
    expect(problemasDeFrontera("A.tsx", `import "x";\n"use client";\n${HOST}`)).toHaveLength(1);
    expect(problemasDeFrontera("A.tsx", `// "use client"\n${HOST}`)).toHaveLength(1);
    expect(problemasDeFrontera("A.tsx", `const t = "use client";\n${HOST}`)).toHaveLength(1);
  });

  it("rechaza todo handler de elemento HTML (onChange, onSubmit, onKeyDown...)", () => {
    for (const evento of ["onChange", "onSubmit", "onKeyDown", "onFocus", "onBlur", "onCancel"]) {
      const texto = `export const A = () => <input ${evento}={manejar} />;`;
      expect(problemasDeFrontera("A.tsx", texto), evento).toHaveLength(1);
    }
  });

  it("rechaza una función pasada a un componente desde un archivo de servidor", () => {
    const flecha = `export function P() { return <Boton alTocar={() => {}}>x</Boton>; }`;
    const local = `function ir() {}\nexport function P() { return <Boton alTocar={ir}>x</Boton>; }`;
    const constante = `const ir = () => {};\nexport function P() { return <Campo alCambiar={ir} />; }`;
    const miembro = `export function P() { return <Ns.Boton onClick={function () {}}>x</Ns.Boton>; }`;
    for (const texto of [flecha, local, constante, miembro]) {
      expect(problemasDeFrontera("P.tsx", texto), texto).toHaveLength(1);
      expect(problemasDeFrontera("P.tsx", `"use client";\n${texto}`), texto).toEqual([]);
    }
  });

  it("acepta lo que serializa: datos, texto, props sin función y funciones recibidas como parámetro", () => {
    const texto = [
      `export function P({ alTocar }: { alTocar: () => void }) {`,
      `  return <Boton deshabilitado motivo="x" alTocar={alTocar} alCambiar={undefined}>x</Boton>;`,
      `}`,
    ].join("\n");
    expect(problemasDeFrontera("P.tsx", texto)).toEqual([]);
  });

  it('acepta una acción de servidor ("use server") pasada a un componente', () => {
    const texto = [
      `export function P() {`,
      `  async function enviar() { "use server"; }`,
      `  return <Formulario alEnviar={enviar} alTocar={async () => { "use server"; }} />;`,
      `}`,
    ].join("\n");
    expect(problemasDeFrontera("P.tsx", texto)).toEqual([]);
  });
});

describe("frontera servidor/cliente: recorrido de lo que corre en el servidor", () => {
  const PAGINA = `import { Pantalla } from "../ui/Pantalla";\nexport default function Pagina() { return <Pantalla />; }`;
  const PANTALLA = `import { Boton } from "./Boton";\nexport function Pantalla() { return <Boton>x</Boton>; }`;
  const BOTON = `export function Boton({ alTocar }: { alTocar?: () => void }) { return <button onClick={() => alTocar?.()}>x</button>; }`;
  const arbol = (boton: string): Map<string, string> =>
    new Map([
      ["web/app/page.tsx", PAGINA],
      ["web/ui/Pantalla.tsx", PANTALLA],
      ["web/ui/Boton.tsx", boton],
    ]);

  it("rechaza un handler que llega al servidor a través de una plantilla (el caso del dueño)", () => {
    const problemas = problemasDelServidor(arbol(BOTON));
    expect(problemas).toHaveLength(1);
    expect(problemas[0]).toContain("web/ui/Boton.tsx");
  });

  it('acepta el mismo árbol si el componente interactivo es de cliente ("use client")', () => {
    expect(problemasDelServidor(arbol(`"use client";\n${BOTON}`))).toEqual([]);
  });

  it("no juzga lo que solo vive dentro del cliente (importado únicamente por un archivo de cliente)", () => {
    const soloCliente = new Map([
      [
        "web/app/page.tsx",
        `import { Isla } from "../ui/Isla.cliente";\nexport default function P() { return <Isla />; }`,
      ],
      [
        "web/ui/Isla.cliente.tsx",
        `"use client";\nimport { Boton } from "./Boton";\nexport function Isla() { return <Boton>x</Boton>; }`,
      ],
      ["web/ui/Boton.tsx", BOTON],
    ]);
    expect(archivosDeServidor(soloCliente)).toEqual(["web/app/page.tsx"]);
    expect(problemasDelServidor(soloCliente)).toEqual([]);
  });

  it("rechaza una función que una página de servidor le pasa a un componente de cliente", () => {
    const conFuncion = new Map([
      [
        "web/app/page.tsx",
        `import { Boton } from "../ui/Boton.cliente";\nexport default function P() { return <Boton alTocar={() => {}}>x</Boton>; }`,
      ],
      ["web/ui/Boton.cliente.tsx", `"use client";\n${BOTON}`],
    ]);
    expect(problemasDelServidor(conFuncion)).toHaveLength(1);
  });

  it("sigue los index y las reexportaciones, salta los tipos y no se pierde con ciclos", () => {
    const raro = new Map([
      [
        "web/app/page.tsx",
        `import type { T } from "../ui/Tipos";\nimport { Pantalla } from "../ui";\nexport default () => <Pantalla />;`,
      ],
      ["web/ui/index.ts", `export { Pantalla } from "./Pantalla";`],
      [
        "web/ui/Pantalla.tsx",
        `import { Pantalla as P } from "./Pantalla";\nexport function Pantalla() { return null; }`,
      ],
      ["web/ui/Tipos.tsx", BOTON],
    ]);
    expect(archivosDeServidor(raro)).toEqual([
      "web/app/page.tsx",
      "web/ui/Pantalla.tsx",
      "web/ui/index.ts",
    ]);
  });
});
