import { describe, expect, it } from "vitest";
import {
  analizarArchivo,
  importadosFueraDe,
  problemasFueraDeLasApps,
  type Contexto,
  type Registro,
} from "./campos-con-dato-apoyo";
import {
  problemasDeComponente,
  problemasDeDeuda,
  problemasDelRegistro,
} from "./campos-con-dato-registro-apoyo";

/**
 * Violaciones inyectadas de `campos-con-dato.test.ts` (regla 5: sin dato registrado no hay campo). Cada caso es una forma de
 * esquivar el chequeo o de dejar un campo sin dato; si se debilita el analizador (`campos-con-dato-apoyo.ts`), el caso correspondiente
 * deja de fallar y esta prueba se pone roja. Lo que el analizador no puede entender falla (fail-closed): se cuenta como deuda
 * (tags dinámicos) o es un problema.
 */

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
const pantalla = (cuerpo: string, antes = "") =>
  `${antes}\nexport const P = () => <div>${cuerpo}</div>;`;
const IMPORTA = `import { Campo } from "x/Campo";`;

describe("campos con dato: controles crudos", () => {
  it("rechaza un input, textarea o select crudo y los cuenta por etiqueta", () => {
    for (const etiqueta of ["input", "textarea", "select"]) {
      const r = analizar(pantalla(`<${etiqueta} />`));
      expect(r.crudos, etiqueta).toBe(1);
      expect(r.crudosPorEtiqueta.get(etiqueta), etiqueta).toBe(1);
    }
    expect(analizar(pantalla(`<input type="text" name="a" />`)).crudos).toBe(1);
  });

  it("exime solo el input oculto con type y name literales y SIN ningún spread", () => {
    expect(analizar(pantalla(`<input type="hidden" name="a" value="1" />`)).crudos).toBe(0);
    expect(analizar(pantalla(`<input type={"hidden"} name={"a"} />`)).crudos).toBe(0);
    expect(analizar(pantalla(`<input type="hidden" value="1" />`)).crudos).toBe(1);
    expect(analizar(pantalla(`<input type={t} name="a" />`)).crudos).toBe(1);
    expect(analizar(pantalla(`<input type="hidden" name={n} />`)).crudos).toBe(1);
    expect(analizar(pantalla(`<input type="hidden" name="a" {...p} />`)).crudos).toBe(1);
    expect(analizar(pantalla(`<input {...p} type="hidden" name="a" />`)).crudos).toBe(1);
    expect(analizar(pantalla(`<textarea type="hidden" name="a" />`)).crudos).toBe(1);
  });
});

describe("campos con dato: el dato del campo", () => {
  it("rechaza un campo sin dato, con dato dinámico o con {...props} después del dato", () => {
    expect(analizar(pantalla(`<Campo etiqueta="a" />`, IMPORTA)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato={x} />`, IMPORTA)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato={\`a\${x}\`} />`, IMPORTA)).problemas).toHaveLength(1);
    expect(analizar(pantalla(`<Campo dato="cuit" {...props} />`, IMPORTA)).problemas).toHaveLength(
      1,
    );
    expect(analizar(pantalla(`<Campo {...props} />`, IMPORTA)).problemas).toHaveLength(1);
    // Un {...props} ANTES del dato no puede pisarlo: el dato declarado es el que vale.
    expect(analizar(pantalla(`<Campo {...props} dato="cuit" />`, IMPORTA)).problemas).toEqual([]);
  });

  it("rechaza un dato que no está en el registro y un consumidor no declarado", () => {
    const r = analizar(pantalla(`<Campo dato="inventado" />`, IMPORTA));
    expect(r.problemas).toHaveLength(1);
    expect(r.problemas[0]).toContain("no está en el registro");
    const otro = analizar(pantalla(`<Campo dato="cuit" />`, IMPORTA), "p/Otra.tsx");
    expect(otro.problemas).toHaveLength(1);
    expect(otro.problemas[0]).toContain("no figura entre sus consumidores");
  });

  it("acepta un dato registrado con su consumidor, en las dos formas del literal, y cuenta lo pendiente", () => {
    const r = analizar(
      pantalla(
        `<Campo dato="cuit" /><Selector dato={"cuit"} /><Campo dato="pendiente" />`,
        IMPORTA,
      ),
    );
    expect(r.problemas).toEqual([]);
    expect(r.usos.get("cuit")).toBe(2);
    expect(r.pendientes).toBe(1);
  });
});

