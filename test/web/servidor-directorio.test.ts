import { beforeEach, describe, expect, it, vi } from "vitest";
import { errorDeCodigo } from "../../src/capacidades/experiencia/respuesta";

/**
 * `apps/web/servidor/directorio.ts` («Clientes y proveedores»): la empresa y la persona salen de la sesión (`conLaEmpresa`), NUNCA del formulario; del formulario del navegador solo se toman los
 * campos declarados; el rol se traduce a la lista cerrada de la composición; y ninguna acción redirige (un `redirect` dentro de una acción pierde el host, defecto hallado el 16/11/2026).
 * La composición (`src/composicion/directorio-web.ts`) es falsa acá (la prueban `directorio-web.test.ts` y `test/integracion/clientes-editar-con-roles.test.ts`): se mira lo que se le pide.
 * Previene: actuar sobre otra empresa porque la dijo el navegador, filtrar la lista con un rol inventado, o que una acción corte con un redirect.
 */
vi.mock("server-only", () => ({}));
const redirige = vi.hoisted(() => vi.fn());
vi.mock("next/navigation", () => ({ redirect: redirige }));

const CONTEXTO = { empresaId: "empresa-de-la-sesion" };
const PARTE = "11111111-1111-4111-8111-111111111111";
const CONTACTO = "22222222-2222-4222-8222-222222222222";
const ERROR = errorDeCodigo("CLIENTES_FALTA_EL_NOMBRE");

type Llamada = Readonly<{ nombre: string; contexto: unknown; entrada: Record<string, unknown> }>;
const mundo = vi.hoisted(
  (): { llamadas: Llamada[]; respuesta: unknown; dependencias: unknown[] } => ({
    llamadas: [],
    respuesta: null,
    dependencias: [],
  }),
);

vi.mock("../../apps/web/servidor/composicion", () => ({
  web: { casosDeUsoDeClientes: "casos-de-uso", consultasDeClientes: "consultas" },
}));
vi.mock("../../apps/web/servidor/sesion", () => ({
  dependenciasDeSesion: { respuesta: "respuesta-de-sesion" },
}));
vi.mock("../../apps/web/servidor/con-la-empresa", () => ({
  conLaEmpresa: (hacer: (contexto: unknown) => unknown) => hacer(CONTEXTO),
}));
vi.mock("../../src/composicion/directorio-web", () => {
  const falsa =
    (nombre: string) =>
    (dependencias: unknown, contexto: unknown, entrada: Record<string, unknown>) => {
      mundo.dependencias.push(dependencias);
      mundo.llamadas.push({ nombre, contexto, entrada });
      return Promise.resolve(mundo.respuesta);
    };
  return {
    listarLasPartes: falsa("listarLasPartes"),
    fichaDeLaParte: (dependencias: unknown, contexto: unknown, parteId: string) =>
      falsa("fichaDeLaParte")(dependencias, contexto, { parteId }),
    guardarLaParte: falsa("guardarLaParte"),
    desactivarLaParte: falsa("desactivarLaParte"),
    reactivarLaParte: falsa("reactivarLaParte"),
    agregarElContacto: falsa("agregarElContacto"),
    quitarElContacto: falsa("quitarElContacto"),
  };
});

const RUTA = "../../apps/web/servidor/directorio";
type Directorio = {
  cargarLasPartes: (buscar: Record<string, string | undefined>) => Promise<unknown>;
  cargarLaParte: (parteId: string) => Promise<unknown>;
  guardarLaParteDelFormulario: (
    parteId: string | null,
    versionEsperada: number | null,
    datos: FormData,
  ) => Promise<{ error: unknown; guardada: boolean; duplicados: unknown[] }>;
  desactivarLaParteDelDirectorio: (parteId: string) => Promise<unknown>;
  reactivarLaParteDelDirectorio: (parteId: string) => Promise<unknown>;
  agregarUnContacto: (deParteId: string, datos: FormData) => Promise<unknown>;
  quitarUnContacto: (deParteId: string, contactoId: string, tipo: string) => Promise<unknown>;
};
const cargar = () => import(/* @vite-ignore */ RUTA) as Promise<Directorio>;
const ultima = (): Llamada => {
  const l = mundo.llamadas.at(-1);
  if (l === undefined) throw new Error("la composición no se llamó");
  return l;
};
const formulario = (extra: Record<string, string> = {}): FormData => {
  const datos = new FormData();
  for (const [k, v] of Object.entries({
    idempotencia: "clave-1",
    naturaleza: "PERSONA",
    nombre: "Ana",
    ...extra,
  }))
    datos.set(k, v);
  return datos;
};

