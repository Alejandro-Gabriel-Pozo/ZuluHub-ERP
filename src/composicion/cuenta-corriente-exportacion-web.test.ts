import { describe, expect, it } from "vitest";
import { leerZipComoTextos } from "../adaptadores/xlsx/leer-zip-de-prueba";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { FilaDeExportacion } from "../modulos/cuenta_corriente/publico";
import { err, ok } from "../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto } from "../primitivas/tiempo/fecha-civil";
import type { EscritorDePlanilla } from "../puertos/escritor-de-planilla";
import {
  exportarLaCuentaCorriente,
  traducirErrorDeLaExportacionDeCuentaCorriente,
  type DependenciasDeLaExportacionDeCuentaCorriente,
} from "./cuenta-corriente-exportacion-web";
import { crearEscritorDePlanilla } from "./escritor-de-planilla";

/**
 * La exportación de la cuenta corriente por la composición web, sin base: el archivo sale entero o sale el error, lo que no es un código público ya conocido es el genérico, una excepción sale con
 * referencia y sin detalle, y un nombre de cliente que empieza como una fórmula nunca se escribe como fórmula. El contenido real con la base está en
 * `test/integracion/cuenta-corriente-exportacion-web.test.ts`.
 */

const fecha = (texto: string) => {
  const r = fechaCivilDesdeTexto(texto);
  if (!r.ok) throw new Error("fecha de prueba inválida");
  return r.valor;
};

const FILA: FilaDeExportacion = {
  parteId: "p1",
  asientoId: "a1",
  cliente: '=HYPERLINK("http://x","y")',
  cuit: "30712345678",
  fechaDeNegocio: fecha("2026-11-09"),
  venceEl: null,
  clase: "CARGO_DE_VENTA_A_CUENTA",
  importeConSigno: "1234.50",
  pendiente: "1234.50",
  moneda: "ARS",
  antiguedadEnDias: 3,
  tramoDeAntiguedad: "DE_0_A_30",
  vencida: false,
  origen: "TICKET",
  sucursalId: null,
  sucursal: null,
  tipoDeMedio: null,
  estado: "VIGENTE",
};

const registrados: string[] = [];
const dependencias = (
  resultado: unknown,
  escritor: EscritorDePlanilla = crearEscritorDePlanilla(),
): DependenciasDeLaExportacionDeCuentaCorriente => ({
  casos: () => ({ exportarCuentaCorriente: () => Promise.resolve(resultado as never) }),
  escritor,
  respuesta: { registrar: (x) => registrados.push(x), azar: () => new Uint8Array(4) },
});
const CONTEXTO = {} as never;
const SALIDA = ok({ alDia: "2026-11-09", clientes: 1, filas: [FILA] });

describe("la exportación de la cuenta corriente por la composición web", () => {
  it("arma el archivo con el nombre del día, la hoja plana y el importe como número exacto", async () => {
    const r = await exportarLaCuentaCorriente(dependencias(SALIDA), CONTEXTO);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.nombre).toBe("cuenta_corriente_2026-11-09.xlsx");
    const zip = leerZipComoTextos(r.dato.contenido);
    expect(zip.get("xl/workbook.xml")).toContain('name="cuenta_corriente"');
    expect(zip.get("xl/worksheets/sheet1.xml")).toContain("<v>1234.5</v>");
  });

  it("un nombre de cliente que empieza como una fórmula sale como texto, nunca como fórmula", async () => {
    const r = await exportarLaCuentaCorriente(dependencias(SALIDA), CONTEXTO);
    if (!r.ok) throw new Error("debía salir el archivo");
    const zip = leerZipComoTextos(r.dato.contenido);
    for (const [archivo, xml] of zip) {
      if (archivo.startsWith("xl/worksheets/")) expect(xml).not.toContain("<f");
    }
    expect(zip.get("xl/sharedStrings.xml")).not.toMatch(/>=HYPERLINK/);
  });

  it("un código público (sin permiso, módulo no activo) pasa tal cual", async () => {
    for (const codigo of ["SIN_PERMISO", "MODULO_NO_ACTIVO"] as const) {
      expect(await exportarLaCuentaCorriente(dependencias(err(codigo)), CONTEXTO)).toEqual({
        ok: false,
        error: errorDeCodigo(codigo),
      });
    }
  });

  it("lo demás que dice el caso de uso (tope, sin apoyo, fecha) sale como el genérico, sin detalle", async () => {
    for (const error of [
      "EXPORTACION_DEMASIADO_GRANDE",
      "EXPORTACION_NO_DISPONIBLE",
      "FECHA_INVALIDA",
      "cualquier-otra-cosa",
    ]) {
      expect(await exportarLaCuentaCorriente(dependencias(err(error)), CONTEXTO)).toEqual({
        ok: false,
        error: errorDeCodigo("CLIENTES_ACCION_NO_PERMITIDA"),
      });
    }
  });

  it("un nombre heredado del prototipo no se toma por un código público", () => {
    expect(traducirErrorDeLaExportacionDeCuentaCorriente("constructor")).toEqual({
      codigo: "CLIENTES_ACCION_NO_PERMITIDA",
    });
    expect(traducirErrorDeLaExportacionDeCuentaCorriente("toString")).toEqual({
      codigo: "CLIENTES_ACCION_NO_PERMITIDA",
    });
  });

  it("un error que no es un texto (la base) pasa sin tocar", () => {
    const base = { tipo: "Serializacion" };
    expect(traducirErrorDeLaExportacionDeCuentaCorriente(base)).toBe(base);
  });

  it("si el escritor falla no sale archivo: sale el error con referencia y sin el detalle", async () => {
    registrados.length = 0;
    const roto: EscritorDePlanilla = {
      escribir: () => Promise.reject(new Error("detalle interno secreto")),
    };
    const r = await exportarLaCuentaCorriente(dependencias(SALIDA, roto), CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(JSON.stringify(r.error)).not.toContain("secreto");
    expect(r.error.referencia).toMatch(/^PD-/);
    expect(registrados.join(" ")).toContain("detalle interno secreto");
  });

  it("si el caso de uso lanza una excepción, sale con referencia y sin detalle", async () => {
    registrados.length = 0;
    const d: DependenciasDeLaExportacionDeCuentaCorriente = {
      ...dependencias(SALIDA),
      casos: () => ({
        exportarCuentaCorriente: () => Promise.reject(new Error("la base no responde")),
      }),
    };
    const r = await exportarLaCuentaCorriente(d, CONTEXTO);
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(JSON.stringify(r.error)).not.toContain("la base no responde");
    expect(r.error.referencia).toMatch(/^PD-/);
  });
});