describe("campos con dato: las evasiones fallan (fail-closed)", () => {
  const cuenta = (texto: string, ruta = "p/Emitir.tsx") => analizar(texto, ruta).crudos;

  it("rechaza el alias del componente de campo (import, constante, referencia suelta)", () => {
    expect(
      analizar(pantalla(`<C dato="cuit" />`, `import { Campo as C } from "x/Campo";`)).problemas,
    ).not.toEqual([]);
    expect(
      analizar(pantalla(`<C2 dato="cuit" />`, `${IMPORTA}\nconst C2 = Campo;`)).problemas,
    ).not.toEqual([]);
    expect(analizar(pantalla(`{[Campo]}`, IMPORTA)).problemas).not.toEqual([]);
    expect(
      analizar(pantalla(`<M.Campo dato="cuit" />`, `import * as M from "x/Campo";`)).problemas,
    ).not.toEqual([]);
  });

  it("acepta el nombre del componente en un tipo (typeof Campo) y el import sin alias", () => {
    expect(analizar(`${IMPORTA}\ntype P = React.ComponentProps<typeof Campo>;`).problemas).toEqual(
      [],
    );
    expect(
      analizar(`import Campo from "x/Campo";\nexport const P = () => <Campo dato="pendiente" />;`)
        .problemas,
    ).toEqual([]);
  });

  it("cuenta como control crudo CUALQUIER aparición del nombre de una fábrica de elementos (sin intentar entender alias)", () => {
    const casos = [
      `createElement("input")`,
      `React.createElement("input")`,
      `createElement(Campo, { dato: "cuit" })`,
      `document.createElement("input")`,
      `document.createElement("a")`,
      `document["createElement"]("input")`,
      `React["createElement"]("input")`,
      `document.createElementNS("http://www.w3.org/1999/xhtml", "input")`,
      `createElement("INPUT")`,
      `React.createElement("Input")`,
      `h.call(document, "input")`.replace("h.call", "createElement.call"),
      `Reflect.apply(document.createElement, document, ["input"])`,
      `createElement.apply(document, ["input"])`,
      `jsx("input", {})`,
      `jsxs("input", {})`,
      `_jsx("input", {})`,
      `jsxDEV("input", {})`,
      `cloneElement(el, {})`,
    ];
    for (const caso of casos) expect(cuenta(`export const e = ${caso};`), caso).toBeGreaterThan(0);
  });

  it("cuenta el alias de la fábrica (import, renombre por desestructuración, constante, require)", () => {
    const casos = [
      `import { createElement as h } from "react";\nexport const e = h("input");`,
      `const h = React.createElement;\nexport const e = h("input");`,
      `const { createElement: h } = React;\nexport const e = h("input");`,
      `const { jsx: j } = require("react/jsx-runtime");\nexport const e = j("input", {});`,
      `import { jsx as j } from "react/jsx-runtime";\nexport const e = j("input", {});`,
    ];
    for (const caso of casos) expect(cuenta(caso), caso).toBeGreaterThan(0);
    expect(analizar(`import { jsx } from "react/jsx-runtime";`).problemas).not.toEqual([]);
    expect(analizar(`import { jsxDEV } from "react/jsx-dev-runtime";`).problemas).not.toEqual([]);
  });

  it("cuenta dangerouslySetInnerHTML (atributo, propiedad de objeto, spread) y el HTML armado como texto", () => {
    const casos = [
      pantalla(`<div dangerouslySetInnerHTML={{ __html: "<input>" }} />`),
      `const p = { dangerouslySetInnerHTML: { __html: "<input>" } };\nexport const P = () => <div {...p} />;`,
      `export const P = () => <div {...{ ["dangerouslySetInnerHTML"]: { __html: "x" } }} />;`,
      `export const f = (el: HTMLElement) => { el.innerHTML = "<input>"; };`,
      `export const f = (el: HTMLElement) => { el["innerHTML"] = "<input>"; };`,
      `export const f = (el: HTMLElement) => { el.outerHTML = "<input>"; };`,
      `export const f = (el: HTMLElement) => el.insertAdjacentHTML("beforeend", "<input>");`,
      `export const f = (el: HTMLElement, innerHTML: string) => Object.assign(el, { innerHTML });`,
      `export const f = (t: string) => new DOMParser().parseFromString(t, "text/html");`,
      `export const f = (r: Range, t: string) => r.createContextualFragment(t);`,
      pantalla(`<div contentEditable />`),
      pantalla(`<div contentEditable="true" />`),
    ];
    for (const caso of casos) expect(cuenta(caso), caso).toBeGreaterThan(0);
  });

  it("cuenta document.write (también por window, globalThis y corchetes) y role=textbox", () => {
    for (const caso of [
      `document.write("<input>");`,
      `document.writeln("<input>");`,
      `window.document.write("<input>");`,
      `globalThis.document.write("<input>");`,
      `document["write"]("<input>");`,
    ]) {
      expect(cuenta(`export const f = () => { ${caso} };`), caso).toBeGreaterThan(0);
    }
    expect(cuenta(pantalla(`<div role="textbox" />`))).toBe(1);
    expect(cuenta(pantalla(`<div role={"textbox"} />`))).toBe(1);
    expect(cuenta(pantalla(`<div role="searchbox textbox" />`))).toBe(1);
    // lo que no es el rol, o no es de document, no se cuenta
    expect(cuenta(pantalla(`<div role="group" />`))).toBe(0);
    expect(cuenta(`export const f = (s: { write: () => void }) => s.write();`)).toBe(0);
  });

  it("compara los tags sin distinguir mayúsculas y solo deja pasar la lista de permitidos", () => {
    for (const etiqueta of ["iNput", "sElect", "tEXTAREA", "input", "select", "textarea"]) {
      const r = analizar(pantalla(`<${etiqueta} />`));
      expect(r.crudos, etiqueta).toBe(1);
      expect(r.crudosPorEtiqueta.get(etiqueta.toLowerCase()), etiqueta).toBe(1);
    }
    for (const etiqueta of [
      "datalist",
      "iframe",
      "video",
      "audio",
      "canvas",
      "embed",
      "object",
      "script",
      "my-el",
      "marquee",
    ]) {
      expect(
        analizar(pantalla(`<${etiqueta} />`)).crudosPorEtiqueta.get("etiqueta-no-permitida"),
        etiqueta,
      ).toBe(1);
    }
    for (const etiqueta of [
      "div",
      "span",
      "p",
      "h1",
      "section",
      "svg",
      "path",
      "button",
      "form",
      "label",
      "ul",
      "li",
      "table",
      "td",
      "option",
      "dialog",
    ]) {
      expect(analizar(pantalla(`<${etiqueta} />`)).crudos, etiqueta).toBe(0);
    }
  });

  it("un tag en mayúscula que no es un componente declarado (INPUT, variable o parámetro) cuenta como dinámico", () => {
    expect(analizar(pantalla(`<INPUT />`)).dinamicos).toBe(1);
    expect(analizar(pantalla(`<T />`, `const T = "input";`)).dinamicos).toBe(1);
    expect(analizar(`export const P = ({ Tag }: { Tag: "p" }) => <Tag />;`).dinamicos).toBe(1);
    expect(
      analizar(`const T = cond ? "input" : "select";\nexport const P = () => <T />;`).dinamicos,
    ).toBe(1);
    expect(
      analizar(`function Hijo() { return null; }\nexport const P = () => <Hijo />;`).dinamicos,
    ).toBe(0);
    expect(analizar(`const Hijo = () => null;\nexport const P = () => <Hijo />;`).dinamicos).toBe(
      0,
    );
    expect(
      analizar(`const Hijo = memo(() => null);\nexport const P = () => <Hijo />;`).dinamicos,
    ).toBe(0);
    expect(
      analizar(`const Ctx = createContext(1);\nexport const P = () => <Ctx value={1} />;`)
        .dinamicos,
    ).toBe(0);
    expect(
      analizar(`import { Boton } from "x/Boton";\nexport const P = () => <Boton />;`).dinamicos,
    ).toBe(0);
  });

  it("rechaza un tag compuesto que no se puede analizar", () => {
    expect(
      analizar(pantalla(`<Ns.Algo />`, `import * as Ns from "x/Otro";`)).problemas,
    ).not.toEqual([]);
  });

  it("analiza TODAS las extensiones de código y falla cerrado ante un archivo que no se puede leer", () => {
    for (const extension of ["tsx", "ts", "jsx", "js", "mjs", "cjs", "mts", "cts"]) {
      const ruta = `p/x.${extension}`;
      expect(
        analizarArchivo(ruta, `export const e = document.createElement("input");`, contexto).crudos,
        ruta,
      ).toBeGreaterThan(0);
    }
    for (const extension of ["jsx", "js", "tsx"]) {
      const r = analizarArchivo(`p/x.${extension}`, `export const P = () => <input />;`, contexto);
      expect(r.crudosPorEtiqueta.get("input"), extension).toBe(1);
    }
    expect(
      analizarArchivo("p/roto.tsx", `export const P = () => <div>;`, contexto).problemas,
    ).not.toEqual([]);
    expect(analizarArchivo("p/roto.ts", `export const = ;`, contexto).problemas).not.toEqual([]);
    expect(analizarArchivo("p/ok.ts", `export const x = 1;`, contexto).problemas).toEqual([]);
  });

  it("no juzga lo que no es un componente de campo", () => {
    expect(
      analizar(pantalla(`<Boton dato={x} /><div />`, `import { Boton } from "x/Boton";`)).problemas,
    ).toEqual([]);
  });
});

