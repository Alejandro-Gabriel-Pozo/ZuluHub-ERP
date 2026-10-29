import { describe, expect, it } from "vitest";
import {
  OPCIONES_DE_PROVINCIA,
  VALORES_EN_BLANCO,
  armarElPedidoDeAlta,
  armarElPedidoDeEdicion,
  armarElPuntoDeVenta,
  armarLaListaDePuntosDeVenta,
  hayDomicilioCargado,
  lugarDelError,
  tituloDelPuntoDeVenta,
  valoresParaEditar,
  type PuntoParaConfigurar,
  type ValoresDelFormulario,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-puntos-de-venta";
import { PROVINCIAS } from "../../src/primitivas/domicilio/provincias";

/**
 * El modelo de Puntos de venta (D-43, D-48, D-63): la lista (todos, activos o no), la pantalla de cada uno, el armado del pedido de
 * alta y de edición (provincia por código, ids de idempotencia, solo lo que cambió) y dónde se marca cada error.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const IDS = { puntoDeVentaId: ID, domicilioId: "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c" } as const;
const EMISOR = "2d1b8c3a-4e5f-4a71-8c9d-1e2f3a4b5c6d";

const punto = (cambios: Partial<PuntoParaConfigurar> = {}): PuntoParaConfigurar => ({
  id: ID,
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  hayNumerosUsados: false,
  version: 7,
  ...cambios,
});

const completo: ValoresDelFormulario = {
  numero: "00004",
  sucursalId: "s-central",
  calle: " Av. Rivadavia ",
  numeroDeCalle: "1234",
  piso: "",
  departamento: "  ",
  localidad: "Ciudad de Buenos Aires",
  provincia: "AR-C",
  codigoPostal: "1000",
};

describe("la lista de puntos de venta", () => {
  it("muestra todos, activos o no, con el número en cinco dígitos, la sucursal, si está activo y el ambiente", () => {
    const filas = armarLaListaDePuntosDeVenta([
      punto({ id: "a", numero: 1, ambiente: "PRODUCCION" }),
      punto({ id: "b", numero: 3, activo: false }),
    ]);
    expect(filas.map((f) => [f.numero, f.sucursal, f.activo.texto, f.ambiente.texto])).toEqual([
      ["00001", "Sucursal Norte", "Activo", "Producción"],
      ["00003", "Sucursal Norte", "No activo", "Pruebas"],
    ]);
    expect(filas.map((f) => f.href)).toEqual([
      "/configuracion-fiscal/puntos-de-venta/a",
      "/configuracion-fiscal/puntos-de-venta/b",
    ]);
  });

  it("una sucursal cerrada se dice como en el Listado", () => {
    const [fila] = armarLaListaDePuntosDeVenta([
      punto({ sucursal: { id: "s", nombre: "Centro", activa: false } }),
    ]);
    expect(fila?.sucursal).toBe("Centro · Cerrada");
  });
});

describe("la pantalla de un punto de venta", () => {
  it("el título lleva el número en cinco dígitos", () => {
    expect(tituloDelPuntoDeVenta(2)).toBe("Punto de venta 00002");
    expect(armarElPuntoDeVenta(punto()).titulo).toBe("Punto de venta 00002");
  });

  it("solo se ofrece pasar a producción mientras está en pruebas (D-48: de producción no se vuelve)", () => {
    expect(armarElPuntoDeVenta(punto({ ambiente: "HOMOLOGACION" })).puedePasarAProduccion).toBe(
      true,
    );
    expect(armarElPuntoDeVenta(punto({ ambiente: "PRODUCCION" })).puedePasarAProduccion).toBe(
      false,
    );
  });
});

describe("las provincias", () => {
  it("son las 24 de la primitiva: se ve el nombre y se manda el código ISO", () => {
    expect(OPCIONES_DE_PROVINCIA).toHaveLength(24);
    expect(OPCIONES_DE_PROVINCIA).toEqual(
      PROVINCIAS.map((p) => ({ valor: p.codigo, etiqueta: p.nombre })),
    );
    expect(OPCIONES_DE_PROVINCIA.find((o) => o.etiqueta === "Santa Fe")?.valor).toBe("AR-S");
  });
});

describe("el pedido de alta", () => {
  it("lleva el id del punto de venta y el del domicilio nuevo, el número como texto y la provincia por código", () => {
    expect(armarElPedidoDeAlta(completo, IDS, EMISOR)).toEqual({
      id: IDS.puntoDeVentaId,
      emisorId: EMISOR,
      sucursalId: "s-central",
      numero: "00004",
      domicilio: {
        tipo: "NUEVO",
        id: IDS.domicilioId,
        calle: "Av. Rivadavia",
        numero: "1234",
        piso: null,
        departamento: null,
        localidad: "Ciudad de Buenos Aires",
        provincia: "AR-C",
        codigoPostal: "1000",
      },
    });
  });

  it("sin nada del domicilio no manda domicilio (se puede crear sin él; sin domicilio no se activa)", () => {
    const pedido = armarElPedidoDeAlta(
      { ...VALORES_EN_BLANCO, numero: "5", sucursalId: "s" },
      IDS,
      EMISOR,
    );
    expect(pedido).toEqual({ id: ID, emisorId: EMISOR, sucursalId: "s", numero: "5" });
    expect(hayDomicilioCargado(VALORES_EN_BLANCO)).toBe(false);
  });

  it("un domicilio a medias se manda tal cual: el servidor dice qué campo falta", () => {
    const pedido = armarElPedidoDeAlta({ ...VALORES_EN_BLANCO, calle: "Mitre" }, IDS, EMISOR);
    expect(pedido.domicilio).toMatchObject({ tipo: "NUEVO", calle: "Mitre", localidad: "" });
  });

  it("el número que no es un número viaja como se escribió (lo rechaza el servidor marcando «numero»)", () => {
    expect(armarElPedidoDeAlta({ ...completo, numero: " abc " }, IDS, EMISOR).numero).toBe("abc");
  });

  it("el mismo formulario y los mismos ids dan el mismo pedido (un reintento reenvía lo mismo)", () => {
    expect(armarElPedidoDeAlta(completo, IDS, EMISOR)).toEqual(
      armarElPedidoDeAlta(completo, IDS, EMISOR),
    );
  });
});

describe("el pedido de edición", () => {
  const original = punto({ numero: 2, version: 7 });

  it("abre con el número en cinco dígitos y la sucursal; el domicilio queda en blanco (ninguna consulta lo entrega)", () => {
    expect(valoresParaEditar(original)).toEqual({
      ...VALORES_EN_BLANCO,
      numero: "00002",
      sucursalId: "s-norte",
    });
  });

  it("sin cambios manda solo la versión y el id: no toca el número (uno que ya emitió no se puede cambiar)", () => {
    expect(armarElPedidoDeEdicion(valoresParaEditar(original), IDS, original)).toEqual({
      puntoDeVentaId: ID,
      versionEsperada: 7,
    });
  });

  it("escribir el mismo número sin ceros no es un cambio", () => {
    expect(
      armarElPedidoDeEdicion({ ...valoresParaEditar(original), numero: "2" }, IDS, original),
    ).toEqual({ puntoDeVentaId: ID, versionEsperada: 7 });
  });

  it("manda solo lo que cambió, con un domicilio nuevo si se escribió alguno", () => {
    const pedido = armarElPedidoDeEdicion(
      { ...completo, numero: "00009", sucursalId: "s-central" },
      IDS,
      original,
    );
    expect(pedido).toMatchObject({
      puntoDeVentaId: ID,
      versionEsperada: 7,
      numero: "00009",
      sucursalId: "s-central",
      domicilio: { tipo: "NUEVO", id: IDS.domicilioId, provincia: "AR-C" },
    });
  });
});

describe("dónde se marca cada error del servidor", () => {
  it.each([
    ["numero", "numero"],
    ["sucursalId", "sucursalId"],
    ["domicilio.calle", "calle"],
    ["domicilio.numero", "numeroDeCalle"],
    ["domicilio.piso", "piso"],
    ["domicilio.departamento", "departamento"],
    ["domicilio.localidad", "localidad"],
    ["domicilio.provincia", "provincia"],
    ["domicilio.codigoPostal", "codigoPostal"],
    ["domicilio", "domicilio"],
  ] as const)("el campo %s se marca en %s", (campo, lugar) => {
    expect(lugarDelError(campo)).toBe(lugar);
  });

  it("un campo desconocido o ausente no se marca: va como aviso", () => {
    expect(lugarDelError(undefined)).toBeNull();
    expect(lugarDelError("otraCosa")).toBeNull();
    expect(lugarDelError("constructor")).toBeNull();
  });
});
