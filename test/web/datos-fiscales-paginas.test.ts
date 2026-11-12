import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo, type Respuesta } from "../../src/capacidades/experiencia/respuesta";

/// <reference path="../../apps/web/ui/css-modules.d.ts" />

/**
 * La página de Datos fiscales (D-88, 2026-11-03): abre directo el formulario, con el borrador (D-68), con lo vigente o en blanco. La guarda real (`pantallaDeOperacion`) y el armazón real; solo se simula lo externo (sesión, servidor y
 * `next/navigation`). Previene: mostrar datos o acciones cuando la lectura falla («todo nace cerrado») y una pantalla de lectura intermedia que D-88 sacó.
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
const servidor = vi.hoisted((): { datos: unknown; pedidos: number; escrituras: number } => ({
  datos: null,
  pedidos: 0,
  escrituras: 0,
}));
vi.mock("../../apps/web/servidor/configuracion-fiscal", async () => ({
  cargarLosDatosFiscales: () => {
    servidor.pedidos += 1;
    return Promise.resolve(servidor.datos);
  },
  // Las condiciones son las reales (D-44): lo que se prueba es que la página las muestre.
  opcionesDeDatosFiscales: (await import("../../src/composicion/opciones-de-datos-fiscales"))
    .opcionesDeDatosFiscales,
  guardarElBorradorDeDatosFiscales: () => {
    servidor.escrituras += 1;
    return Promise.resolve(null);
  },
  empezarLaCorreccionDeDatosFiscales: () => {
    servidor.escrituras += 1;
    return Promise.resolve(null);
  },
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
const PAGINA = "../../apps/web/app/s/app/(operacion)/configuracion-fiscal/datos-fiscales/page";

async function html(): Promise<string> {
  const { default: Pagina } = await cargar(PAGINA);
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
  iibbNumero: null,
  iibbCondicion: null,
};
const BORRADOR = {
  id: "b1",
  version: 4,
  razonSocial: "Distribuidora Sur SRL",
  condicionIva: "MONOTRIBUTO",
  domicilio: { ...DOMICILIO, calle: "Av. Corrientes" },
  inicioActividades: "2018-03-02",
  iibbNumero: "901-123456-7",
  iibbCondicion: null,
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
  servidor.escrituras = 0;
  redirigido.hacia = [];
});

describe("la página «Datos fiscales» abre directo el formulario (D-88)", () => {
  it("con borrador: lo abre precargado, con el CUIT solo para leer, el título «Datos fiscales» y los tres botones", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html();
    expect(titulos(marcado)).toEqual(["Datos fiscales"]);
    const t = texto(marcado);
    expect(t).toContain("CUIT 30-71234567-8");
    expect(marcado).not.toMatch(/<input[^>]*30-71234567-8/);
    expect(marcado).toContain('value="Distribuidora Sur SRL"');
    expect(marcado).toContain('value="Av. Corrientes"');
    expect(marcado).toContain('value="2018-03-02"');
    expect(marcado).toMatch(
      /<option value="MONOTRIBUTO" selected="">Responsable Monotributo<\/option>/,
    );
    expect(marcado).toMatch(
      /<option value="AR-C" selected="">Ciudad Autónoma de Buenos Aires<\/option>/,
    );
    // Ingresos Brutos (D-116): el desplegable con «Número de inscripción» elegido y su campo con el número del borrador.
    expect(marcado).toMatch(/<option value="NUMERO" selected="">Número de inscripción<\/option>/);
    expect(marcado).toContain('value="901-123456-7"');
    for (const boton of ["Cancelar", "Guardar borrador", "Confirmar"]) {
      expect(marcado).toMatch(new RegExp(`<button[^>]*>${boton}</button>`));
    }
    // Sin pantalla de lectura, ni avisos, ni «Rige desde», ni fecha de vigencia (D-61), ni motivo (D-89).
    expect(t).not.toMatch(
      /Corregir|Seguir con el borrador|Hay un borrador|Rige desde|Vigencia|Motivo/i,
    );
    expect(redirigido.hacia).toEqual([]);
  });

  it("sin borrador y con algo vigente: lo abre con lo vigente precargado", async () => {
    servidor.datos = datos({ borrador: null });
    const marcado = await html();
    expect(titulos(marcado)).toEqual(["Datos fiscales"]);
    expect(marcado).toContain('value="Distribuidora Sur SA"');
    expect(marcado).toContain('value="Av. Rivadavia"');
    expect(marcado).toContain('value="2018-03-01"');
    expect(marcado).toMatch(
      /<option value="RESPONSABLE_INSCRIPTO" selected="">IVA Responsable Inscripto<\/option>/,
    );
    expect(redirigido.hacia).toEqual([]);
  });

  it("si lo vigente y el borrador existen, gana el borrador", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html();
    expect(marcado).not.toContain("Distribuidora Sur SA");
  });

  it("si nunca hubo nada: el formulario en blanco, con las migas hasta la lista", async () => {
    servidor.datos = datos({ vigente: null, borrador: null });
    const marcado = await html();
    expect(titulos(marcado)).toEqual(["Datos fiscales"]);
    expect(marcado).toContain('name="condicionIva"');
    expect(marcado).not.toMatch(
      /value="[^"]+"[^>]*name="razonSocial"|name="razonSocial"[^>]*value="[^"]+"/,
    );
    expect(marcado).toContain('href="/configuracion-fiscal"');
  });

  it("abrirla (y recargarla) solo lee: no escribe nada en el servidor", async () => {
    for (const cambios of [{ borrador: BORRADOR }, { borrador: null }, { vigente: null }]) {
      servidor.datos = datos(cambios);
      await html();
      await html();
    }
    expect(servidor.escrituras).toBe(0);
    expect(servidor.pedidos).toBe(6);
  });

  it("las tres condiciones frente al IVA con los textos del manual de ARCA (D-44) y la primera opción vacía con el nombre del campo", async () => {
    servidor.datos = datos({ borrador: BORRADOR });
    const marcado = await html();
    const select = /<select[^>]*name="condicionIva"[^>]*>(.*?)<\/select>/.exec(marcado)?.[1] ?? "";
    expect([...select.matchAll(/<option[^>]*>(.*?)<\/option>/g)].map((m) => m[1])).toEqual([
      "Condición frente al IVA",
      "IVA Responsable Inscripto",
      "Responsable Monotributo",
      "IVA Sujeto Exento",
    ]);
    expect(select.startsWith('<option value="">')).toBe(true);
  });

  it("sin permiso: «sin permiso» y ni un campo ni un botón", async () => {
    servidor.datos = falla("SIN_PERMISO");
    const marcado = await html();
    const t = texto(marcado);
    expect(t).toContain("No tenés permiso para hacer esto.");
    expect(t).not.toMatch(/SIN_PERMISO|CUIT|Distribuidora/);
    expect(marcado).not.toMatch(/<form|<button|<input|<select/);
    expect(redirigido.hacia).toEqual([]);
  });

  it("con un error inesperado muestra la referencia, nada técnico y ninguna acción", async () => {
    servidor.datos = {
      ok: false,
      error: { ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABC123" },
    };
    const marcado = await html();
    expect(texto(marcado)).toContain("PD-ABC123");
    expect(texto(marcado)).not.toContain("ERROR_INTERNO");
    expect(marcado).not.toMatch(/<button|<input/);
  });
});