describe("campos con dato: el registro, la deuda y el componente", () => {
  const base = contexto.registro["cuit"] as Registro[string];
  const usos = new Map([["p/Emitir.tsx", new Map([["cuit", 1]])]]);
  const siempre = () => true;
  const con = (parcial: object) => ({ cuit: { ...base, ...parcial } }) as Registro;

  it("rechaza un dato huérfano, sin consumidores, o con ficha, acción o módulo inexistentes", () => {
    expect(problemasDelRegistro(contexto.registro, usos, siempre)).toEqual([]);
    expect(problemasDelRegistro(contexto.registro, new Map(), siempre)).toHaveLength(1);
    expect(problemasDelRegistro(con({ consumidores: [] }), usos, siempre)).toHaveLength(1);
    expect(problemasDelRegistro(contexto.registro, usos, () => false)).toHaveLength(2);
    expect(problemasDelRegistro(con({ ponerPor: ["x.y"] }), usos, siempre)).toHaveLength(1);
    expect(problemasDelRegistro(con({ ponerPor: [] }), usos, siempre)).toHaveLength(1);
    expect(
      problemasDelRegistro(
        con({ requiere: { modulo: "no", estadoDeEmpresa: ["ACTIVE"] } }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
    expect(
      problemasDelRegistro(
        con({ requiere: { modulo: "facturacion", estadoDeEmpresa: [] } }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
    expect(problemasDelRegistro(con({ propositos: [] }), usos, siempre)).toHaveLength(1);
    expect(
      problemasDelRegistro(
        con({ propositos: [{ para: "a", fuente: "me lo dijo el backend" }] }),
        usos,
        siempre,
      ),
    ).toHaveLength(1);
  });

  const cuenta = (pendientes: number, crudos: number, dinamicos: number) => ({
    pendientes,
    crudos,
    dinamicos,
  });
  it("el presupuesto coincide exacto: la deuda que sube, que entra o que se saldó sin sacar falla", () => {
    const presupuesto = { "a.tsx": cuenta(2, 1, 0) };
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(2, 1, 0)]]), presupuesto)).toEqual([]);
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(3, 1, 0)]]), presupuesto)).toHaveLength(1);
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(2, 2, 0)]]), presupuesto)).toHaveLength(1);
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(2, 1, 1)]]), presupuesto)).toHaveLength(1);
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(1, 1, 0)]]), presupuesto)).toHaveLength(1);
    expect(
      problemasDeDeuda(
        new Map([
          ["a.tsx", cuenta(2, 1, 0)],
          ["b.tsx", cuenta(0, 1, 0)],
        ]),
        presupuesto,
      ),
    ).toHaveLength(1);
    expect(problemasDeDeuda(new Map([["a.tsx", cuenta(0, 0, 0)]]), presupuesto)).toHaveLength(1);
    expect(problemasDeDeuda(new Map(), presupuesto)).toHaveLength(1);
    expect(problemasDeDeuda(new Map([["b.tsx", cuenta(0, 0, 0)]]), {})).toEqual([]);
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

