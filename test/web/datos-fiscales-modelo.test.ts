import { describe, expect, it } from "vitest";
import {
  MOTIVO_DE_LA_CONFIRMACION,
  aFechaCivil,
  armarElPedidoDeConfirmacion,
  armarElPedidoDeGuardado,
  armarLaLectura,
  domicilioEnUnaLinea,
  lugarDelError,
  valoresDelBorrador,
  type BorradorDeDatosFiscales,
  type DomicilioDeDatosFiscales,
  type ValoresDeDatosFiscales,
  type VigenteDeDatosFiscales,
} from "../../apps/web/ui/plantillas/configuracion-fiscal/modelo-de-datos-fiscales";

/**
 * El modelo de vista de Datos fiscales (D-43, D-61 a D-65, D-68): lo que se lee y el pedido que arma el formulario. Previene: un
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
const CONDICIONES = [
  { valor: "RESPONSABLE_INSCRIPTO", etiqueta: "IVA Responsable Inscripto" },
  { valor: "MONOTRIBUTO", etiqueta: "Responsable Monotributo" },
];
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

describe("lo vigente, para leer", () => {
  it("el CUIT con guiones, la razón social, la condición con el texto del manual de ARCA (D-44), el domicilio, el inicio en dd/mm/aaaa y «Rige desde»", () => {
    const lectura = armarLaLectura("30712345678", VIGENTE, CONDICIONES, "2026-10-12");
    expect(lectura.filas).toEqual([
      { rotulo: "CUIT", valor: "30-71234567-8" },
      { rotulo: "Razón social", valor: "Distribuidora Sur SA" },
      { rotulo: "Condición frente al IVA", valor: "IVA Responsable Inscripto" },
      {
        rotulo: "Domicilio fiscal",
        valor:
          "Av. Rivadavia 1234, Ciudad de Buenos Aires, Ciudad Autónoma de Buenos Aires, Código postal 1000",
      },
      { rotulo: "Inicio de actividades", valor: "01/03/2018" },
    ]);
    expect(lectura.rigeDesde).toBe("Rige desde el 12/10/2026.");
  });

  it("una condición que la lista no conoce se muestra como llegó, no se inventa un texto", () => {
    const lectura = armarLaLectura(
      "30712345678",
      { ...VIGENTE, condicionIva: "OTRA" },
      CONDICIONES,
      "2026-10-12",
    );
    expect(lectura.filas[2]?.valor).toBe("OTRA");
  });

  it("el domicilio dice piso y departamento con los rótulos ya aprobados", () => {
    expect(
      domicilioEnUnaLinea({ ...DOMICILIO, piso: "3", departamento: "B", codigoPostal: null }),
    ).toBe(
      "Av. Rivadavia 1234, Piso 3, Departamento B, Ciudad de Buenos Aires, Ciudad Autónoma de Buenos Aires",
    );
  });
});

describe("el formulario se abre con el borrador (D-62) o en blanco", () => {
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

  it("sin borrador, todo en blanco", () => {
    expect(Object.values(valoresDelBorrador(null)).every((v) => v === "")).toBe(true);
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