beforeEach(() => {
  mundo.llamadas = [];
  mundo.dependencias = [];
  mundo.respuesta = { ok: true, dato: {} };
  redirige.mockClear();
});

describe("servidor del directorio: la lista", () => {
  it.each([
    ["cliente", "CUSTOMER"],
    ["proveedor", "PROVEEDOR"],
    ["otro", null],
    [undefined, null],
    ["CUSTOMER", null],
  ])("el rol de la dirección %j pide %j", async (rol, esperado) => {
    const { cargarLasPartes } = await cargar();
    await cargarLasPartes({ rol });
    expect(ultima().entrada["rol"]).toBe(esperado);
  });

  it.each([
    ["1", true],
    ["0", false],
    ["true", false],
    [undefined, false],
  ])("desactivados=%j pide incluirDesactivadas=%j", async (desactivados, esperado) => {
    const { cargarLasPartes } = await cargar();
    await cargarLasPartes({ desactivados });
    expect(ultima().entrada["incluirDesactivadas"]).toBe(esperado);
  });

  it("la empresa es la de la sesión, las dependencias son las de la composición y el texto y la página salen de la dirección", async () => {
    const { cargarLasPartes } = await cargar();
    await cargarLasPartes({ texto: "ana", despuesDe: "cursor" });
    const l = ultima();
    expect(l.contexto).toBe(CONTEXTO);
    expect(mundo.dependencias[0]).toEqual({
      casosDeUso: "casos-de-uso",
      consultas: "consultas",
      respuesta: "respuesta-de-sesion",
    });
    expect(l.entrada).toMatchObject({ texto: "ana", despuesDe: "cursor" });
  });
});

describe("servidor del directorio: guardar", () => {
  it("arma el pedido SOLO con los campos declarados: un empresaId o un campo inventado no llegan", async () => {
    const { guardarLaParteDelFormulario } = await cargar();
    await guardarLaParteDelFormulario(
      null,
      null,
      formulario({ empresaId: "otra-empresa", personaId: "otra", rolInventado: "x" }),
    );
    const l = ultima();
    expect(l.contexto).toBe(CONTEXTO);
    expect(Object.keys(l.entrada).sort()).toEqual(
      [
        "idempotencia",
        "parteId",
        "versionEsperada",
        "guardarIgual",
        "naturaleza",
        "nombre",
        "apellido",
        "alias",
        "documentoTipo",
        "documentoPais",
        "documentoNumero",
        "condicionIva",
        "email",
        "telefono",
        "calle",
        "numero",
        "codigoPostal",
        "localidad",
        "provincia",
        "nota",
        "roles",
      ].sort(),
    );
    expect(l.entrada).toMatchObject({
      idempotencia: "clave-1",
      parteId: null,
      versionEsperada: null,
      naturaleza: "PERSONA",
      nombre: "Ana",
      apellido: "",
      roles: [],
    });
  });

  it("una edición lleva el id y la versión que se vio, que no salen del formulario", async () => {
    const { guardarLaParteDelFormulario } = await cargar();
    await guardarLaParteDelFormulario(
      PARTE,
      4,
      formulario({ parteId: "otra", versionEsperada: "9" }),
    );
    expect(ultima().entrada).toMatchObject({ parteId: PARTE, versionEsperada: 4 });
  });

  it("con coincidencias devuelve los duplicados y NO queda guardada", async () => {
    const duplicados = [{ parteId: PARTE, nombre: "Ana" }];
    mundo.respuesta = { ok: true, dato: { estado: "DUPLICADOS", duplicados } };
    const { guardarLaParteDelFormulario } = await cargar();
    expect(await guardarLaParteDelFormulario(null, null, formulario())).toEqual({
      error: null,
      guardada: false,
      duplicados,
    });
  });

  it("guardada: guardada true y sin duplicados", async () => {
    mundo.respuesta = { ok: true, dato: { estado: "GUARDADA" } };
    const { guardarLaParteDelFormulario } = await cargar();
    expect(await guardarLaParteDelFormulario(null, null, formulario())).toEqual({
      error: null,
      guardada: true,
      duplicados: [],
    });
  });

  it("un error de la composición vuelve como error, sin guardar y sin duplicados", async () => {
    mundo.respuesta = { ok: false, error: ERROR };
    const { guardarLaParteDelFormulario } = await cargar();
    expect(await guardarLaParteDelFormulario(null, null, formulario())).toEqual({
      error: ERROR,
      guardada: false,
      duplicados: [],
    });
  });

  it.each([
    ["1", true],
    ["0", false],
    ["true", false],
    ["", false],
    [undefined, false],
  ])("guardarIgual=%j llega como %j (solo vale exactamente «1»)", async (valor, esperado) => {
    const { guardarLaParteDelFormulario } = await cargar();
    const datos = formulario();
    if (valor !== undefined) datos.set("guardarIgual", valor);
    await guardarLaParteDelFormulario(null, null, datos);
    expect(ultima().entrada["guardarIgual"]).toBe(esperado);
  });

  it("los roles son los textos marcados; un archivo en ese campo no pasa", async () => {
    const { guardarLaParteDelFormulario } = await cargar();
    const datos = formulario();
    datos.append("roles", "CUSTOMER");
    datos.append("roles", new File(["x"], "roles.txt"));
    datos.append("roles", "PROVEEDOR");
    await guardarLaParteDelFormulario(null, null, datos);
    expect(ultima().entrada["roles"]).toEqual(["CUSTOMER", "PROVEEDOR"]);
  });

  it("un campo de texto que viene como archivo llega vacío, no como archivo", async () => {
    const { guardarLaParteDelFormulario } = await cargar();
    const datos = formulario();
    datos.set("nombre", new File(["x"], "nombre.txt"));
    await guardarLaParteDelFormulario(null, null, datos);
    expect(ultima().entrada["nombre"]).toBe("");
  });
});

