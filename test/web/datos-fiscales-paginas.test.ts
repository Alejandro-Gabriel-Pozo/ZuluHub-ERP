import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * Las páginas de Datos fiscales (opción A, aprobada por el dueño el 2026-10-29): lo vigente para leer, el aviso del borrador (D-68) y el
 * formulario de corrección. La guarda real (`pantallaDeOperacion`) y el armazón real; solo se simula lo externo (sesión, servidor y
 * `next/navigation`). Previene: mostrar datos o acciones cuando la lectura falla («todo nace cerrado»), editar sin pasar por «Corregir»,
 * y un «Rige desde» corrido un día por la zona del servidor.
 */
vi.mock("server-only", () => ({}));
const redirigido = vi.hoisted(() => ({ hacia: [] as string[] }));
vi.mock("next/navigation", () => ({
  redirect: (destino: string) => {
    redirigido.hacia.push(destino);
    throw new Error(`REDIRECT ${destino}`);
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
const servidor = vi.hoisted((): { datos: unknown; pedidos: number } => ({
  datos: null,
  pedidos: 0,
}));
vi.mock("../../apps/web/servidor/configuracion-fiscal", async () => ({
  cargarLosDatosFiscales: () => {
    servidor.pedidos += 1;
    return Promise.resolve(servidor.datos);
  },
  // Las condiciones son las reales (D-44): lo que se prueba es que la página las muestre.
  opcionesDeDatosFiscales: (await import("../../src/composicion/opciones-de-datos-fiscales"))
    .opcionesDeDatosFiscales,
  guardarElBorradorDeDatosFiscales: () => Promise.resolve(null),
  empezarLaCorreccionDeDatosFiscales: () => Promise.resolve(null),
  confirmarLosDatosFiscales: () => Promise.resolve(null),
}));
vi.mock("../../apps/web/servidor/modulos", () => ({
  destinosDeModulos: () => Promise.resolve([]),
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: { registrar: () => undefined } },
  empresaDelPedido: () =>
    Promise.resolve({
      puerta: { marca: { nombre: "Marca de prueba" } },
      entrada: {
        ok: true,
        dato: {
          tipo: "ENTRA",
          empresa: { nombre: "Empresa de prueba" },
          contexto: { id: "contexto" },
        },
      },
    }),
}));

type Pagina = () => Promise<unknown>;
// Con ruta en una variable: el `tsc` de la raíz (sin DOM) no sigue la página hasta los componentes de cliente.
const cargar = (ruta: string): Promise<{ default: Pagina }> => import(/* @vite-ignore */ ruta);
const BASE = "../../apps/web/app/s/app/(operacion)/configuracion-fiscal/datos-fiscales";

async function html(ruta: string): Promise<string> {
  const { default: Pagina } = await cargar(`${BASE}${ruta}`);
  return renderToStaticMarkup((await Pagina()) as ReactNode);
}
const titulos = (marcado: string): string[] =>
  [...marcado.matchAll(/<h1\b[^>]*>(.*?)<\/h1>/g)].map((m) => m[1] as string);
const texto = (marcado: string): string =>
  marcado
    .replace(/<[^>]+>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ");

const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";
const DOMICILIO = {
  id: "d1",
  calle: "Av. Rivadavia",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Ciudad de Buenos Aires",
  provincia: "AR-C",
  codigoPostal: "1000",
};
const VIGENTE = {
  id: "v1",
  numero: 2,
  vigenteDesde: "2026-10-13T01:30:00.000Z",
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: DOMICILIO,
  inicioActividades: "2018-03-01",
};
const BORRADOR = {
  id: "b1",
  version: 4,
  razonSocial: "Distribuidora Sur SRL",
  condicionIva: "MONOTRIBUTO",
  domicilio: { ...DOMICILIO, calle: "Av. Corrientes" },
  inicioActividades: "2018-03-02",
};
const datos = (cambios: Record<string, unknown> = {}): Respuesta<unknown> => ({
  ok: true,
  dato: { emisorId: EMISOR, cuit: "30712345678", vigente: VIGENTE, borrador: null, ...cambios },
});
const falla = (codigo: Parameters<typeof errorDeCodigo>[0]): Respuesta<unknown> => ({
  ok: false,
  error: errorDeCodigo(codigo),
});

beforeEach(() => {
  servidor.datos = datos();
  servidor.pedidos = 0;
  redirigido.hacia = [];
});

describe("la página «Datos fiscales» (lo vigente, solo para leer)", () => {
  it("muestra el CUIT, la razón social, la condición, el domicilio, el inicio y «Rige desde el …», con «Corregir»", async () => {
    const marcado = await html("/page");
    expect(titulos(marcado)).toEqual(["Datos fiscales"]);
    const t = texto(marcado);
    expect(t).toContain("CUIT 30-71234567-8");
    expect(t).toContain("Razón social Distribuidora Sur SA");
    expect(t).toContain("Condición frente al IVA IVA Responsable Inscripto");
    expect(t).toContain("Domicilio fiscal Av. Rivadavia 1234, Ciudad de Buenos Aires");
    expect(t).toContain("Inicio de actividades 01/03/2018");
    expect(t).toContain("Rige desde el 12/10/2026.");
    expect(marcado).toMatch(/<button[^>]*>Corregir<\/button>/);
    // Solo lectura: ni un campo para escribir, y sin avisos.
    expect(marcado).not.toMatch(/<(input|select|textarea)\b/);
    expect(t).not.toContain("Hay un borrador");
    expect(t).not.toContain("Seguir con el borrador");
  });

  it.each([
    ["2026-10-13T02:59:59.000Z", "12/10/2026"],
    ["2026-10-13T03:00:00.000Z", "13/10/2026"],
    ["2027-01-01T01:00:00.000Z", "31/12/2026"],
  ])("«Rige desde» es el día de Argentina (UTC-3) de %s: %s", async (instante, fecha) => {
    servidor.datos = datos({ vigente: { ...VIGENTE, vigenteDesde: instante } });
    expect(texto(await html("/page"))).toContain(`Rige desde el ${fecha}.`);
  });

  it("con un borrador sin confirmar (D-68): el aviso, lo que rige y «Seguir con el borrador» en vez de «Corregir»", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html("/page");
    const t = texto(marcado);
    expect(t).toContain("Hay un borrador sin confirmar.");
    expect(t).toContain(
      "Lo guardó otra persona o desde otro dispositivo. Los datos que rigen siguen siendo los de abajo.",
    );
    expect(t).toContain("Razón social Distribuidora Sur SA");
    expect(t).not.toContain("SRL");
    expect(marcado).toMatch(
      /<a[^>]*href="\/configuracion-fiscal\/datos-fiscales\/corregir"[^>]*>Seguir con el borrador<\/a>/,
    );
    expect(marcado).not.toMatch(/<button[^>]*>Corregir<\/button>/);
  });

  it("si todavía no hay nada vigente, abre directo el formulario (con borrador o sin él)", async () => {
    for (const borrador of [null, BORRADOR]) {
      servidor.datos = datos({ vigente: null, borrador });
      redirigido.hacia = [];
      await expect(html("/page")).rejects.toThrow("REDIRECT");
      expect(redirigido.hacia).toEqual(["/configuracion-fiscal/datos-fiscales/corregir"]);
    }
  });

  it("sin permiso: dice «sin permiso» y no muestra datos ni acciones", async () => {
    servidor.datos = falla("SIN_PERMISO");
    const marcado = await html("/page");
    const t = texto(marcado);
    expect(t).toContain("No tiene permiso para hacer esto.");
    expect(t).not.toContain("SIN_PERMISO");
    expect(t).not.toMatch(/CUIT|Distribuidora|Corregir|borrador/);
    expect(marcado).not.toMatch(/<button|<input/);
    expect(redirigido.hacia).toEqual([]);
  });

  it("con un error inesperado muestra la referencia, nada técnico y ninguna acción", async () => {
    servidor.datos = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const marcado = await html("/page");
    expect(texto(marcado)).toContain("PD-ABC123");
    expect(texto(marcado)).not.toContain("ERROR_INTERNO");
    expect(marcado).not.toMatch(/<button|<input/);
  });
});

describe("la página «Corregir datos fiscales» (el formulario)", () => {
  it("abre el borrador precargado (D-62), con el CUIT solo para leer y los tres botones", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html("/corregir/page");
    expect(titulos(marcado)).toEqual(["Corregir datos fiscales"]);
    const t = texto(marcado);
    expect(t).toContain("CUIT 30-71234567-8");
    expect(marcado).not.toMatch(/<input[^>]*30-71234567-8/);
    expect(marcado).toContain('value="Distribuidora Sur SRL"');
    expect(marcado).toContain('value="Av. Corrientes"');
    expect(marcado).toContain('value="02/03/2018"');
    expect(marcado).toMatch(
      /<option value="MONOTRIBUTO" selected="">Responsable Monotributo<\/option>/,
    );
    expect(marcado).toMatch(
      /<option value="AR-C" selected="">Ciudad Autónoma de Buenos Aires<\/option>/,
    );
    for (const boton of ["Cancelar", "Guardar borrador", "Confirmar"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*>${boton}</button>`));
    }
    // Ni Ingresos Brutos (D-45) ni fecha de vigencia (D-61).
    expect(t).not.toMatch(/Ingresos Brutos|Rige desde|Vigencia/i);
  });

  it("las tres condiciones frente al IVA con los textos del manual de ARCA (D-44) y la primera opción vacía con el nombre del campo", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html("/corregir/page");
    const select = /<select[^>]*name="condicionIva"[^>]*>(.*?)<\/select>/.exec(marcado)?.[1] ?? "";
    expect([...select.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((m) => m[1])).toEqual([
      "Condición frente al IVA",
      "IVA Responsable Inscripto",
      "Responsable Monotributo",
      "IVA Sujeto Exento",
    ]);
    expect(select.startsWith('<option value="">')).toBe(true);
  });

  it("sin nada cargado: el formulario vacío, con las migas hasta la lista", async () => {
    servidor.datos = datos({ vigente: null, borrador: null });
    const marcado = await html("/corregir/page");
    expect(titulos(marcado)).toEqual(["Corregir datos fiscales"]);
    expect(marcado).toContain('name="condicionIva"');
    expect(marcado).not.toMatch(
      /value="[^"]+"[^>]*name="razonSocial"|name="razonSocial"[^>]*value="[^"]+"/,
    );
    expect(marcado).toContain('href="/configuracion-fiscal"');
    expect(marcado).not.toContain('href="/configuracion-fiscal/datos-fiscales"');
  });

  it("sin borrador y con algo vigente no se edita: vuelve a la lectura (también tras «versión desactualizada» sin borrador)", async () => {
    servidor.datos = datos({ borrador: null });
    await expect(html("/corregir/page")).rejects.toThrow("REDIRECT");
    expect(redirigido.hacia).toEqual(["/configuracion-fiscal/datos-fiscales"]);
  });

  it("sin permiso: «sin permiso» y ni un campo ni un botón", async () => {
    servidor.datos = falla("SIN_PERMISO");
    const marcado = await html("/corregir/page");
    expect(texto(marcado)).toContain("No tiene permiso para hacer esto.");
    expect(marcado).not.toMatch(/<form|<button|<input|<select/);
    expect(redirigido.hacia).toEqual([]);
  });
});
