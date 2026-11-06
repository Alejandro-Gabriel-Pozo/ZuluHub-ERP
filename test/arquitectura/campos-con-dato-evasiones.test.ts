import { describe, expect, it } from "vitest";
import {
  analizarArchivo,
  problemasDeComponente,
  problemasDeDeuda,
  problemasDelRegistro,
  type Contexto,
  type Registro,
} from "./campos-con-dato-apoyo";

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

  it("rechaza createElement, jsx y jsxs que arman elementos sin pasar por el chequeo", () => {
    const casos = [
      `createElement("input")`,
      `React.createElement("input")`,
      `createElement(Campo, { dato: "cuit" })`,
      `document.createElement("input")`,
      `document.createElement("textarea")`,
      `document.createElement(tag)`,
      `jsx("input", {})`,
      `jsxs("input", {})`,
      `_jsx("input", {})`,
      `cloneElement(el, {})`,
    ];
    for (const caso of casos) {
      expect(analizar(`${IMPORTA}\nexport const e = ${caso};`).problemas, caso).not.toEqual([]);
    }
    expect(analizar(`import { jsx } from "react/jsx-runtime";`).problemas).not.toEqual([]);
    expect(analizar(`import { jsxDEV } from "react/jsx-dev-runtime";`).problemas).not.toEqual([]);
  });

  it("acepta document.createElement con un elemento literal que no es un control", () => {
    expect(analizar(`export const a = document.createElement("a");`).problemas).toEqual([]);
  });

  it("cuenta como deuda un tag dinámico (variable o parámetro) y no el componente declarado", () => {
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

  it("rechaza dangerouslySetInnerHTML y el HTML armado como texto", () => {
    expect(
      analizar(pantalla(`<div dangerouslySetInnerHTML={{ __html: "<input>" }} />`)).problemas,
    ).not.toEqual([]);
    expect(
      analizar(`export const f = (el: HTMLElement) => { el.innerHTML = "<input>"; };`).problemas,
    ).not.toEqual([]);
    expect(
      analizar(`export const f = (el: HTMLElement) => { el.outerHTML = "<input>"; };`).problemas,
    ).not.toEqual([]);
    expect(
      analizar(
        `export const f = (el: HTMLElement) => el.insertAdjacentHTML("beforeend", "<input>");`,
      ).problemas,
    ).not.toEqual([]);
  });

  it("también mira los .ts (no solo los .tsx)", () => {
    expect(
      analizarArchivo("p/ayuda.ts", `export const e = document.createElement("input");`, contexto)
        .problemas,
    ).not.toEqual([]);
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