describe("servidor del directorio: desactivar, reactivar y contactos", () => {
  it("desactivar y reactivar llaman con el id ligado y devuelven { error: null }", async () => {
    const { desactivarLaParteDelDirectorio, reactivarLaParteDelDirectorio } = await cargar();
    expect(await desactivarLaParteDelDirectorio(PARTE)).toEqual({ error: null });
    expect(ultima()).toMatchObject({
      nombre: "desactivarLaParte",
      contexto: CONTEXTO,
      entrada: { parteId: PARTE },
    });
    expect(await reactivarLaParteDelDirectorio(PARTE)).toEqual({ error: null });
    expect(ultima()).toMatchObject({ nombre: "reactivarLaParte", entrada: { parteId: PARTE } });
  });

  it("agregar un contacto toma el contacto y el cargo del formulario y la parte, del id ligado", async () => {
    const { agregarUnContacto } = await cargar();
    const datos = new FormData();
    datos.set("contactoId", CONTACTO);
    datos.set("cargo", "Compras");
    datos.set("deParteId", "otra");
    expect(await agregarUnContacto(PARTE, datos)).toEqual({ error: null });
    expect(ultima()).toMatchObject({
      nombre: "agregarElContacto",
      contexto: CONTEXTO,
      entrada: { deParteId: PARTE, contactoId: CONTACTO, cargo: "Compras" },
    });
  });

  it("quitar un contacto lleva los tres datos ligados", async () => {
    const { quitarUnContacto } = await cargar();
    expect(await quitarUnContacto(PARTE, CONTACTO, "EMPLEADO")).toEqual({ error: null });
    expect(ultima()).toMatchObject({
      nombre: "quitarElContacto",
      entrada: { deParteId: PARTE, contactoId: CONTACTO, tipo: "EMPLEADO" },
    });
  });

  it("un error de la composición vuelve como { error } en las cuatro acciones", async () => {
    mundo.respuesta = { ok: false, error: ERROR };
    const d = await cargar();
    const datos = new FormData();
    expect(await d.desactivarLaParteDelDirectorio(PARTE)).toEqual({ error: ERROR });
    expect(await d.reactivarLaParteDelDirectorio(PARTE)).toEqual({ error: ERROR });
    expect(await d.agregarUnContacto(PARTE, datos)).toEqual({ error: ERROR });
    expect(await d.quitarUnContacto(PARTE, CONTACTO, "EMPLEADO")).toEqual({ error: ERROR });
  });
});

describe("servidor del directorio: ninguna acción redirige", () => {
  it("ni con éxito ni con error", async () => {
    const d = await cargar();
    for (const respuesta of [
      { ok: true, dato: { estado: "GUARDADA" } },
      { ok: false, error: ERROR },
    ]) {
      mundo.respuesta = respuesta;
      await d.guardarLaParteDelFormulario(null, null, formulario());
      await d.desactivarLaParteDelDirectorio(PARTE);
      await d.reactivarLaParteDelDirectorio(PARTE);
      await d.agregarUnContacto(PARTE, new FormData());
      await d.quitarUnContacto(PARTE, CONTACTO, "EMPLEADO");
    }
    expect(redirige).not.toHaveBeenCalled();
  });
});
