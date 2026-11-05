import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../../src/capacidades/experiencia/respuesta";
import { modeloDeImpresion } from "../../src/modulos/fiscal/dominio/modelo-de-impresion";
import {
  consumidorFinal,
  facturaArmada,
  imprimibleDe,
  receptorInscripto,
  renglon,
} from "../utilidades/facturacion";
import { leerElPdf } from "../utilidades/pdf";

/**
 * La descarga del PDF (`.../comprobantes/[id]/pdf`): misma autorización que la vista de impresión (la pide con `verElModeloDeImpresion` y,
 * si no hay modelo, no se genera nada), sin caché, nombre de archivo seguro, errores genéricos con referencia y sin que el texto del
 * cliente llegue a una respuesta de error ni al registro. Corre el generador REAL; solo se reemplaza la lectura del servidor.
 */
vi.mock("server-only", () => ({}));
const registro = vi.hoisted((): { detalles: string[] } => ({ detalles: [] }));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: {
    respuesta: {
      registrar: (detalle: string) => registro.detalles.push(detalle),
      azar: () => new Uint8Array([1, 2, 3, 4]),
    },
  },
}));
const lectura = vi.hoisted((): { llamadas: unknown[]; respuesta: unknown } => ({
  llamadas: [],
  respuesta: null,
}));
vi.mock("../../apps/web/servidor/facturacion", () => ({
  verElModeloDeImpresion: (entrada: unknown) => {
    lectura.llamadas.push(entrada);
    return Promise.resolve(lectura.respuesta);
  },
}));

const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const RUTA = "../../apps/web/app/s/app/(operacion)/facturacion/comprobantes/[id]/pdf/route";
type Ruta = {
  GET: (p: Request, c: { params: Promise<{ id: string }> }) => Promise<Response>;
} & Record<string, unknown>;
const cargar = (): Promise<Ruta> => import(/* @vite-ignore */ RUTA);
const pedir = async (id: string): Promise<Response> =>
  (await cargar()).GET(new Request(`https://app.test/facturacion/comprobantes/${id}/pdf`), {
    params: Promise.resolve({ id }),
  });

function modeloDe(nombre?: string) {
  const c = facturaArmada(
    nombre === undefined ? consumidorFinal : { ...receptorInscripto, nombre },
    [renglon("1210.00", "1", "21", null, "Torta")],
  );
  const r = modeloDeImpresion(imprimibleDe(c), {
    nombreDeFantasia: null,
    logoUrl: null,
    colorPrincipal: null,
  });
  if (!r.ok) throw new Error(r.error);
  return r.valor;
}
const conModelo = (modelo: ReturnType<typeof modeloDe>): Respuesta<unknown> => ({
  ok: true,
  dato: { modelo, qrSvg: "<svg/>" },
});
const conError = (error: ErrorPublico): Respuesta<never> => ({ ok: false, error });

beforeEach(() => {
  lectura.llamadas = [];
  lectura.respuesta = conModelo(modeloDe());
  registro.detalles = [];
});

