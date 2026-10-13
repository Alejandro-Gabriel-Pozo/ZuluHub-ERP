import { describe, expect, it } from "vitest";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { err, ok } from "../../../primitivas/resultado/resultado";
import {
  ERRORES_DE_FISCAL_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_FISCAL,
} from "./esquema";
import { errorFiscalDeRestriccion, traducirErroresDeFiscal } from "./traducir";

const check = (restriccion: string | null): ErrorDePersistencia => ({ tipo: "Check", restriccion });
const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

describe("el mapa de restricciones fiscales", () => {
  it("los 35 errores de los disparadores son 35 nombres distintos del mapa y ninguno es NO_TRADUCIDA", () => {
    expect(RESTRICCIONES_DE_DISPARADORES_DE_FISCAL).toHaveLength(35);
    expect(new Set(RESTRICCIONES_DE_DISPARADORES_DE_FISCAL).size).toBe(35);
    for (const nombre of RESTRICCIONES_DE_DISPARADORES_DE_FISCAL) {
      expect(ERRORES_DE_FISCAL_POR_RESTRICCION[nombre], nombre).not.toBe("NO_TRADUCIDA");
    }
  });

  it("ningún error de negocio sobra: todo nombre del mapa distinto de NO_TRADUCIDA es MAYÚSCULAS_CON_GUION_BAJO", () => {
    for (const [restriccion, codigo] of Object.entries(ERRORES_DE_FISCAL_POR_RESTRICCION)) {
      expect(codigo, restriccion).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });

  it("los errores que coinciden con un error del dominio usan exactamente su nombre", () => {
    const m = ERRORES_DE_FISCAL_POR_RESTRICCION;
    expect(m.punto_de_venta_numero_uk).toBe("PUNTO_DE_VENTA_DUPLICADO");
    expect(m.punto_de_venta_numero_inmutable).toBe("PUNTO_DE_VENTA_NUMERO_INMUTABLE");
    expect(m.punto_de_venta_domicilio_ck).toBe("PUNTO_DE_VENTA_SIN_DOMICILIO");
    expect(m.punto_de_venta_emisor_inactivo).toBe("EMISOR_INACTIVO");
    expect(m.punto_de_venta_sucursal_fkey).toBe("SUCURSAL_DE_OTRA_EMPRESA");
    expect(m.emisor_cuit_inmutable).toBe("CUIT_INMUTABLE");
    expect(m.empresa_cuit_inmutable).toBe("CUIT_INMUTABLE");
    expect(m.emisor_cuit_uk).toBe("CUIT_EN_USO");
    expect(m.emisor_con_pv_activos).toBe("EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS");
    expect(m.emisor_empresa_no_operable).toBe("EMPRESA_NO_OPERABLE");
    expect(m.emisor_principal_activo_ck).toBe("EMISOR_PRINCIPAL_NO_SE_DESACTIVA");
  });

  it("los errores de la facturación que coinciden con uno del dominio usan exactamente su nombre", () => {
    const m = ERRORES_DE_FISCAL_POR_RESTRICCION;
    expect(m.comprobante_servicio_ck).toBe("FECHAS_DE_SERVICIO_INVALIDAS");
    expect(m.comprobante_modo_c_ck).toBe("MODO_DE_PRECIO_INVALIDO_PARA_C");
    expect(m.comprobante_linea_posicion_ck).toBe("DEMASIADOS_RENGLONES");
    expect(m.comprobante_motivo_ck).toBe("MOTIVO_INVALIDO");
    expect(m.comprobante_numero_uk).toBe("NUMERO_DUPLICADO");
    expect(m.comprobante_en_vuelo_uk).toBe("SERIE_OCUPADA");
    expect(m.comprobante_tipo_ck).toBe("TIPO_DE_COMPROBANTE_INVALIDO");
    expect(m.comprobante_emisor_cuit_ck).toBe("CUIT_INVALIDO");
    expect(m.comprobante_pv_fkey).toBe("PUNTO_DE_VENTA_NO_ENCONTRADO");
    expect(m.certificado_cuit_titular_ck).toBe("CUIT_INVALIDO");
  });

  it("las dos únicas del alta de un comprobante dicen lo mismo («ya hay uno»): el repositorio las absorbe", () => {
    const m = ERRORES_DE_FISCAL_POR_RESTRICCION;
    expect(m.comprobante_identidad_uk).toBe("COMPROBANTE_YA_EXISTE");
    expect(m.comprobante_manual_uk).toBe("COMPROBANTE_YA_EXISTE");
  });
});

describe("errorFiscalDeRestriccion", () => {
  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_FISCAL_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of ["Unicidad", "Superposicion", "Referencia", "Check"] as const) {
        expect(errorFiscalDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre de restricción, con una desconocida o con otro tipo de error no hay traducción", () => {
    expect(errorFiscalDeRestriccion(check(null))).toBeNull();
    expect(errorFiscalDeRestriccion(check("restriccion_que_no_existe"))).toBeNull();
    // Nombres que existen en el prototipo de cualquier objeto no son restricciones.
    expect(errorFiscalDeRestriccion(check("constructor"))).toBeNull();
    expect(errorFiscalDeRestriccion(check("toString"))).toBeNull();
    expect(errorFiscalDeRestriccion(check("__proto__"))).toBeNull();
    expect(errorFiscalDeRestriccion({ tipo: "AccesoDenegado" })).toBeNull();
    expect(errorFiscalDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    expect(
      errorFiscalDeRestriccion({
        tipo: "Inesperado",
        sqlstate: "XX000",
        mensaje: "punto_de_venta_numero_uk",
      }),
    ).toBeNull();
  });
});

describe("traducirErroresDeFiscal", () => {
  const admitidos = ["PUNTO_DE_VENTA_DUPLICADO", "CUIT_EN_USO"] as const;

  it("un éxito pasa sin cambios", () => {
    const exito = ok(3);
    expect(traducirErroresDeFiscal(exito, admitidos)).toBe(exito);
  });

  it("un error de negocio (texto u objeto) pasa sin cambios", () => {
    const texto = err("SIN_PERMISO" as const);
    expect(traducirErroresDeFiscal(texto, admitidos)).toBe(texto);
    const objeto = err({
      codigo: "DATOS_FISCALES_INCOMPLETOS" as const,
      faltantes: ["razonSocial"],
    });
    expect(traducirErroresDeFiscal(objeto, admitidos)).toBe(objeto);
    // Un objeto con `tipo` que no es de la base tampoco se confunde: si no tiene restricción conocida, pasa.
    const conTipo = err({ tipo: "Otro" as const });
    expect(traducirErroresDeFiscal(conTipo, admitidos)).toBe(conTipo);
  });

  it("una restricción admitida se vuelve el error de negocio", () => {
    expect(traducirErroresDeFiscal(err(unicidad("punto_de_venta_numero_uk")), admitidos)).toEqual(
      err("PUNTO_DE_VENTA_DUPLICADO"),
    );
    expect(traducirErroresDeFiscal(err(check("emisor_cuit_es_empresa")), admitidos)).toEqual(
      err("CUIT_EN_USO"),
    );
  });

  it("una restricción con traducción pero no admitida por el caso de uso sale tal cual (tipada)", () => {
    const original = err(unicidad("datos_fiscales_borrador_uk"));
    expect(traducirErroresDeFiscal(original, admitidos)).toBe(original);
    const sinTraduccion = err(unicidad("punto_de_venta_pkey"));
    expect(traducirErroresDeFiscal(sinTraduccion, admitidos)).toBe(sinTraduccion);
  });

  it("los errores de la base que no son restricciones salen tal cual", () => {
    for (const error of [
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: "XX000", mensaje: "x" },
    ] as const) {
      const original = err(error);
      expect(traducirErroresDeFiscal(original, admitidos)).toBe(original);
    }
  });

  it("sin códigos admitidos nunca traduce", () => {
    const original = err(unicidad("punto_de_venta_numero_uk"));
    expect(traducirErroresDeFiscal(original, [])).toBe(original);
  });
});
