import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { codigosDeLasCeldas } from "../../src/primitivas/oraculo/celdas";
import { ORACULO_DE_COMPROBANTE } from "../../src/modulos/fiscal/dominio/oraculo-de-comprobante";
import { ORACULO_DE_VENTAS } from "../../src/modulos/ventas/dominio/oraculo-de-ticket";
import {
  codigosDeError,
  esCodigoDeVentasOFiscal,
  fallasDeErrores,
  resumirErrores,
  type ListaFueraDelOraculo,
} from "./oraculo-de-errores-apoyo";

/**
 * REGLA (oráculo de ticket, cobranza y factura; `Pedernal-docs/11-especificaciones/auditoria-de-reglas/oraculo-ticket-cobranza.md` §10 punto 3):
 * todo código de error con nombre que ventas o fiscal devuelven con `err(...)` figura en una celda de los oráculos
 * (`ventas/dominio/oraculo-de-ticket-datos.ts`, `fiscal/dominio/oraculo-de-comprobante-datos.ts`) o está declarado FUERA del oráculo, con su
 * motivo, en `arquitectura/oraculo/errores-fuera-del-oraculo.json`; y todo código de una celda existe en el código. Así una celda no puede
 * quedar sin su error ni un error sin que alguien decida si el oráculo lo describe. Lo que no se puede leer cuenta (presupuesto exacto).
 * Previene: la regla sin clasificar que originó `documento_vigente_uk` (un índice único que impuso una política como invariante). Qué se ve y qué
 * no: ver `oraculo-de-errores-apoyo.ts`. Cada forma de violar la regla está inyectada abajo y en `reglas.test.ts`.
 */

const RAIZ = join(import.meta.dirname, "../..");
const LISTA = JSON.parse(
  readFileSync(join(RAIZ, "arquitectura/oraculo/errores-fuera-del-oraculo.json"), "utf8"),
) as ListaFueraDelOraculo;

function codigoDeProduccion(): Map<string, string> {
  const mapa = new Map<string, string>();
  for (const r of readdirSync(join(RAIZ, "src/modulos"), { recursive: true, encoding: "utf8" })) {
    const ruta = `src/modulos/${r}`;
    if (esCodigoDeVentasOFiscal(ruta)) mapa.set(ruta, readFileSync(join(RAIZ, ruta), "utf8"));
  }
  return mapa;
}

const enCeldas = codigosDeLasCeldas([...ORACULO_DE_VENTAS, ...ORACULO_DE_COMPROBANTE]);

describe("oráculo de errores: el código real", () => {
  const archivos = codigoDeProduccion();
  const resumen = resumirErrores(archivos);

  it("mira ventas y fiscal (no pasa en vacío)", () => {
    expect([...archivos.keys()].some((r) => r.startsWith("src/modulos/ventas/"))).toBe(true);
    expect([...archivos.keys()].some((r) => r.startsWith("src/modulos/fiscal/"))).toBe(true);
    expect(resumen.codigos.size).toBeGreaterThan(100);
  });

  it("todo código de error figura en una celda o está declarado fuera del oráculo, con su motivo", () => {
    expect(fallasDeErrores(resumen, enCeldas, LISTA)).toEqual([]);
  });

  it("la lista de permitidos solo baja: no tiene más de 144 códigos (uno nuevo se resuelve con una celda, no con un permiso)", () => {
    const total = LISTA.grupos.reduce((suma, g) => suma + g.codigos.length, 0);
    expect(total).toBeLessThanOrEqual(144);
  });

  it("las celdas que hoy coinciden nombran solo códigos que el código devuelve", () => {
    for (const codigo of enCeldas) expect(resumen.codigos.has(codigo), codigo).toBe(true);
  });
});