describe("la descarga del PDF", () => {
  it("entrega el PDF del comprobante con cabeceras de descarga privada, sin caché y con nombre seguro", async () => {
    const respuesta = await pedir(ID);
    expect(respuesta.status).toBe(200);
    expect(respuesta.headers.get("Content-Type")).toBe("application/pdf");
    expect(respuesta.headers.get("Content-Disposition")).toBe(
      'attachment; filename="Factura-B-00001-00000011.pdf"',
    );
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
    expect(respuesta.headers.get("X-Content-Type-Options")).toBe("nosniff");
    const bytes = new Uint8Array(await respuesta.arrayBuffer());
    expect(respuesta.headers.get("Content-Length")).toBe(String(bytes.length));
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    expect((await leerElPdf(bytes))[0]?.texto).toContain("00001-00000011");
  });

  it("pide el modelo solo con el id de la URL: la empresa, el permiso y la sucursal los decide el servidor", async () => {
    await pedir(ID);
    expect(lectura.llamadas).toEqual([{ comprobanteId: ID }]);
  });

  it("el nombre del archivo no lleva el CUIT, el nombre del cliente ni el id", async () => {
    lectura.respuesta = conModelo(modeloDe("Ana Pérez"));
    const disposicion = (await pedir(ID)).headers.get("Content-Disposition") ?? "";
    for (const dato of ["Ana", "Pérez", "30-", "0b9f6a1e", "Zulu"])
      expect(disposicion).not.toContain(dato);
  });

  it.each([
    "123",
    "no-es-un-id",
    "../../etc/passwd",
    "0B9F6A1E-2C3D-4E5F-8A7B-9C0D1E2F3A4B",
    `${ID}/..`,
    "<script>",
  ])(
    "un id con otra forma (%s) es «no encontrado»: ni se pregunta, ni se genera nada",
    async (id) => {
      const respuesta = await pedir(id);
      expect(respuesta.status).toBe(422);
      expect(await respuesta.json()).toEqual({ codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" });
      expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
      expect(lectura.llamadas).toEqual([]);
    },
  );

  it.each([
    ["sin sesión", "SESION_VENCIDA", 401],
    ["sin permiso (o fuera de su sucursal)", "SIN_PERMISO", 403],
    ["un comprobante que no existe o no es de la empresa", "FISCAL_COMPROBANTE_NO_ENCONTRADO", 422],
  ] as const)(
    "%s: si no hay modelo no hay PDF, y el error sale solo con su código",
    async (_n, codigo, estado) => {
      lectura.respuesta = conError(errorDeCodigo(codigo));
      const respuesta = await pedir(ID);
      expect(respuesta.status).toBe(estado);
      expect(respuesta.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
      expect(respuesta.headers.get("Content-Disposition")).toBeNull();
      expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
      expect(respuesta.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(await respuesta.json()).toEqual({ codigo });
    },
  );

  it("un error inesperado de la lectura sale genérico, con su referencia PD-… y sin detalle", async () => {
    lectura.respuesta = conError({ ...errorDeCodigo("ERROR_INTERNO"), referencia: "PD-ABCD-1234" });
    const respuesta = await pedir(ID);
    expect(respuesta.status).toBe(500);
    expect(await respuesta.json()).toEqual({ codigo: "ERROR_INTERNO", referencia: "PD-ABCD-1234" });
  });

  it("un carácter que la tipografía no tiene falla cerrado: error genérico con referencia, y el texto del cliente no sale ni al registro", async () => {
    lectura.respuesta = conModelo(modeloDe("Cliente Secreto 😀"));
    const respuesta = await pedir(ID);
    expect(respuesta.status).toBe(500);
    expect(respuesta.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    expect(respuesta.headers.get("Cache-Control")).toBe("private, no-store");
    const cuerpo = (await respuesta.json()) as { codigo: string; referencia: string };
    expect(cuerpo.codigo).toBe("ERROR_INTERNO");
    expect(cuerpo.referencia).toMatch(/^PD-/);
    expect(Object.keys(cuerpo).sort()).toEqual(["codigo", "referencia"]);
    expect(registro.detalles).toHaveLength(1);
    expect(registro.detalles[0]).toContain(cuerpo.referencia);
    expect(registro.detalles[0]).toContain("U+1F600");
    expect(registro.detalles[0]).not.toContain("Secreto");
  });

  it("la ruta solo atiende GET (Next deriva HEAD de él, con la misma autorización y sin cuerpo): cualquier otro método no existe", async () => {
    const ruta = await cargar();
    expect(Object.keys(ruta).sort()).toEqual(["GET", "dynamic", "runtime"]);
    expect(ruta["runtime"]).toBe("nodejs");
    // Nunca se genera al compilar ni se sirve de una copia guardada.
    expect(ruta["dynamic"]).toBe("force-dynamic");
  });
});
