import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  agregarElContacto,
  desactivarLaParte,
  fichaDeLaParte,
  guardarLaParte,
  listarLasPartes,
  quitarElContacto,
  reactivarLaParte,
  type DependenciasDeDirectorioWeb,
} from "./directorio-web";

const ID = "0b0b0b0b-1111-4222-8333-444444444444";
const OTRO = "0c0c0c0c-1111-4222-8333-444444444444";
const CLAVE = "0d0d0d0d-1111-4222-8333-444444444444";
const contexto = { empresaId: "e", personaId: "p" } as unknown as ContextoOperativo;

type Llamada = readonly [string, unknown];

function armar(
  resultados: Partial<Record<string, unknown>> = {},
): Readonly<{ d: DependenciasDeDirectorioWeb; llamadas: Llamada[]; registrados: string[] }> {
  const llamadas: Llamada[] = [];
  const registrados: string[] = [];
  const llamar = (nombre: string, def: unknown) => (_c: unknown, entrada: unknown) => {
    llamadas.push([nombre, entrada]);
    const r = Object.hasOwn(resultados, nombre) ? resultados[nombre] : def;
    if (r instanceof Error) return Promise.reject(r);
    return Promise.resolve(r);
  };
  const d = {
    casosDeUso: () => ({
      crearParte: llamar(
        "crearParte",
        ok({ parteId: ID, yaExistia: false, posiblesDuplicados: [] }),
      ),
      editarParteConRoles: llamar("editarParteConRoles", ok({ datos: {}, roles: {} })),
      desactivarParte: llamar("desactivarParte", ok({ yaEstaba: false })),
      reactivarParte: llamar("reactivarParte", ok({ yaEstaba: false })),
      vincularContacto: llamar("vincularContacto", ok({ yaExistia: false })),
      desvincularContacto: llamar("desvincularContacto", ok({ yaEstaba: false })),
    }),
    consultas: () => ({
      buscarPartes: llamar("buscarPartes", ok({ partes: [], siguiente: null })),
      fichaDeParte: llamar("fichaDeParte", ok(null)),
      posiblesDuplicados: llamar("posiblesDuplicados", ok([])),
    }),
    respuesta: { registrar: (x: string) => registrados.push(x), azar: () => new Uint8Array(4) },
  } as unknown as DependenciasDeDirectorioWeb;
  return { d, llamadas, registrados };
}

const FORMULARIO = {
  idempotencia: CLAVE,
  guardarIgual: false,
  naturaleza: "JURIDICA",
  nombre: "Lácteos del Sur S.A.",
  documentoTipo: "CUIT",
  documentoNumero: "30701234567",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  roles: ["PROVEEDOR"],
};

describe("listarLasPartes", () => {
  it("pasa lo pedido a la búsqueda y presenta solo lo que la pantalla necesita", async () => {
    const { d, llamadas } = armar({
      buscarPartes: ok({
        partes: [
          {
            id: ID,
            naturaleza: "JURIDICA",
            nombre: "Lácteos",
            documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
            email: "secreto@x.example",
            telefono: "1",
            roles: ["PROVEEDOR"],
            activa: true,
          },
        ],
        siguiente: OTRO,
      }),
    });
    const r = await listarLasPartes(d, contexto, {
      texto: "lac",
      rol: "PROVEEDOR",
      incluirDesactivadas: true,
      despuesDe: ID,
    });
    expect(llamadas).toEqual([
      [
        "buscarPartes",
        { texto: "lac", rol: "PROVEEDOR", incluirDesactivadas: true, despuesDe: ID },
      ],
    ]);
    expect(r).toEqual({
      ok: true,
      dato: {
        partes: [
          {
            id: ID,
            naturaleza: "JURIDICA",
            nombre: "Lácteos",
            documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
            roles: ["PROVEEDOR"],
            activa: true,
          },
        ],
        siguiente: OTRO,
      },
    });
  });

  it("sin filtros pide todas, sin las desactivadas", async () => {
    const { d, llamadas } = armar();
    await listarLasPartes(d, contexto, {});
    expect(llamadas[0]).toEqual([
      "buscarPartes",
      { texto: undefined, rol: undefined, incluirDesactivadas: false, despuesDe: undefined },
    ]);
  });

  it.each([{ rol: "ADMIN" }, { despuesDe: "no-es-un-id" }, { incluirDesactivadas: "si" }])(
    "un pedido sin la forma pedida es el genérico y no consulta (%j)",
    async (crudo) => {
      const { d, llamadas } = armar();
      const r = await listarLasPartes(d, contexto, crudo);
      expect(llamadas).toEqual([]);
      expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
    },
  );

  it("un rechazo del guard pasa con su motivo", async () => {
    const { d } = armar({ buscarPartes: err("SIN_PERMISO") });
    const r = await listarLasPartes(d, contexto, {});
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });
});

