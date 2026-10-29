import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  entradaDeConfirmarDatosFiscales,
  entradaDeCrearPuntoDeVenta,
  entradaDeEditarPuntoDeVenta,
  entradaDeEmisor,
  entradaDeEmpezarCorreccion,
  entradaDeGuardarBorrador,
  entradaDePuntoDeVenta,
} from "./entradas-de-configuracion-fiscal";

/**
 * La frontera de las acciones de configuración fiscal (D-43): solo la FORMA del pedido. Lo que importa: que Ingresos Brutos no pasa (D-45),
 * que un dato de más se descarta (el servidor decide empresa y persona) y que el campo inválido se señala con el nombre del formulario.
 */

const AHORA = new Date("2026-10-29T12:00:00.000Z");
const id = () => randomUUID();

const domicilioNuevo = (cambios: Record<string, unknown> = {}) => ({
  tipo: "NUEVO",
  id: id(),
  calle: "Av. Corrientes",
  numero: "1234",
  localidad: "Rosario",
  provincia: "AR-S",
  ...cambios,
});

describe("entradaDeGuardarBorrador", () => {
  it("toma los datos, el domicilio nuevo (con sus opcionales vacíos como nulos) y la versión esperada", () => {
    const emisor = id();
    const borrador = id();
    const domicilio = domicilioNuevo();
    const r = entradaDeGuardarBorrador({
      emisorId: emisor,
      borradorId: borrador,
      versionEsperada: "3",
      razonSocial: "Zulu SA",
      condicionIva: "MONOTRIBUTO",
      inicioActividades: "2020-03-01",
      domicilio,
    });
    expect(r).toEqual({
      ok: true,
      valor: {
        emisorId: emisor,
        borradorId: borrador,
        versionEsperada: 3,
        cambios: {
          razonSocial: "Zulu SA",
          condicionIva: "MONOTRIBUTO",
          inicioActividades: "2020-03-01",
        },
        domicilio: {
          tipo: "NUEVO",
          id: domicilio.id,
          datos: {
            calle: "Av. Corrientes",
            numero: "1234",
            piso: null,
            departamento: null,
            localidad: "Rosario",
            provincia: "AR-S",
            codigoPostal: null,
          },
        },
      },
    });
  });

  it("un campo ausente no se toca: solo lo que viene pasa a los cambios", () => {
    const r = entradaDeGuardarBorrador({ emisorId: id(), borradorId: id(), razonSocial: "Zulu" });
    expect(r.ok && r.valor.cambios).toEqual({ razonSocial: "Zulu" });
    expect(r.ok && "versionEsperada" in r.valor).toBe(false);
    expect(r.ok && "domicilio" in r.valor).toBe(false);
  });

  it("un domicilio existente va por su id", () => {
    const existente = id();
    const r = entradaDeGuardarBorrador({
      emisorId: id(),
      borradorId: id(),
      domicilio: { tipo: "EXISTENTE", id: existente },
    });
    expect(r.ok && r.valor.domicilio).toEqual({ tipo: "EXISTENTE", id: existente });
  });

  it("D-45: Ingresos Brutos NO pasa, venga como venga; tampoco la empresa ni quién lo creó", () => {
    const r = entradaDeGuardarBorrador({
      emisorId: id(),
      borradorId: id(),
      razonSocial: "Zulu",
      iibbNumero: "902-123456-7",
      iibbCondicion: "LOCAL",
      empresaId: id(),
      creadoPor: id(),
    });
    expect(r.ok).toBe(true);
    const texto = JSON.stringify(r);
    expect(texto).not.toMatch(/iibb|902-123456|LOCAL|empresaId|creadoPor/);
    expect(r.ok && Object.keys(r.valor.cambios)).toEqual(["razonSocial"]);
  });

  it.each([
    ["sin emisor", { borradorId: id() }, "emisorId"],
    ["sin identificador del borrador", { emisorId: id() }, "borradorId"],
    ["emisor que no es un identificador", { emisorId: "uno", borradorId: id() }, "emisorId"],
    [
      "razón social que no es texto",
      { emisorId: id(), borradorId: id(), razonSocial: 5 },
      "razonSocial",
    ],
    [
      "versión negativa",
      { emisorId: id(), borradorId: id(), versionEsperada: -1 },
      "versionEsperada",
    ],
    [
      "domicilio nuevo sin calle",
      { emisorId: id(), borradorId: id(), domicilio: { ...domicilioNuevo(), calle: undefined } },
      "domicilio.calle",
    ],
    [
      "domicilio de un tipo que no existe",
      { emisorId: id(), borradorId: id(), domicilio: { tipo: "OTRO", id: id() } },
      "domicilio.tipo",
    ],
  ])("%s: datos inválidos del campo %s", (_caso, crudo, campo) => {
    expect(entradaDeGuardarBorrador(crudo)).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
    });
  });

  it.each([[null], [undefined], ["texto"], [42]])(
    "un pedido que no es un objeto (%s) es inválido",
    (crudo) => {
      expect(entradaDeGuardarBorrador(crudo)).toEqual({
        ok: false,
        error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS" },
      });
    },
  );
});