describe("oráculo de errores: violaciones inyectadas", () => {
  const sin: ListaFueraDelOraculo = { grupos: [], opacos: {} };
  const resumir = (texto: string, ruta = "src/modulos/ventas/casos-de-uso/x.ts") =>
    resumirErrores(new Map([[ruta, texto]]));
  const tipos = (resumen: ReturnType<typeof resumir>, celdas: string[], lista = sin) =>
    fallasDeErrores(resumen, new Set(celdas), lista).map((f) => f.tipo);

  it("un código nuevo sin celda ni permiso falla", () => {
    expect(tipos(resumir('export const f = () => err("CODIGO_NUEVO");'), [])).toEqual([
      "código sin celda ni permiso",
    ]);
  });

  it.each([
    ["texto", 'err("A")', ["A"]],
    ["objeto con error", 'err({ error: "A", dato: 1 })', ["A"]],
    ["objeto con codigo", 'err({ codigo: "A" })', ["A"]],
    ["condicional", 'err(x ? "A" : "B")', ["A", "B"]],
    ["entre paréntesis", 'err(("A"))', ["A"]],
    ["plantilla sin sustituciones", "err(`A`)", ["A"]],
    ["objeto con error condicional", 'err({ error: x ? "A" : "B" })', ["A", "B"]],
  ])("lee el código de %s", (_nombre, llamada, esperados) => {
    expect(codigosDeError("x.ts", `const f = () => ${llamada};`)).toEqual({
      codigos: esperados,
      opacos: 0,
    });
  });

  it.each([
    ["un identificador", "err(error)"],
    ["un acceso a propiedad", "err(r.error)"],
    ["un acceso encadenado", "err(a.b.c)"],
    ["un valor con !", "err(r.error!)"],
    ["un objeto que reenvía el error", "err({ posicion: 1, error: r.error })"],
  ])("reenviar %s no cuenta ni como código ni como ilegible", (_nombre, llamada) => {
    expect(codigosDeError("x.ts", `const f = () => ${llamada};`)).toEqual({
      codigos: [],
      opacos: 0,
    });
  });

  it.each([
    ["un cast", "err(codigo as ErrorDeVentas)"],
    ["una llamada", "err(armar())"],
    ["un objeto sin error ni codigo", "err({ motivo: 'x' })"],
    ["un spread", "err({ ...otro })"],
    ["sin argumento", "err()"],
    ["una plantilla con sustitución", "err(`A_${x}`)"],
  ])("%s cuenta como ilegible (fail-closed)", (_nombre, llamada) => {
    expect(codigosDeError("x.ts", `const f = () => ${llamada};`).opacos).toBe(1);
  });

  it("no mira otra función que se llame distinto ni un método llamado err", () => {
    expect(codigosDeError("x.ts", 'otra("A"); obj.err("B");')).toEqual({ codigos: [], opacos: 0 });
  });

  it("mira ventas y fiscal de producción, no las pruebas ni otros módulos", () => {
    expect(esCodigoDeVentasOFiscal("src/modulos/ventas/casos-de-uso/x.ts")).toBe(true);
    expect(esCodigoDeVentasOFiscal("src/modulos/fiscal/dominio/x.ts")).toBe(true);
    expect(esCodigoDeVentasOFiscal("src/modulos/ventas/dominio/x.test.ts")).toBe(false);
    expect(esCodigoDeVentasOFiscal("src/modulos/caja/dominio/x.ts")).toBe(false);
    expect(esCodigoDeVentasOFiscal("src/modulos/ventas/x.d.ts")).toBe(false);
    expect(esCodigoDeVentasOFiscal("src/modulos/ventas/x.json")).toBe(false);
    expect(
      Object.fromEntries(
        resumirErrores(
          new Map([
            ["src/modulos/caja/x.ts", 'err("DE_CAJA")'],
            ["src/modulos/ventas/x.test.ts", 'err("DE_PRUEBA")'],
          ]),
        ).codigos,
      ),
    ).toEqual({});
  });

  it("un código declarado fuera sin motivo falla", () => {
    expect(
      tipos(resumir('err("A")'), [], { grupos: [{ motivo: " ", codigos: ["A"] }], opacos: {} }),
    ).toEqual(["grupo sin motivo"]);
  });

  it("un código declarado fuera que ya tiene celda falla", () => {
    expect(
      tipos(resumir('err("A")'), ["A"], { grupos: [{ motivo: "m", codigos: ["A"] }], opacos: {} }),
    ).toEqual(["código declarado fuera que ya tiene celda"]);
  });

  it("un código declarado fuera que el código ya no devuelve falla", () => {
    expect(
      tipos(resumir("const x = 1;"), [], { grupos: [{ motivo: "m", codigos: ["A"] }], opacos: {} }),
    ).toEqual(["código declarado fuera que el código ya no devuelve"]);
  });

  it("un código declarado fuera dos veces falla", () => {
    expect(
      tipos(resumir('err("A")'), [], {
        grupos: [
          { motivo: "m", codigos: ["A"] },
          { motivo: "n", codigos: ["A"] },
        ],
        opacos: {},
      }),
    ).toEqual(["código declarado fuera dos veces"]);
  });

  it("un código de celda que el código no devuelve (mal escrito) falla", () => {
    expect(tipos(resumir('err("A")'), ["A", "B"], sin)).toEqual([
      "código de celda que el código no devuelve",
    ]);
  });

  it("un err(...) ilegible fuera del presupuesto falla, y también uno que sobra en el presupuesto", () => {
    const ruta = "src/modulos/ventas/casos-de-uso/x.ts";
    const opaco = resumir("err(a as B)", ruta);
    expect(fallasDeErrores(opaco, new Set(), sin).map((f) => f.detalle)).toEqual([
      `${ruta}: hay 1, el presupuesto dice 0`,
    ]);
    expect(fallasDeErrores(opaco, new Set(), { grupos: [], opacos: { [ruta]: 1 } })).toEqual([]);
    expect(
      fallasDeErrores(resumir("const x = 1;", ruta), new Set(), {
        grupos: [],
        opacos: { [ruta]: 1 },
      }).map((f) => f.detalle),
    ).toEqual([`${ruta}: hay 0, el presupuesto dice 1`]);
  });

  it("lo correcto (celda o permiso con motivo) no falla", () => {
    expect(
      tipos(resumir('err("A"); err({ error: "B" })'), ["A"], {
        grupos: [{ motivo: "m", codigos: ["B"] }],
        opacos: {},
      }),
    ).toEqual([]);
  });
});