describe("fichaDeLaParte", () => {
  const ficha = {
    id: ID,
    version: 3,
    naturaleza: "JURIDICA",
    nombre: "Lácteos",
    apellido: null,
    alias: null,
    documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
    condicionIva: "RESPONSABLE_INSCRIPTO",
    email: null,
    telefono: null,
    domicilio: {
      pais: "AR",
      calle: "Av. Industria",
      numero: "2450",
      piso: null,
      departamento: null,
      localidad: "Avellaneda",
      provincia: "AR-B",
      codigoPostal: "1870",
      texto: null,
    },
    nota: null,
    activa: true,
    esAtajo: false,
    roles: ["PROVEEDOR"],
    vinculos: [
      {
        contacto: { id: OTRO, nombre: "Pérez, Raúl" },
        deParte: { id: ID, nombre: "Lácteos" },
        tipo: "CONTACTO",
        cargo: "Ventas",
      },
      {
        contacto: { id: ID, nombre: "Lácteos" },
        deParte: { id: OTRO, nombre: "Hotel" },
        tipo: "AGENTE_DE",
        cargo: null,
      },
    ],
  };

  it("presenta la ficha con sus contactos (solo los de esta parte) y su domicilio argentino", async () => {
    const { d, llamadas } = armar({ fichaDeParte: ok(ficha) });
    const r = await fichaDeLaParte(d, contexto, ID);
    expect(llamadas).toEqual([["fichaDeParte", { parteId: ID }]]);
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ID,
        version: 3,
        naturaleza: "JURIDICA",
        nombre: "Lácteos",
        apellido: null,
        alias: null,
        documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
        condicionIva: "RESPONSABLE_INSCRIPTO",
        email: null,
        telefono: null,
        domicilio: {
          calle: "Av. Industria",
          numero: "2450",
          codigoPostal: "1870",
          localidad: "Avellaneda",
          provincia: "AR-B",
        },
        nota: null,
        activa: true,
        roles: ["PROVEEDOR"],
        contactos: [{ contactoId: OTRO, nombre: "Pérez, Raúl", tipo: "CONTACTO", cargo: "Ventas" }],
      },
    });
  });

  it.each([
    ["sin domicilio", null],
    ["del exterior", { ...ficha.domicilio, pais: "UY" }],
    ["incompleto", { ...ficha.domicilio, calle: null }],
    ["sin número", { ...ficha.domicilio, numero: null }],
    ["sin localidad", { ...ficha.domicilio, localidad: null }],
    ["sin provincia", { ...ficha.domicilio, provincia: null }],
  ])("un domicilio %s no se muestra", async (_nombre, domicilio) => {
    const { d } = armar({ fichaDeParte: ok({ ...ficha, domicilio }) });
    const r = await fichaDeLaParte(d, contexto, ID);
    expect(r.ok && r.dato.domicilio).toBeNull();
  });

  it("una parte que no existe (o es de otra empresa) sale como el genérico", async () => {
    const { d } = armar({ fichaDeParte: ok(null) });
    const r = await fichaDeLaParte(d, contexto, ID);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("un rechazo de la consulta pasa tal cual", async () => {
    const { d } = armar({ fichaDeParte: err("SIN_PERMISO") });
    const r = await fichaDeLaParte(d, contexto, ID);
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("un id que no es un id es el genérico y no consulta", async () => {
    const { d, llamadas } = armar();
    const r = await fichaDeLaParte(d, contexto, "no");
    expect(llamadas).toEqual([]);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });
});

describe("guardarLaParte: alta", () => {
  it("sin duplicados crea la parte con su clave, sus roles y sus datos en la forma del dominio", async () => {
    const { d, llamadas } = armar();
    const r = await guardarLaParte(d, contexto, {
      ...FORMULARIO,
      email: "  ",
      calle: "Av. Industria",
      numero: "2450",
      localidad: "Avellaneda",
      provincia: "AR-B",
      codigoPostal: "1870",
    });
    expect(r).toEqual({ ok: true, dato: { estado: "GUARDADA", parteId: ID } });
    expect(llamadas.map((l) => l[0])).toEqual(["posiblesDuplicados", "crearParte"]);
    expect(llamadas[1]?.[1]).toEqual({
      idempotencia: CLAVE,
      roles: ["PROVEEDOR"],
      naturaleza: "JURIDICA",
      nombre: "Lácteos del Sur S.A.",
      apellido: null,
      alias: null,
      documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
      condicionIva: "RESPONSABLE_INSCRIPTO",
      email: null,
      telefono: null,
      domicilio: {
        pais: "AR",
        estructurado: {
          calle: "Av. Industria",
          numero: "2450",
          localidad: "Avellaneda",
          provincia: "AR-B",
          codigoPostal: "1870",
        },
      },
      nota: null,
    });
  });

  it("sin número de documento no manda documento aunque haya tipo; sin ningún dato de domicilio no manda domicilio", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...FORMULARIO, documentoNumero: "" });
    const alta = llamadas.find((l) => l[0] === "crearParte")?.[1] as Record<string, unknown>;
    expect(alta["documento"]).toBeNull();
    expect(alta["domicilio"]).toBeNull();
  });

  it("un domicilio a medias se manda tal cual: lo decide el dominio", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...FORMULARIO, calle: "Sarmiento" });
    const alta = llamadas.find((l) => l[0] === "crearParte")?.[1] as {
      domicilio: { estructurado: Record<string, unknown> };
    };
    expect(alta.domicilio.estructurado).toEqual({
      calle: "Sarmiento",
      numero: "",
      localidad: "",
      provincia: "",
      codigoPostal: null,
    });
  });

  it("un domicilio con solo el número manda la calle vacía: lo decide el dominio", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...FORMULARIO, numero: "10" });
    const alta = llamadas.find((l) => l[0] === "crearParte")?.[1] as {
      domicilio: { estructurado: Record<string, unknown> };
    };
    expect(alta.domicilio.estructurado["calle"]).toBe("");
    expect(alta.domicilio.estructurado["numero"]).toBe("10");
  });

  it("con un documento de un tipo que no vino lo manda vacío para que el dominio lo rechace", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...FORMULARIO, documentoTipo: undefined });
    const alta = llamadas.find((l) => l[0] === "crearParte")?.[1] as {
      documento: Record<string, unknown>;
    };
    expect(alta.documento).toEqual({ tipo: "", pais: null, numero: "30701234567" });
  });

  it("un alta con parteId nulo (no ausente) también es un alta", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true, parteId: null });
    expect(llamadas.map((l) => l[0])).toEqual(["crearParte"]);
  });

  it("un campo opcional que viene nulo es «sin dato»", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, {
      ...FORMULARIO,
      guardarIgual: true,
      email: null,
      apellido: null,
    });
    expect(llamadas[0]?.[1]).toMatchObject({ email: null, apellido: null });
  });

  it("con posibles duplicados NO escribe nada y los devuelve (solo avisa)", async () => {
    const { d, llamadas } = armar({
      posiblesDuplicados: ok([{ parteId: OTRO, nombre: "Lácteos del Sur", razones: ["NOMBRE"] }]),
    });
    const r = await guardarLaParte(d, contexto, FORMULARIO);
    expect(r).toEqual({
      ok: true,
      dato: { estado: "DUPLICADOS", duplicados: [{ parteId: OTRO, nombre: "Lácteos del Sur" }] },
    });
    expect(llamadas.map((l) => l[0])).toEqual(["posiblesDuplicados"]);
    expect(llamadas[0]?.[1]).toEqual({
      nombre: "Lácteos del Sur S.A.",
      apellido: null,
      alias: null,
      email: null,
      telefono: null,
    });
  });

  it("«Guardar igual» crea sin volver a buscar duplicados", async () => {
    const { d, llamadas } = armar({
      posiblesDuplicados: ok([{ parteId: OTRO, nombre: "X", razones: [] }]),
    });
    const r = await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true });
    expect(r).toEqual({ ok: true, dato: { estado: "GUARDADA", parteId: ID } });
    expect(llamadas.map((l) => l[0])).toEqual(["crearParte"]);
  });

  it("repetir el envío (misma clave) devuelve la misma parte: la idempotencia es del caso de uso", async () => {
    const { d, llamadas } = armar({
      crearParte: ok({ parteId: ID, yaExistia: true, posiblesDuplicados: [] }),
    });
    const a = await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true });
    const b = await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true });
    expect(a).toEqual(b);
    expect(
      llamadas
        .filter((l) => l[0] === "crearParte")
        .map((l) => (l[1] as { idempotencia: string }).idempotencia),
    ).toEqual([CLAVE, CLAVE]);
  });

  it("un error de la búsqueda de duplicados corta antes de escribir", async () => {
    const { d, llamadas } = armar({ posiblesDuplicados: err("SIN_PERMISO") });
    const r = await guardarLaParte(d, contexto, FORMULARIO);
    expect(r.ok === false && r.error.codigo).toBe("SIN_PERMISO");
    expect(llamadas.map((l) => l[0])).toEqual(["posiblesDuplicados"]);
  });

  it("un documento ya registrado sale con su texto y su campo; no lleva el id de la otra parte", async () => {
    const { d } = armar({
      crearParte: err({ error: "DOCUMENTO_YA_REGISTRADO", parteId: OTRO }),
    });
    const r = await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.codigo).toBe("CLIENTES_DOCUMENTO_REPETIDO");
    expect(r.error.campo).toBe("documentoNumero");
    expect(JSON.stringify(r.error)).not.toContain(OTRO);
  });

  it.each([
    { guardarIgual: "si" },
    { roles: ["ADMIN"] },
    { roles: "PROVEEDOR" },
    { idempotencia: "no" },
    { nombre: undefined },
  ])("un pedido sin la forma pedida es el genérico y no escribe (%j)", async (cambio) => {
    const { d, llamadas } = armar();
    const r = await guardarLaParte(d, contexto, { ...FORMULARIO, ...cambio });
    expect(llamadas).toEqual([]);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("más roles que los que existen (uno por cada rol) es un pedido sin forma: no escribe", async () => {
    const { d, llamadas } = armar();
    const r = await guardarLaParte(d, contexto, {
      ...FORMULARIO,
      roles: ["PROVEEDOR", "CUSTOMER", "PROVEEDOR"],
    });
    expect(llamadas).toEqual([]);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("los roles repetidos se mandan una sola vez", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, {
      ...FORMULARIO,
      guardarIgual: true,
      roles: ["PROVEEDOR", "PROVEEDOR"],
    });
    expect((llamadas[0]?.[1] as { roles: string[] }).roles).toEqual(["PROVEEDOR"]);
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { d, registrados } = armar({
      crearParte: new Error("relation x does not exist"),
    });
    const r = await guardarLaParte(d, contexto, { ...FORMULARIO, guardarIgual: true });
    expect(r.ok === false && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("relation");
    expect(registrados.some((x) => x.includes("relation x does not exist"))).toBe(true);
  });
});

describe("guardarLaParte: edición", () => {
  const EDICION = {
    ...FORMULARIO,
    parteId: ID,
    versionEsperada: 3,
    roles: ["CUSTOMER", "PROVEEDOR"],
  };

  it("guarda datos y roles juntos con la versión que se vio, en una sola llamada; no busca duplicados", async () => {
    const { d, llamadas } = armar();
    const r = await guardarLaParte(d, contexto, EDICION);
    expect(r).toEqual({ ok: true, dato: { estado: "GUARDADA", parteId: ID } });
    expect(llamadas.map((l) => l[0])).toEqual(["editarParteConRoles"]);
    expect(llamadas[0]?.[1]).toMatchObject({
      parteId: ID,
      versionEsperada: 3,
      roles: ["CUSTOMER", "PROVEEDOR"],
    });
    expect((llamadas[0]?.[1] as { cambios: Record<string, unknown> }).cambios).toMatchObject({
      naturaleza: "JURIDICA",
      nombre: "Lácteos del Sur S.A.",
      documento: { tipo: "CUIT", pais: null, numero: "30701234567" },
      email: null,
    });
  });

  it("la versión viene como texto de dígitos del formulario", async () => {
    const { d, llamadas } = armar();
    await guardarLaParte(d, contexto, { ...EDICION, versionEsperada: "3" });
    expect(llamadas[0]?.[1]).toMatchObject({ versionEsperada: 3 });
  });

  it("sin la versión que se vio no escribe y sale como el genérico", async () => {
    const { d, llamadas } = armar();
    const r = await guardarLaParte(d, contexto, { ...EDICION, versionEsperada: undefined });
    expect(llamadas).toEqual([]);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
    const r2 = await guardarLaParte(d, contexto, { ...EDICION, versionEsperada: null });
    expect(r2.ok === false && r2.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("un dato rechazado sale por su campo", async () => {
    const { d } = armar({
      editarParteConRoles: err({
        error: "DATOS_INVALIDOS",
        campos: [{ campo: "email", codigo: "EMAIL_INVALIDO" }],
      }),
    });
    const r = await guardarLaParte(d, contexto, EDICION);
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_EMAIL_INVALIDO");
  });

  it.each(["VERSION_DESACTUALIZADA", "ROL_DE_PARTE_INVALIDO"])(
    "%s sale como el genérico",
    async (e) => {
      const { d } = armar({ editarParteConRoles: err(e) });
      const r = await guardarLaParte(d, contexto, EDICION);
      expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
    },
  );
});

describe("desactivar, reactivar y contactos", () => {
  it("desactivar y reactivar llaman a su caso de uso con la parte", async () => {
    const { d, llamadas } = armar();
    expect(await desactivarLaParte(d, contexto, { parteId: ID, otro: "ignorado" })).toEqual({
      ok: true,
      dato: {},
    });
    expect(await reactivarLaParte(d, contexto, { parteId: ID })).toEqual({ ok: true, dato: {} });
    expect(llamadas).toEqual([
      ["desactivarParte", { parteId: ID }],
      ["reactivarParte", { parteId: ID }],
    ]);
  });

  it("sin permiso (quien opera no desactiva) sale con el motivo del guard", async () => {
    const { d } = armar({
      desactivarParte: err("SIN_PERMISO"),
      reactivarParte: err("SIN_PERMISO"),
    });
    const a = await desactivarLaParte(d, contexto, { parteId: ID });
    const b = await reactivarLaParte(d, contexto, { parteId: ID });
    expect(a.ok === false && a.error.codigo).toBe("SIN_PERMISO");
    expect(b.ok === false && b.error.codigo).toBe("SIN_PERMISO");
  });

  it("un id que no es un id es el genérico", async () => {
    const { d, llamadas } = armar();
    const a = await desactivarLaParte(d, contexto, { parteId: "no" });
    const b = await reactivarLaParte(d, contexto, {});
    expect(llamadas).toEqual([]);
    expect(a.ok === false && a.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
    expect(b.ok === false && b.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("agregar un contacto lo vincula como CONTACTO con su cargo (o sin cargo si viene en blanco)", async () => {
    const { d, llamadas } = armar();
    expect(
      await agregarElContacto(d, contexto, { deParteId: ID, contactoId: OTRO, cargo: "Ventas" }),
    ).toEqual({ ok: true, dato: {} });
    await agregarElContacto(d, contexto, { deParteId: ID, contactoId: OTRO, cargo: " " });
    expect(llamadas).toEqual([
      ["vincularContacto", { contactoId: OTRO, deParteId: ID, tipo: "CONTACTO", cargo: "Ventas" }],
      ["vincularContacto", { contactoId: OTRO, deParteId: ID, tipo: "CONTACTO", cargo: null }],
    ]);
  });

  it("un contacto que no puede serlo (una empresa) sale como el genérico", async () => {
    const { d } = armar({ vincularContacto: err("CONTACTO_DEBE_SER_HUMANA") });
    const r = await agregarElContacto(d, contexto, { deParteId: ID, contactoId: OTRO });
    expect(r.ok === false && r.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
  });

  it("quitar un contacto lo desvincula con su tipo", async () => {
    const { d, llamadas } = armar();
    const r = await quitarElContacto(d, contexto, {
      deParteId: ID,
      contactoId: OTRO,
      tipo: "CONTACTO",
    });
    expect(r).toEqual({ ok: true, dato: {} });
    expect(llamadas).toEqual([
      ["desvincularContacto", { contactoId: OTRO, deParteId: ID, tipo: "CONTACTO" }],
    ]);
  });

  it.each([{ deParteId: "no", contactoId: OTRO }, { deParteId: ID }, {}])(
    "un pedido de contacto sin la forma pedida es el genérico (%j)",
    async (crudo) => {
      const { d, llamadas } = armar();
      const a = await agregarElContacto(d, contexto, crudo);
      const b = await quitarElContacto(d, contexto, crudo);
      expect(llamadas).toEqual([]);
      expect(a.ok === false && a.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
      expect(b.ok === false && b.error.codigo).toBe("CLIENTES_ACCION_NO_PERMITIDA");
    },
  );
});