describe("campos con dato: evasiones baratas cerradas (PR 2 de C1)", () => {
  const raw = (texto: string) => analizar(texto);

  it("el runtime de JSX en cualquier forma es un problema", () => {
    for (const texto of [
      `import { jsx as h } from "react/jsx-runtime";`,
      `import { jsxDEV as h } from "react/jsx-dev-runtime";`,
      `const r = require("react/jsx-runtime");`,
      `const r = await import("react/jsx-dev-runtime");`,
      `export { jsx } from "react/jsx-runtime";`,
      "const r = require(`react/jsx-runtime`);",
    ]) {
      expect(raw(texto).problemas.length, texto).toBeGreaterThan(0);
    }
  });

  it("los nombres nuevos y sin distinguir mayúsculas cuentan como control crudo", () => {
    for (const nombre of [
      "setHTMLUnsafe",
      "parseHTMLUnsafe",
      "eval",
      "designMode",
      "execCommand",
      "Createelement",
      "CREATEELEMENT",
      "InnerHtml",
      "dangerouslysetinnerhtml",
      "contenteditable",
    ]) {
      expect(raw(`const f = x.${nombre};`).crudosPorEtiqueta.get("nombre-prohibido"), nombre).toBe(
        1,
      );
      expect(
        raw(`const f = x["${nombre}"];`).crudosPorEtiqueta.get("nombre-prohibido"),
        nombre,
      ).toBe(1);
    }
    expect(raw(pantalla(`<div contentEditable />`)).crudosPorEtiqueta.get("nombre-prohibido")).toBe(
      1,
    );
    expect(raw(pantalla(`<div contenteditable />`)).crudosPorEtiqueta.get("nombre-prohibido")).toBe(
      1,
    );
  });

  it("un role que no es un literal cuenta como control crudo; una condición de literales no", () => {
    expect(raw(pantalla(`<div role={rol} />`)).crudosPorEtiqueta.get("role-dinamico")).toBe(1);
    expect(
      raw(pantalla(`<div role={c ? "a" : rol} />`)).crudosPorEtiqueta.get("role-dinamico"),
    ).toBe(1);
    expect(raw(pantalla("<div role={`a${x}`} />")).crudosPorEtiqueta.get("role-dinamico")).toBe(1);
    expect(raw(pantalla(`<div role />`)).crudosPorEtiqueta.get("role-dinamico")).toBe(1);
    expect(raw(pantalla(`<div role={c ? "alert" : "status"} />`)).crudos).toBe(0);
    expect(raw(pantalla(`<div role="alert" />`)).crudos).toBe(0);
    expect(
      raw(pantalla(`<div role={c ? "alert" : "textbox"} />`)).crudosPorEtiqueta.get("role-textbox"),
    ).toBe(1);
  });

  it("setAttribute de role o contenteditable cuenta como control crudo", () => {
    for (const texto of [
      `el.setAttribute("role", "textbox");`,
      `el.setAttribute("contenteditable", "true");`,
      `el.setAttribute("ContentEditable", "true");`,
      `el["setAttribute"]("role", x);`,
      `el.setAttributeNS(null, "role", "textbox");`,
    ]) {
      expect(raw(texto).crudosPorEtiqueta.get("setAttribute"), texto).toBe(1);
    }
    expect(
      raw(`el.setAttribute("id", "a");`).crudosPorEtiqueta.get("setAttribute"),
    ).toBeUndefined();
  });

  it("document.write con cualquier receptor que contenga document cuenta; «documento» (el dato fiscal) no", () => {
    for (const texto of [
      `document.write("<input>");`,
      `window.document.write("x");`,
      `frame.contentDocument.write("x");`,
      `el.ownerDocument["writeln"]("x");`,
      `top.documentElement.write("x");`,
    ]) {
      expect(raw(texto).crudosPorEtiqueta.get("document.write"), texto).toBe(1);
    }
    expect(raw(`const t = CLAVE_DE_DOCUMENTO[documento.tipo];`).problemas).toEqual([]);
  });

  it("las claves calculadas sobre React o document fallan", () => {
    for (const texto of [
      `import React from "react";\nconst f = React["create" + "Element"];`,
      `import React from "react";\nconst f = React[k];`,
      `import * as R from "react";\nconst f = R[k];`,
      `import R from "react";\nconst f = R[k];`,
      `const R = require("react");\nconst f = R[k];`,
      `const f = document[k];`,
      `const f = window.document[k];`,
      `import React from "react";\nconst f = Reflect.get(React, k);`,
      `import R from "react";\nconst f = Reflect.get(R, "x" + "y");`,
      `const f = Reflect.getOwnPropertyDescriptor(document, k);`,
      `import React from "react";\nconst { [k]: f } = React;`,
    ]) {
      expect(raw(texto).problemas.length, texto).toBeGreaterThan(0);
    }
  });

  it("las claves literales sobre otras cosas no fallan", () => {
    for (const texto of [
      `const f = datos[k];`,
      `const f = CLAVE[documento.tipo];`,
      `import React from "react";\nconst f = React.useState;`,
      `const f = Reflect.get(objeto, k);`,
    ]) {
      expect(raw(texto).problemas, texto).toEqual([]);
    }
  });
});