describe("entradaDeConfirmarDatosFiscales", () => {
  const base = () => ({
    emisorId: id(),
    borradorId: id(),
    versionEsperada: 2,
    motivo: "Alta inicial",
  });

  it("rige siempre desde el instante del servidor (D-61)", () => {
    const r = entradaDeConfirmarDatosFiscales(base(), AHORA);
    expect(r.ok && r.valor.vigenteDesde).toEqual(AHORA);
    expect(r.ok && r.valor.versionEsperada).toBe(2);
    expect(r.ok && r.valor.motivo).toBe("Alta inicial");
  });

  it.each([
    ["futuro", "2026-11-01T03:00:00.000Z"],
    ["pasado", "2020-01-01T00:00:00.000Z"],
    ["con zona", "2026-11-01T00:00:00-03:00"],
    ["que no es un instante", "mañana"],
    ["que no es un texto", 20261101],
  ])(
    "un «desde cuándo rige» %s que mande el navegador se descarta: rige desde el servidor (D-61)",
    (_caso, vigenteDesde) => {
      const r = entradaDeConfirmarDatosFiscales({ ...base(), vigenteDesde }, AHORA);
      expect(r.ok && r.valor.vigenteDesde).toEqual(AHORA);
      expect(r.ok && Object.keys(r.valor).sort()).toEqual([
        "borradorId",
        "emisorId",
        "motivo",
        "versionEsperada",
        "vigenteDesde",
      ]);
    },
  );

  it("la versión que vio la pantalla es obligatoria: se confirma lo que la persona tenía delante", () => {
    const sinVersion = { emisorId: id(), borradorId: id(), motivo: "Alta inicial" };
    expect(entradaDeConfirmarDatosFiscales(sinVersion, AHORA)).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "versionEsperada" },
    });
  });
});

describe("entradaDeEmpezarCorreccion (D-62)", () => {
  it("toma el emisor y la clave del borrador; lo demás se descarta (la empresa sale del contexto)", () => {
    const e = id();
    const b = id();
    expect(
      entradaDeEmpezarCorreccion({ emisorId: e, borradorId: b, empresaId: id(), razonSocial: "X" }),
    ).toEqual({ ok: true, valor: { emisorId: e, borradorId: b } });
  });

  it.each([
    ["sin emisor", { borradorId: id() }, "emisorId"],
    ["sin clave del borrador", { emisorId: id() }, "borradorId"],
    ["clave que no es un identificador", { emisorId: id(), borradorId: "uno" }, "borradorId"],
  ])("%s: datos inválidos de Configuración fiscal con el campo", (_caso, crudo, campo) => {
    expect(entradaDeEmpezarCorreccion(crudo)).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo },
    });
  });
});

describe("entradaDeEmisor y entradaDePuntoDeVenta", () => {
  it("solo toman el identificador", () => {
    const e = id();
    expect(entradaDeEmisor({ emisorId: e, empresaId: id() })).toEqual({
      ok: true,
      valor: { emisorId: e },
    });
    const p = id();
    expect(entradaDePuntoDeVenta({ puntoDeVentaId: p, estado: "ACTIVO" })).toEqual({
      ok: true,
      valor: { puntoDeVentaId: p },
    });
  });

  it("un identificador mal armado es un dato inválido de ese campo", () => {
    expect(entradaDeEmisor({ emisorId: "x" })).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "emisorId" },
    });
    expect(entradaDePuntoDeVenta({})).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "puntoDeVentaId" },
    });
  });
});

describe("entradaDeCrearPuntoDeVenta y entradaDeEditarPuntoDeVenta", () => {
  it("crear: el id de la pantalla, el emisor, la sucursal y el número (de texto o de número), con domicilio opcional", () => {
    const [pv, emisor, sucursal] = [id(), id(), id()];
    const r = entradaDeCrearPuntoDeVenta({
      id: pv,
      emisorId: emisor,
      sucursalId: sucursal,
      numero: "12",
    });
    expect(r).toEqual({
      ok: true,
      valor: { id: pv, emisorId: emisor, sucursalId: sucursal, numero: 12 },
    });
    const conDomicilio = entradaDeCrearPuntoDeVenta({
      id: pv,
      emisorId: emisor,
      sucursalId: sucursal,
      numero: 3,
      domicilio: { tipo: "EXISTENTE", id: id() },
    });
    expect(conDomicilio.ok && conDomicilio.valor.domicilio?.tipo).toBe("EXISTENTE");
  });

  it("crear: un número que no es entero, o sin sucursal, es inválido y señala el campo", () => {
    const ok = { id: id(), emisorId: id(), sucursalId: id(), numero: 1 };
    expect(entradaDeCrearPuntoDeVenta({ ...ok, numero: "1.5" })).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "numero" },
    });
    expect(entradaDeCrearPuntoDeVenta({ ...ok, sucursalId: undefined })).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "sucursalId" },
    });
  });

  it("editar: la versión es obligatoria y solo viene lo que cambia; el ambiente y el emisor no se pueden mandar", () => {
    const pv = id();
    const r = entradaDeEditarPuntoDeVenta({
      puntoDeVentaId: pv,
      versionEsperada: 4,
      numero: 7,
      ambiente: "PRODUCCION",
      emisorId: id(),
    });
    expect(r).toEqual({ ok: true, valor: { puntoDeVentaId: pv, versionEsperada: 4, numero: 7 } });
    expect(entradaDeEditarPuntoDeVenta({ puntoDeVentaId: pv })).toEqual({
      ok: false,
      error: { codigo: "FISCAL_CONFIGURACION_DATOS_INVALIDOS", campo: "versionEsperada" },
    });
  });
});
