import { describe, expect, it } from "vitest";
import {
  OPCIONES_DE_PROVINCIA,
  accionesDelPuntoDeVenta,
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

const DOMICILIO = {
  id: "3e2f4a5b-6c7d-4e8f-9a0b-1c2d3e4f5a6b",
  calle: "Mitre",
  numero: "55",
  piso: "2",
  departamento: "B",
  localidad: "Rosario",
  provincia: "AR-S",
  codigoPostal: "2000",
} as const;

const punto = (cambios: Partial<PuntoParaConfigurar> = {}): PuntoParaConfigurar => ({
  id: ID,
  numero: 2,
  activo: true,
  ambiente: "HOMOLOGACION",
  sucursal: { id: "s-norte", nombre: "Sucursal Norte", activa: true },
  tieneDomicilio: true,
  domicilio: DOMICILIO,
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

  it("abre con el número en cinco dígitos, la sucursal y el domicilio actual del punto de venta", () => {
    expect(valoresParaEditar(original)).toEqual({
      numero: "00002",
      sucursalId: "s-norte",
      calle: "Mitre",
      numeroDeCalle: "55",
      piso: "2",
      departamento: "B",
      localidad: "Rosario",
      provincia: "AR-S",
      codigoPostal: "2000",
    });
  });

  it("sin domicilio abre con el domicilio en blanco; un piso, departamento o código postal que no tiene también", () => {
    expect(valoresParaEditar(punto({ tieneDomicilio: false, domicilio: null }))).toEqual({
      ...VALORES_EN_BLANCO,
      numero: "00002",
      sucursalId: "s-norte",
    });
    expect(
      valoresParaEditar(
        punto({ domicilio: { ...DOMICILIO, piso: null, departamento: null, codigoPostal: null } }),
      ),
    ).toMatchObject({ piso: "", departamento: "", codigoPostal: "" });
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

  it("el domicilio precargado y no tocado no se reenvía (un domicilio no se edita: reenviarlo es ID_EN_USO o uno repetido)", () => {
    const pedido = armarElPedidoDeEdicion(
      { ...valoresParaEditar(original), numero: "00009" },
      IDS,
      original,
    );
    expect(pedido).toEqual({ puntoDeVentaId: ID, versionEsperada: 7, numero: "00009" });
  });

  it("espacios sobrantes alrededor de lo precargado no son un cambio", () => {
    const v = valoresParaEditar(original);
    expect(
      armarElPedidoDeEdicion({ ...v, calle: ` ${v.calle} `, piso: ` ${v.piso}` }, IDS, original),
    ).toEqual({ puntoDeVentaId: ID, versionEsperada: 7 });
  });

  it.each([
    ["la calle", { calle: "Sarmiento" }],
    ["el número", { numeroDeCalle: "56" }],
    ["el piso (se borra)", { piso: "" }],
    ["el departamento", { departamento: "C" }],
    ["la localidad", { localidad: "Funes" }],
    ["la provincia", { provincia: "AR-B" }],
    ["el código postal", { codigoPostal: "2001" }],
  ] as const)(
    "corregir %s viaja como domicilio NUEVO, con el id del formulario y no con el del domicilio guardado",
    (_cual, cambio) => {
      const pedido = armarElPedidoDeEdicion(
        { ...valoresParaEditar(original), ...cambio },
        IDS,
        original,
      );
      expect(pedido).toMatchObject({ domicilio: { tipo: "NUEVO", id: IDS.domicilioId } });
      expect(IDS.domicilioId).not.toBe(DOMICILIO.id);
      expect(Object.keys(pedido).sort()).toEqual([
        "domicilio",
        "puntoDeVentaId",
        "versionEsperada",
      ]);
    },
  );

  it("borrar todo el domicilio que tenía viaja vacío: lo rechaza el servidor marcando los campos (no se calla)", () => {
    const pedido = armarElPedidoDeEdicion(
      {
        ...valoresParaEditar(original),
        calle: "",
        numeroDeCalle: "",
        piso: "",
        departamento: "",
        localidad: "",
        provincia: "",
        codigoPostal: "",
      },
      IDS,
      original,
    );
    expect(pedido).toMatchObject({ domicilio: { tipo: "NUEVO", calle: "", provincia: "" } });
  });

  it("un punto de venta sin domicilio: si no se escribe nada no viaja domicilio; si se escribe algo, viaja nuevo", () => {
    const sin = punto({ tieneDomicilio: false, domicilio: null });
    expect(armarElPedidoDeEdicion(valoresParaEditar(sin), IDS, sin)).toEqual({
      puntoDeVentaId: ID,
      versionEsperada: 7,
    });
    expect(
      armarElPedidoDeEdicion(
        { ...valoresParaEditar(sin), ...completo, numero: "00002", sucursalId: "s-norte" },
        IDS,
        sin,
      ),
    ).toMatchObject({ domicilio: { tipo: "NUEVO", id: IDS.domicilioId, calle: "Av. Rivadavia" } });
  });

  it("el mismo formulario y los mismos ids dan el mismo pedido (un reintento reenvía lo mismo)", () => {
    const v = { ...valoresParaEditar(original), calle: "Sarmiento" };
    expect(armarElPedidoDeEdicion(v, IDS, original)).toEqual(
      armarElPedidoDeEdicion(v, IDS, original),
    );
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

describe("las acciones de un punto de venta según su sucursal (D-79 y D-80)", () => {
  const permitida = { permitida: true, motivo: null } as const;
  const acciones = {
    agregar: permitida,
    editar: permitida,
    activar: permitida,
    desactivar: permitida,
    pasarAProduccion: permitida,
  };
  const cerrada = { id: "s-sur", nombre: "Sucursal Sur", activa: false };

  it("no activo en una sucursal cerrada: «Activar» se apaga con «Sucursal cerrada.» y lo demás queda igual", () => {
    const r = accionesDelPuntoDeVenta(acciones, punto({ activo: false, sucursal: cerrada }));
    expect(r.activar).toEqual({ permitida: false, motivo: "Sucursal cerrada." });
    expect(r).toEqual({ ...acciones, activar: r.activar });
  });

  it("activo en una sucursal cerrada: nada cambia (desactivar nunca se bloquea por esto)", () => {
    expect(accionesDelPuntoDeVenta(acciones, punto({ activo: true, sucursal: cerrada }))).toBe(
      acciones,
    );
  });

  it("en una sucursal abierta: nada cambia", () => {
    expect(accionesDelPuntoDeVenta(acciones, punto({ activo: false }))).toBe(acciones);
  });

  it("si el actor ya no puede activar, queda su motivo", () => {
    const sinPermiso = { ...acciones, activar: { permitida: false, motivo: "Sin permiso." } };
    expect(accionesDelPuntoDeVenta(sinPermiso, punto({ activo: false, sucursal: cerrada }))).toBe(
      sinPermiso,
    );
  });
});