describe("campos con dato: fuera de las apps no hay deuda", () => {
  const fuera = (archivos: Record<string, string>) =>
    problemasFueraDeLasApps(new Map(Object.entries(archivos)), contexto);

  it("un control crudo, un tag dinámico, un pendiente o una evasión en src/ fallan", () => {
    for (const cuerpo of [
      `export const X = () => <input />;`,
      `export const X = ({ T }: { T: unknown }) => <T />;`,
      `export const X = () => <Campo dato="pendiente" />;`,
      `export const X = () => <Campo />;`,
      `export const X = () => createElement("input");`,
    ]) {
      const texto = `import { Campo } from "x/Campo";\n${cuerpo}`;
      expect(fuera({ "src/x.tsx": texto }).length, cuerpo).toBeGreaterThan(0);
      expect(fuera({ "packages/ui/x.js": texto }).length, cuerpo).toBeGreaterThan(0);
    }
  });

  it("lo que no pinta controles pasa", () => {
    expect(fuera({ "src/x.tsx": "export const X = () => <div>hola</div>;" })).toEqual([]);
    expect(fuera({ "src/x.js": "export const x = 1;" })).toEqual([]);
    expect(fuera({})).toEqual([]);
  });

  it("los imports relativos que salen de la app se siguen (import, export from, import() y require)", () => {
    const texto = [
      'import { a } from "../../packages/ui/boton";',
      'export { b } from "../../packages/ui/otro";',
      'const c = await import("../../packages/ui/lazy");',
      'const d = require("../../packages/ui/viejo");',
      'import { e } from "./propio";',
      'import { f } from "../../../src/primitivas/x";',
      'import { g } from "react";',
    ].join("\n");
    expect(importadosFueraDe("apps/web/ui/p.tsx", texto, "apps/web")).toEqual([
      "apps/packages/ui/boton",
      "apps/packages/ui/lazy",
      "apps/packages/ui/otro",
      "apps/packages/ui/viejo",
      "src/primitivas/x",
    ]);
  });
});
