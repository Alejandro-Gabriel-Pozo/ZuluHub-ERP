import { describe, expect, it } from "vitest";
import {
  MOTIVO_DE_LA_CONFIRMACION,
  aFechaCivil,
  armarElPedidoDeConfirmacion,
  armarElPedidoDeGuardado,
  borradorTrasGuardar,
  lugarDelError,
  valoresDelBorrador,
  type BorradorDeDatosFiscales,
  type DomicilioDeDatosFiscales,
  type ValoresDeDatosFiscales,
  type VigenteDeDatosFiscales,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-datos-fiscales";

/**
 * El modelo de vista de Datos fiscales (D-43, D-61 a D-65, D-68, D-88): con qué se abre el formulario y el pedido que arma el formulario. Previene: un
 * `vigenteDesde` en el pedido de confirmar (D-61), la fecha corrida un día por pasar por `Date`, un domicilio nuevo en cada guardado
 * aunque no cambió, y un dato borrado que se pierde en silencio.
 */
const DOMICILIO: DomicilioDeDatosFiscales = {
  id: "d1",
  calle: "Av. Rivadavia",
  numero: "1234",
  piso: null,
  departamento: null,
  localidad: "Ciudad de Buenos Aires",
  provincia: "AR-C",
  codigoPostal: "1000",
};
const VIGENTE: VigenteDeDatosFiscales = {
  id: "v1",
  numero: 2,
  vigenteDesde: "2026-10-13T01:30:00.000Z",
  razonSocial: "Distribuidora Sur SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilio: DOMICILIO,
  inicioActividades: "2018-03-01",
};
const BORRADOR: BorradorDeDatosFiscales = {
  id: "b1",
  version: 4,
  razonSocial: VIGENTE.razonSocial,
  condicionIva: VIGENTE.condicionIva,
  domicilio: DOMICILIO,
  inicioActividades: VIGENTE.inicioActividades,
};
const IDS = { borradorId: "nuevo-b", domicilioId: "nuevo-d" };
const EMISOR = "e1";

describe("el formulario se abre con el borrador, con lo vigente o en blanco (D-88)", () => {
  it("el borrador precargado: la fecha en dd/mm/aaaa y el domicilio en sus campos", () => {
    expect(valoresDelBorrador(BORRADOR)).toEqual({
      razonSocial: "Distribuidora Sur SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "01/03/2018",
      calle: "Av. Rivadavia",
      numeroDeCalle: "1234",
      piso: "",
      departamento: "",
      localidad: "Ciudad de Buenos Aires",
      provincia: "AR-C",
      codigoPostal: "1000",
    });
  });

  it("sin borrador y con algo vigente: los datos vigentes, la fecha en dd/mm/aaaa", () => {
    expect(valoresDelBorrador(null, VIGENTE)).toEqual(valoresDelBorrador(BORRADOR));
  });

  it("con borrador y con algo vigente, gana el borrador", () => {
    const otro = { ...BORRADOR, razonSocial: "Otra SRL" };
    expect(valoresDelBorrador(otro, VIGENTE).razonSocial).toBe("Otra SRL");
  });

  it("sin borrador ni vigente (nunca hubo nada), todo en blanco", () => {
    expect(Object.values(valoresDelBorrador(null)).every((v) => v === "")).toBe(true);
    expect(Object.values(valoresDelBorrador(null, null)).every((v) => v === "")).toBe(true);
  });

  it("el primer guardado desde lo vigente crea el borrador con todo lo que se ve, sin versión y con el domicilio como nuevo", () => {
    const pedido = armarElPedidoDeGuardado(
      valoresDelBorrador(null, VIGENTE),
      IDS,
      EMISOR,
      null,
      null,
    );
    expect(pedido).toMatchObject({
      emisorId: EMISOR,
      borradorId: "nuevo-b",
      razonSocial: "Distribuidora Sur SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "2018-03-01",
      domicilio: { id: "nuevo-d", calle: "Av. Rivadavia" },
    });
    expect(pedido).not.toHaveProperty("versionEsperada");
  });
});

describe("la fecha de inicio de actividades: dd/mm/aaaa a aaaa-mm-dd, solo con texto", () => {
  it.each([
    ["01/03/2018", "2018-03-01"],
    ["  29/02/2024 ", "2024-02-29"],
    ["31/12/1999", "1999-12-31"],
    // La forma la acomoda la pantalla; si el día existe lo decide el servidor (`fechaCivilValida`), una sola regla.
    ["31/02/2026", "2026-02-31"],
  ])("%s → %s", (escrita, esperada) => {
    expect(aFechaCivil(escrita)).toBe(esperada);
  });

  it.each(["2018-03-01", "1/3/2018", "01-03-2018", "01/03/18", "abc", "01/03/2018 10:00"])(
    "«%s» no tiene la forma: viaja tal cual y el servidor la rechaza marcando el campo",
    (escrita) => {
      expect(aFechaCivil(escrita)).toBe(escrita.trim());
    },
  );
});

const PIDE = (
  cambios: Partial<ValoresDeDatosFiscales> = {},
  original: BorradorDeDatosFiscales | null = BORRADOR,
  version: number | null = BORRADOR.version,
) =>
  armarElPedidoDeGuardado(
    { ...valoresDelBorrador(original), ...cambios },
    IDS,
    EMISOR,
    version,
    original,
  );

describe("el pedido de «Guardar borrador»", () => {
  it("con un borrador que no cambió: sus datos, su id y su versión; el domicilio NO viaja (el borrador conserva el que tiene)", () => {
    expect(PIDE()).toEqual({
      emisorId: EMISOR,
      borradorId: "nuevo-b",
      versionEsperada: 4,
      razonSocial: "Distribuidora Sur SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      inicioActividades: "2018-03-01",
    });
  });

  it("cambia el domicilio: viaja como NUEVO con el id del domicilio del formulario (la clave de idempotencia)", () => {
    expect(PIDE({ calle: "Av. Corrientes", piso: " 2 " })).toMatchObject({
      domicilio: {
        tipo: "NUEVO",
        id: "nuevo-d",
        calle: "Av. Corrientes",
        numero: "1234",
        piso: "2",
        departamento: null,
        localidad: "Ciudad de Buenos Aires",
        provincia: "AR-C",
        codigoPostal: "1000",
      },
    });
  });

  it("empezando de cero y a medio llenar: solo viaja lo cargado y no hay versión (se crea)", () => {
    const pedido = PIDE({ razonSocial: "  Mi Empresa SRL " }, null, null);
    expect(pedido).toEqual({
      emisorId: EMISOR,
      borradorId: "nuevo-b",
      razonSocial: "Mi Empresa SRL",
    });
    expect(pedido).not.toHaveProperty("versionEsperada");
    expect(pedido).not.toHaveProperty("domicilio");
  });

  it("de cero, con algo del domicilio: va como NUEVO", () => {
    expect(PIDE({ calle: "Mitre" }, null, null)).toMatchObject({
      domicilio: { tipo: "NUEVO", id: "nuevo-d", calle: "Mitre" },
    });
  });

  it("un dato que tenía valor y se borró SÍ viaja (en blanco): el servidor lo rechaza marcando el campo, no se pierde en silencio", () => {
    expect(PIDE({ razonSocial: "", condicionIva: "", inicioActividades: "" })).toMatchObject({
      razonSocial: "",
      condicionIva: "",
      inicioActividades: "",
    });
  });

  it("el domicilio borrado entero viaja (en blanco) para que el servidor lo marque", () => {
    expect(
      PIDE({ calle: "", numeroDeCalle: "", localidad: "", provincia: "", codigoPostal: "" }),
    ).toMatchObject({ domicilio: { tipo: "NUEVO", calle: "", provincia: "" } });
  });

  it("la fecha escrita va en aaaa-mm-dd", () => {
    expect(PIDE({ inicioActividades: "15/08/2020" })).toMatchObject({
      inicioActividades: "2020-08-15",
    });
  });

  it("nunca pide Ingresos Brutos (D-45) ni fecha de vigencia (D-61)", () => {
    const claves = Object.keys(PIDE({ calle: "x" }));
    expect(claves.join(" ")).not.toMatch(/iibb|ingresos|vigente/i);
  });
});

describe("tras un guardado exitoso el borrador es el guardado (confirmación rechazada y corrección)", () => {
  const ESCRITO = {
    ...valoresDelBorrador(null),
    razonSocial: "Mi Empresa SRL",
    calle: "Mitre",
    numeroDeCalle: "10",
  };

  it("queda con su id, el domicilio que viajó (con su id) y lo que se guardó, sin blancos como texto", () => {
    expect(borradorTrasGuardar(ESCRITO, IDS, null)).toEqual({
      id: "nuevo-b",
      razonSocial: "Mi Empresa SRL",
      condicionIva: null,
      inicioActividades: null,
      domicilio: {
        id: "nuevo-d",
        calle: "Mitre",
        numero: "10",
        piso: null,
        departamento: null,
        localidad: "",
        provincia: "",
        codigoPostal: null,
      },
    });
  });

  it("el segundo guardado sale con la versión devuelta, el mismo borrador y, si el domicilio cambió, con un id de domicilio NUEVO (nunca el mismo id con otro contenido)", () => {
    const tras = { ...borradorTrasGuardar(ESCRITO, IDS, null), version: 1 };
    const corregido = { ...ESCRITO, calle: "Belgrano", inicioActividades: "01/03/2018" };
    const pedido = armarElPedidoDeGuardado(
      corregido,
      { borradorId: IDS.borradorId, domicilioId: "otro-d" },
      EMISOR,
      tras.version,
      tras,
    );
    expect(pedido).toMatchObject({
      borradorId: "nuevo-b",
      versionEsperada: 1,
      inicioActividades: "2018-03-01",
      domicilio: { tipo: "NUEVO", id: "otro-d", calle: "Belgrano" },
    });
  });

  it("si solo se completó otra cosa, el domicilio ya guardado NO viaja de nuevo", () => {
    const tras = { ...borradorTrasGuardar(ESCRITO, IDS, null), version: 1 };
    const pedido = armarElPedidoDeGuardado(
      { ...ESCRITO, inicioActividades: "01/03/2018" },
      { borradorId: IDS.borradorId, domicilioId: "otro-d" },
      EMISOR,
      tras.version,
      tras,
    );
    expect(pedido).not.toHaveProperty("domicilio");
    expect(
      borradorTrasGuardar({ ...ESCRITO, inicioActividades: "01/03/2018" }, IDS, tras).domicilio,
    ).toEqual(tras.domicilio);
  });
});

describe("el pedido de «Confirmar»", () => {
  it("el emisor, el borrador y el motivo; sin `vigenteDesde` (D-61: rige desde ya) y sin versión (la pone el guardado)", () => {
    const pedido = armarElPedidoDeConfirmacion(EMISOR, "b1");
    expect(pedido).toEqual({
      emisorId: EMISOR,
      borradorId: "b1",
      motivo: MOTIVO_DE_LA_CONFIRMACION,
    });
    expect(pedido).not.toHaveProperty("vigenteDesde");
    expect(pedido).not.toHaveProperty("versionEsperada");
    expect(MOTIVO_DE_LA_CONFIRMACION.trim()).not.toBe("");
  });
});

describe("dónde se marca un error del servidor", () => {
  it.each([
    ["razonSocial", "razonSocial"],
    ["condicionIva", "condicionIva"],
    ["inicioActividades", "inicioActividades"],
    ["domicilio.calle", "calle"],
    ["domicilio.numero", "numeroDeCalle"],
    ["domicilio.piso", "piso"],
    ["domicilio.departamento", "departamento"],
    ["domicilio.localidad", "localidad"],
    ["domicilio.provincia", "provincia"],
    ["domicilio.codigoPostal", "codigoPostal"],
    // Falta el domicilio entero (confirmar incompleto): se marca el primer campo del bloque.
    ["domicilio", "calle"],
  ])("%s → %s", (campoDelServidor, campo) => {
    expect(lugarDelError(campoDelServidor)).toBe(campo);
  });

  it.each([undefined, "motivo", "vigenteDesde", "toString", "__proto__", "constructor"])(
    "«%s» no es de un campo del formulario: va como aviso arriba",
    (campo) => {
      expect(lugarDelError(campo)).toBeNull();
    },
  );
});
