import { describe, expect, it } from "vitest";
import { grabacion, respuestaHttp } from "../../../test/utilidades/arca";
import {
  CODIGO_DE_MONEDA,
  CODIGO_DE_TIPO_DE_COMPROBANTE,
  CODIGO_DE_TIPO_DE_DOCUMENTO,
  CODIGOS_DE_ALICUOTA,
  type TipoDeComprobante,
} from "../../modulos/fiscal/publico";
import { clasificarParametros } from "./clasificar";
import {
  alicuotaDeId,
  ID_DE_ALICUOTA,
  ID_DE_CONCEPTO,
  ID_DE_CONDICION_IVA,
  TABLAS_DE_PARAMETROS,
} from "./codigos";

/**
 * Las tablas de códigos del adaptador (y las del dominio que se traducen en él) se comparan con lo que
 * `FEParamGet*` contestó en homologación real: si una tabla no coincide con ARCA, el comprobante saldría con
 * un código equivocado (un IVA del 21 % informado como otro, una condición del receptor cambiada).
 */
const tabla = (numero: string, operacion: string) => {
  const r = clasificarParametros(respuestaHttp(grabacion(1, numero, "respuesta")), operacion);
  if (!r.ok) throw new Error(JSON.stringify(r.error));
  return r.valor;
};
const descripcionDe = (filas: readonly Readonly<Record<string, string>>[], id: number) =>
  filas.find((f) => f["Id"] === String(id))?.["Desc"];

describe("las tablas del adaptador contra la homologación real", () => {
  it("concepto: 1 producto, 2 servicios, 3 productos y servicios", () => {
    const filas = tabla("018", "FEParamGetTiposConcepto");
    expect(ID_DE_CONCEPTO).toEqual({ PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 });
    expect(descripcionDe(filas, ID_DE_CONCEPTO.PRODUCTOS)).toBe("Producto");
    expect(descripcionDe(filas, ID_DE_CONCEPTO.SERVICIOS)).toBe("Servicios");
    expect(descripcionDe(filas, ID_DE_CONCEPTO.PRODUCTOS_Y_SERVICIOS)).toBe(
      "Productos y Servicios",
    );
  });

  it("alícuotas de IVA: 3 = 0 %, 4 = 10,5 %, 5 = 21 %, 6 = 27 %, 8 = 5 %, 9 = 2,5 %", () => {
    const filas = tabla("014", "FEParamGetTiposIva");
    expect(ID_DE_ALICUOTA).toEqual({ "0": 3, "10.5": 4, "21": 5, "27": 6, "5": 8, "2.5": 9 });
    for (const [codigo, id] of Object.entries(ID_DE_ALICUOTA)) {
      expect(descripcionDe(filas, id), codigo).toBe(`${codigo}%`);
    }
    // Todo lo que ARCA tiene en la tabla de IVA, Pedernal lo conoce: ni una alícuota de más ni de menos.
    expect(filas.map((f) => f["Id"]).sort()).toEqual(
      Object.values(ID_DE_ALICUOTA).map(String).sort(),
    );
  });

  it("toda alícuota gravada del dominio tiene su id; el exento y el no gravado no", () => {
    for (const codigo of CODIGOS_DE_ALICUOTA) {
      const gravada = codigo !== "EXENTO" && codigo !== "NO_GRAVADO";
      expect(ID_DE_ALICUOTA[codigo] !== undefined, codigo).toBe(gravada);
    }
  });

  it("condición frente al IVA del receptor: los once ids, cada uno con su descripción", () => {
    const filas = tabla("016", "FEParamGetCondicionIvaReceptor");
    expect(ID_DE_CONDICION_IVA).toEqual({
      RESPONSABLE_INSCRIPTO: 1,
      EXENTO: 4,
      CONSUMIDOR_FINAL: 5,
      MONOTRIBUTO: 6,
      NO_CATEGORIZADO: 7,
      PROVEEDOR_DEL_EXTERIOR: 8,
      CLIENTE_DEL_EXTERIOR: 9,
      IVA_LIBERADO_LEY_19640: 10,
      MONOTRIBUTISTA_SOCIAL: 13,
      IVA_NO_ALCANZADO: 15,
      MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO: 16,
    });
    const descripciones = {
      RESPONSABLE_INSCRIPTO: "IVA Responsable Inscripto",
      EXENTO: "IVA Sujeto Exento",
      CONSUMIDOR_FINAL: "Consumidor Final",
      MONOTRIBUTO: "Responsable Monotributo",
      NO_CATEGORIZADO: "Sujeto No Categorizado",
      PROVEEDOR_DEL_EXTERIOR: "Proveedor del Exterior",
      CLIENTE_DEL_EXTERIOR: "Cliente del Exterior",
      IVA_LIBERADO_LEY_19640: "IVA Liberado – Ley N° 19.640",
      MONOTRIBUTISTA_SOCIAL: "Monotributista Social",
      IVA_NO_ALCANZADO: "IVA No Alcanzado",
      MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO:
        "Monotributo Trabajador Independiente Promovido",
    } as const;
    for (const [condicion, id] of Object.entries(ID_DE_CONDICION_IVA)) {
      expect(descripcionDe(filas, id), condicion).toBe(
        descripciones[condicion as keyof typeof descripciones],
      );
    }
    expect(filas).toHaveLength(Object.keys(ID_DE_CONDICION_IVA).length);
  });

  it("alicuotaDeId es la inversa de ID_DE_ALICUOTA y no conoce ningún otro id", () => {
    for (const [codigo, id] of Object.entries(ID_DE_ALICUOTA)) {
      expect(alicuotaDeId(String(id)), codigo).toBe(codigo);
    }
    for (const id of ["1", "2", "7", "10", "03", "5 ", " 5", "", "x", "05"]) {
      expect(alicuotaDeId(id), id).toBeNull();
    }
  });

  it("las seis tablas que se leen, en el orden del espía", () => {
    expect(TABLAS_DE_PARAMETROS).toEqual([
      "TiposCbte",
      "TiposDoc",
      "TiposIva",
      "CondicionIvaReceptor",
      "TiposConcepto",
      "TiposMonedas",
    ]);
  });
});

describe("las tablas del dominio de fiscal contra la homologación real", () => {
  it("tipos de comprobante: A, B y C, con facturas, notas de débito y de crédito", () => {
    const filas = tabla("010", "FEParamGetTiposCbte");
    const esperado: Record<TipoDeComprobante, string> = {
      FACTURA_A: "Factura A",
      NOTA_DEBITO_A: "Nota de Débito A",
      NOTA_CREDITO_A: "Nota de Crédito A",
      FACTURA_B: "Factura B",
      NOTA_DEBITO_B: "Nota de Débito B",
      NOTA_CREDITO_B: "Nota de Crédito B",
      FACTURA_C: "Factura C",
      NOTA_DEBITO_C: "Nota de Débito C",
      NOTA_CREDITO_C: "Nota de Crédito C",
    };
    for (const [tipo, descripcion] of Object.entries(esperado)) {
      expect(
        descripcionDe(filas, CODIGO_DE_TIPO_DE_COMPROBANTE[tipo as TipoDeComprobante]),
        tipo,
      ).toBe(descripcion);
    }
  });

  it("tipos de documento: CUIT, CUIL, CDI, DNI, pasaporte y «otro» (consumidor final)", () => {
    const filas = tabla("012", "FEParamGetTiposDoc");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.CUIT)).toBe("CUIT");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.CUIL)).toBe("CUIL");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.CDI)).toBe("CDI");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.DNI)).toBe("DNI");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.PASAPORTE)).toBe("Pasaporte");
    expect(descripcionDe(filas, CODIGO_DE_TIPO_DE_DOCUMENTO.SIN_IDENTIFICAR)).toBe("Doc. (Otro)");
  });

  it("moneda: PES son los pesos argentinos", () => {
    const filas = tabla("020", "FEParamGetTiposMonedas");
    expect(filas.find((f) => f["Id"] === CODIGO_DE_MONEDA.ARS)?.["Desc"]).toBe("Pesos Argentinos");
  });
});
